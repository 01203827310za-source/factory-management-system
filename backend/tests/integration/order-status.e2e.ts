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


type MissingRow = { model_code: string; color: string; required: number; reserved: number; missing: number; orders: { order_number: string }[] };
async function missingRow(code: string, color: string) {
  const d = await api('GET', '/dashboard');
  const ms = d.body.missing_stock as { rows: MissingRow[]; total_missing_units: number };
  return { row: ms.rows.find(r => r.model_code === code && r.color === color), total: ms.total_missing_units, body: d.body };
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
  await prisma.cuttingOrder.deleteMany({});
  await prisma.modelProduction.deleteMany({});
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
  const overAsk = await api('POST', '/sales', modalPayload({ order_number: 'E2E-3', order_status: 'تم الحجز', model1_qty: 9999 }));
  check('asking for more than exists is ACCEPTED (201); only what exists is held, the rest is pending',
    overAsk.status === 201 && overAsk.body.fulfillment?.requested === 9999 && overAsk.body.fulfillment?.reserved <= 90 && overAsk.body.fulfillment?.pending === 9999 - overAsk.body.fulfillment?.reserved, overAsk);
  const stockOver = await prisma.readyStock.findFirst({ where: { model_code: 'M1' } });
  check('stored reserved_quantity never exceeds physical stock', (stockOver?.reserved_quantity ?? 0) <= 90, stockOver);
  await api('DELETE', `/sales/${overAsk.body.id}`);   // keep the rest of the run's numbers simple
  const cancelPrepared = await api('PUT', `/sales/${rid}`, modalPayload({ order_number: 'E2E-2', order_status: 'تم الإلغاء', model1_qty: 5 }));
  const stockAfterCancel = await prisma.readyStock.findFirst({ where: { model_code: 'M1' } });
  check('cancelling a prepared order releases the reservation', cancelPrepared.status === 200 && stockAfterCancel?.reserved_quantity === 0, { cancelPrepared: cancelPrepared.status, reserved: stockAfterCancel?.reserved_quantity });

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
  const b = dash.body as { cash_on_hand: number; net_profit: number; total_in: number; total_out: number; cash_available: number; total_current_assets: number; assets_reconciliation: { components_sum: number } };
  check('Dashboard: «الكاش الفعلي» = «الصافي» = total in − total out', b.cash_on_hand === b.net_profit && b.cash_on_hand === b.total_in - b.total_out, { cash: b.cash_on_hand, net: b.net_profit });
  check('Dashboard: cash is inside current assets exactly once (total = components sum)', b.total_current_assets === b.assets_reconciliation.components_sum && b.total_current_assets >= b.cash_on_hand, b);
  check('Dashboard: «الكاش الفعلي» is a different figure from «الكاش المتاح» only by outstanding debts', b.cash_available <= b.cash_on_hand, b);

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

  // 3g) accept an order for goods that do not exist yet, then produce them
  const seasonId = created.body.season_id as number;
  await prisma.cuttingOrder.create({ data: { season_id: seasonId, date: '2026-10-01', cut_number: 1, cut_description: 'قصة', material_type: 'قطن', color: 'أسود', total_pieces: 100 } });
  const prep = await api('POST', '/sales', modalPayload({ order_number: 'P-9', model1_code: 'M9', model1_qty: 10, model1_color: 'أسود', invoice_value: 5000, deposit_paid: 500, order_status: 'تم الحجز' }));
  check('«يتم التجهيز» accepted for a model with NO stock card (all pending)', prep.status === 201 && prep.body.fulfillment?.reserved === 0 && prep.body.fulfillment?.pending === 10 && prep.body.fulfillment?.slots?.[0]?.has_card === false, prep);
  const pid = prep.body.id as number;
  const shipEarly = await api('PUT', `/sales/${pid}`, modalPayload({ order_number: 'P-9', model1_code: 'M9', model1_qty: 10, model1_color: 'أسود', invoice_value: 5000, deposit_paid: 500, order_status: 'لم يتم الصرف' }));
  check('saving an edit that asks to ship goods that were never produced is accepted but NOT shipped: it stays «يتم التجهيز» and says why (200)', shipEarly.status === 200 && shipEarly.body.order_status === 'تم الحجز' && shipEarly.body.status_downgraded === true && /لا يمكن شحن/.test(String(shipEarly.body.downgrade_reason)), shipEarly);
  check('…and nothing was shipped or deducted', (await counts(pid)).status === 'تم الحجز' && (await counts(pid)).movements === 0);
  const dashPending = await api('GET', '/dashboard');
  const po = (dashPending.body.pending_orders as { order_number: string; pending: number }[] | undefined)?.find(o => o.order_number === 'P-9');
  check('Dashboard lists the order as pending (10) and not as an asset', po?.pending === 10 && dashPending.body.assets_reconciliation?.reconciled === true, po);

  const m0 = await missingRow('M9', 'أسود');
  check('«ملخص النواقص»: M9 / أسود shows 10 missing from order P-9', m0.row?.missing === 10 && m0.row?.required === 10 && m0.row?.reserved === 0 && m0.row?.orders.some(o => o.order_number === 'P-9') === true, m0.row);
  const m0b = await missingRow('M9', 'أسود');
  check('«ملخص النواقص»: a repeated request returns the same numbers', JSON.stringify(m0b.row) === JSON.stringify(m0.row) && m0b.total === m0.total);

  const prod = (qty: number) => api('POST', '/model-prod', {
    date: '2026-10-10', cut_number: 1, model_code: 'M9', qty_from_cutting: qty, model_description: 'M9', color: 'أسود', sizes: '',
    status: 'تام', wastage: 0, qty_received: qty, cost_per_piece: 100, warehouse_entry_date: '2026-10-10',
    parts: [{ part_type: '', cut_number: 1, color: 'أسود' }],
  });
  const p1 = await prod(6);
  check('record production of 6 (201)', p1.status === 201, p1);
  const afterP1 = await api('GET', '/sales');
  const f1 = (afterP1.body as unknown as { id: number; fulfillment?: { reserved: number; pending: number } }[]).find(x => x.id === pid)?.fulfillment;
  check('production fulfils part of the order: reserved 6, pending 4', f1?.reserved === 6 && f1?.pending === 4, f1);
  const m1 = await missingRow('M9', 'أسود');
  check('«ملخص النواقص»: after producing 6 → required 10, reserved 6, missing 4', m1.row?.required === 10 && m1.row?.reserved === 6 && m1.row?.missing === 4, m1.row);
  const card = await prisma.readyStock.findFirst({ where: { model_code: 'M9' } });
  check('stock card cache: reserved_quantity = 6 (not more than exists)', card?.reserved_quantity === 6, card);
  const rsList = await api('GET', '/ready-stock');
  const m9 = (rsList.body as unknown as { model_code: string; reserved_quantity: number; pending_quantity: number }[]).find(r => r.model_code === 'M9');
  check('GET /ready-stock reports reserved 6 and pending 4', m9?.reserved_quantity === 6 && m9?.pending_quantity === 4, m9);

  const p2 = await prod(4);
  check('record production of 4 more (201)', p2.status === 201, p2);
  for (let i = 0; i < 3; i++) await api('PUT', `/sales/${pid}`, modalPayload({ order_number: 'P-9', model1_code: 'M9', model1_qty: 10, model1_color: 'أسود', invoice_value: 5000, deposit_paid: 500, order_status: 'تم الحجز' }));
  const m2 = await missingRow('M9', 'أسود');
  check('«ملخص النواقص»: fully produced → the M9 / أسود row disappears', m2.row === undefined, m2.row);
  const cardFull = await prisma.readyStock.findFirst({ where: { model_code: 'M9' } });
  const afterP2 = await api('GET', '/sales');
  const f2 = (afterP2.body as unknown as { id: number; order_status: string; fulfillment?: { reserved: number; pending: number } }[]).find(x => x.id === pid);
  check('fully fulfilled (reserved 10, pending 0) — reserved not duplicated by repeated saves / production', f2?.fulfillment?.reserved === 10 && f2?.fulfillment?.pending === 0 && cardFull?.reserved_quantity === 10, { f2: f2?.fulfillment, cache: cardFull?.reserved_quantity });
  check('the order was NOT shipped automatically', f2?.order_status === 'تم الحجز' && (await counts(pid)).movements === 0);
  const shipNow = await api('PUT', `/sales/${pid}`, modalPayload({ order_number: 'P-9', model1_code: 'M9', model1_qty: 10, model1_color: 'أسود', invoice_value: 5000, deposit_paid: 500, order_status: 'لم يتم الصرف' }));
  const cardShipped = await prisma.readyStock.findFirst({ where: { model_code: 'M9' } });
  check('now that the goods exist, shipping succeeds; reservation released; cost logged once', shipNow.status === 200 && cardShipped?.reserved_quantity === 0 && (await counts(pid)).movements === 1, { status: shipNow.status, reserved: cardShipped?.reserved_quantity });
  const dashAfter = await api('GET', '/dashboard');
  check('Dashboard still reconciles after production and shipping', dashAfter.body.assets_reconciliation?.reconciled === true, dashAfter.body.assets_reconciliation);

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
