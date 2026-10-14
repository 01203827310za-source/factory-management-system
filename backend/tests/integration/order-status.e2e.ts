// End-to-end check of the order status flow against a REAL running backend + Postgres.
//   Needs: a scratch database that has the schema (prisma db push), the server running against it,
//          and the same DATABASE_URL / JWT_SECRET exported here.
//   Run:   E2E_BASE_URL=http://localhost:3911 DATABASE_URL=... JWT_SECRET=... npm run test:e2e
// It only ever writes to the database it is pointed at — never run it against production.
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3911';
const prisma = new PrismaClient();
let failed = 0;

const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};

let token = '';
let seasonHeader: Record<string, string> = {};
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...seasonHeader },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json as Record<string, any> };
}

// The exact payload shape the Edit Order modal (Sales.tsx handleSubmit) sends.
const modalPayload = (o: Record<string, unknown>) => ({
  order_number: 'E2E-1', marketer: 'm', client: 'عميل', mobile: '',
  model1_code: 'M1', model1_qty: 10, model1_color: 'أسود',
  model2_code: '', model2_qty: 0, model2_color: '', model3_code: '', model3_qty: 0, model3_color: '',
  model4_code: '', model4_qty: 0, model4_color: '', model5_code: '', model5_qty: 0, model5_color: '',
  invoice_value: 8500, deposit_paid: 0, deposit_receiver: '', shipping_number: '',
  order_status: 'لم يتم الصرف', delivery_method: 'ايرجنت', warehouse: '', shipping_collected: 0,
  shipping_collected_date: undefined, row_number: 1, ...o,
});

async function counts(saleId: number) {
  const [collections, movements, sale] = await Promise.all([
    prisma.shippingCollection.count({ where: { sale_id: saleId } }),
    prisma.inventoryMovement.count({ where: { sale_id: saleId } }),
    prisma.sale.findUnique({ where: { id: saleId } }),
  ]);
  return { collections, movements, status: sale?.order_status, collected: sale?.shipping_collected };
}

async function main() {
  // Safety: this test deletes orders and stock. Only ever run it against a local scratch database.
  const dbUrl = process.env.DATABASE_URL || '';
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
    console.error('Refusing to run: DATABASE_URL is not a localhost database.');
    process.exit(2);
  }
  await prisma.charityPayment.deleteMany({});
  await prisma.expenseRevenue.deleteMany({});
  await prisma.sale.deleteMany({});       // cascades to its collection / movement ledgers
  await prisma.readyStock.deleteMany({});

  const user = await prisma.user.upsert({
    where: { username: 'e2e-admin' }, update: {},
    create: { username: 'e2e-admin', password: 'x', full_name: 'e2e', role: 'admin', is_active: true },
  });
  token = jwt.sign({ userId: user.id, username: user.username, role: 'admin' }, process.env.JWT_SECRET!);

  const stock = await api('POST', '/ready-stock', { model_code: 'M1', product_name: 'M1', color: 'أسود', opening_balance: 100, cost_per_piece: 600, location: '' });
  check('seed ready stock', stock.status === 201, stock);

  // 1) a shipped order, then the user edits it to «يتم التجهيز» (stored value 'تم الحجز')
  const created = await api('POST', '/sales', modalPayload({}));
  check('create shipped order (لم يتم الصرف)', created.status === 201, created);
  const id = created.body.id as number;

  const toPrepared = await api('PUT', `/sales/${id}`, modalPayload({ order_status: 'تم الحجز' }));
  check('update order → يتم التجهيز (stored تم الحجز)', toPrepared.status === 200, toPrepared);
  console.log('      response:', toPrepared.status, JSON.stringify(toPrepared.body).slice(0, 200));

  const after = await counts(id);
  check('status persisted as the stored value', after.status === 'تم الحجز', after);
  const row = await prisma.readyStock.findFirst({ where: { model_code: 'M1' } });
  check('reservation recorded (reserved_quantity = 10)', row?.reserved_quantity === 10, row);

  // 2) idempotent re-saves
  for (let i = 0; i < 3; i++) await api('PUT', `/sales/${id}`, modalPayload({ order_status: 'تم الحجز' }));
  const resaved = await counts(id);
  const row2 = await prisma.readyStock.findFirst({ where: { model_code: 'M1' } });
  check('re-saving does not duplicate reservation / movements / collections', row2?.reserved_quantity === 10 && resaved.collections === 0 && resaved.movements === 1 + 1, { resaved, reserved: row2?.reserved_quantity });

  // 3) other statuses still work
  const shipped = await api('PUT', `/sales/${id}`, modalPayload({ order_status: 'لم يتم الصرف' }));
  check('→ لم يتم الصرف', shipped.status === 200, shipped);
  const paid = await api('PUT', `/sales/${id}`, modalPayload({ order_status: 'تم الصرف', shipping_collected: 8200 }));
  check('→ تم الصرف (collected 8,200)', paid.status === 200 && paid.body.collection_difference === 300, paid);
  const paidAgain = await api('PUT', `/sales/${id}`, modalPayload({ order_status: 'تم الصرف', shipping_collected: 8200 }));
  const afterPaid = await counts(id);
  check('re-saving a paid-out order adds no collection / movement', paidAgain.status === 200 && afterPaid.collections === 1, afterPaid);

  // 3b) cancellation rules
  const reservedOrder = await api('POST', '/sales', modalPayload({ order_number: 'E2E-2', order_status: 'تم الحجز', model1_qty: 5 }));
  check('create order directly as «يتم التجهيز»', reservedOrder.status === 201, reservedOrder);
  const rid = reservedOrder.body.id as number;
  const stockAfterReserve = await prisma.readyStock.findFirst({ where: { model_code: 'M1' } });
  check('reserved_quantity includes the new reservation (5)', stockAfterReserve?.reserved_quantity === 5, stockAfterReserve);
  const tooMany = await api('POST', '/sales', modalPayload({ order_number: 'E2E-3', order_status: 'تم الحجز', model1_qty: 9999 }));
  check('over-reserving is refused with an Arabic message (400)', tooMany.status === 400 && /أكبر من المتاح/.test(String(tooMany.body.message)), tooMany);
  const cancelPrepared = await api('PUT', `/sales/${rid}`, modalPayload({ order_number: 'E2E-2', order_status: 'تم الإلغاء', model1_qty: 5 }));
  const stockAfterCancel = await prisma.readyStock.findFirst({ where: { model_code: 'M1' } });
  check('cancelling a prepared order releases the reservation', cancelPrepared.status === 200 && stockAfterCancel?.reserved_quantity === 0, { cancelPrepared: cancelPrepared.status, reserved: stockAfterCancel?.reserved_quantity });
  const cancelShipped = await api('PUT', `/sales/${id}`, modalPayload({ order_status: 'تم الإلغاء', shipping_collected: 0 }));
  check('cancelling a shipped order is refused (stock only returns via Returns)', cancelShipped.status === 400, cancelShipped);

  // 3c) an order stored the OLD way (status 'تم الحجز' + reserved_quantity set by the previous workflow)
  await prisma.readyStock.updateMany({ where: { model_code: 'M1' }, data: { reserved_quantity: 7 } });
  const legacy = await prisma.sale.create({ data: {
    season_id: created.body.season_id, order_number: 'LEGACY-1', client: 'قديم', marketer: 'm', invoice_value: 3000, deposit_paid: 0, remaining: 3000,
    model1_code: 'M1', model1_qty: 7, model1_color: 'أسود', order_status: 'تم الحجز',
  } });
  const editLegacy = await api('PUT', `/sales/${legacy.id}`, modalPayload({ order_number: 'LEGACY-1', client: 'قديم (معدل)', model1_qty: 7, invoice_value: 3000, order_status: 'تم الحجز' }));
  const stockLegacy = await prisma.readyStock.findFirst({ where: { model_code: 'M1' } });
  check('an order already stored as تم الحجز can be edited', editLegacy.status === 200, editLegacy);
  check('its reservation stays correct (7), not doubled', stockLegacy?.reserved_quantity === 7, stockLegacy);
  const legacyShip = await api('PUT', `/sales/${legacy.id}`, modalPayload({ order_number: 'LEGACY-1', model1_qty: 7, invoice_value: 3000, order_status: 'لم يتم الصرف' }));
  const stockShipped = await prisma.readyStock.findFirst({ where: { model_code: 'M1' } });
  check('shipping it releases the reservation and logs the cost once', legacyShip.status === 200 && stockShipped?.reserved_quantity === 0 && (await counts(legacy.id)).movements === 1, { status: legacyShip.status, reserved: stockShipped?.reserved_quantity });
  await api('PUT', `/sales/${legacy.id}`, modalPayload({ order_number: 'LEGACY-1', model1_qty: 7, invoice_value: 3000, order_status: 'تم الحجز' }));

  // 3d) Dashboard shows the right reserved / available split and a clean reconciliation
  const dash = await api('GET', '/dashboard');
  const item = (dash.body.stock_items as { actual_qty: number; reserved_qty: number; available_qty: number }[] | undefined)?.[0];
  check('Dashboard: GET /dashboard works', dash.status === 200, dash.status);
  check('Dashboard: physical = reserved + available (no double count)', !!item && item.actual_qty === item.reserved_qty + item.available_qty && item.reserved_qty === 7, item);
  check('Dashboard: assets reconcile', dash.body.assets_reconciliation?.reconciled === true, dash.body.assets_reconciliation);

  // 3e) monthly charity: lock + payment + idempotency + overpay + reversal (uses the same advisory lock)
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }).slice(0, 7);
  const summary = await api('GET', `/charity/summary?month=${month}`);
  check('charity summary: due = 1% of 8,200 = 82', summary.status === 200 && summary.body.due === 82, summary.body);
  const key = `e2e-${Date.now()}-key`;
  const pay = await api('POST', '/charity/payments', { charity_month: month, amount: 50, payment_date: month + '-15', payment_method: 'نقدي', notes: '', idempotency_key: key });
  check('charity: partial payment 50 recorded (201)', pay.status === 201 && pay.body.summary?.remaining === 32, pay);
  const payAgain = await api('POST', '/charity/payments', { charity_month: month, amount: 50, payment_date: month + '-15', payment_method: 'نقدي', notes: '', idempotency_key: key });
  check('charity: retry with the same key creates nothing new', payAgain.status === 200 && payAgain.body.duplicate === true, payAgain);
  check('charity: exactly one linked expense exists', (await prisma.expenseRevenue.count({ where: { operation_type: 'صدقة' } })) === 1);
  const overpay = await api('POST', '/charity/payments', { charity_month: month, amount: 100, payment_date: month + '-15', payment_method: 'نقدي', notes: '', idempotency_key: key + '-2' });
  check('charity: paying more than the outstanding is refused (400)', overpay.status === 400, overpay);
  const rev = await api('DELETE', `/charity/payments/${pay.body.payment?.id}`);
  check('charity: reversal removes the payment and its expense', rev.status === 200 && (await prisma.expenseRevenue.count({ where: { operation_type: 'صدقة' } })) === 0, rev);

  // 3f) Dashboard-related endpoints respond (no hidden 500s)
  for (const path of ['/dashboard/breakdown/net-profit', '/dashboard/breakdown/expenses', '/dashboard/breakdown/sales', '/dashboard/breakdown/receivables-audit', '/financial-center', '/charity/history', `/sales/${id}/ledger`]) {
    const r = await api('GET', path);
    check(`GET ${path}`, r.status === 200, { status: r.status, body: r.body });
  }

  // 4) list shows the stored value (the UI maps it to «يتم التجهيز»)
  const list = await api('GET', '/sales');
  check('GET /sales works', list.status === 200 && Array.isArray(list.body), list.status);

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
