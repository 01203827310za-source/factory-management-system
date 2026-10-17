// End-to-end check of FULL ORDER CANCELLATION against a REAL running backend + Postgres, verifying the
// database rows (not just API answers).
//   Needs: a scratch database with the schema (prisma db push), the server running against it, and the same
//          DATABASE_URL / JWT_SECRET exported here.
//   Run:   E2E_BASE_URL=http://localhost:3911 DATABASE_URL=... JWT_SECRET=... npm run test:e2e:cancel
// It deletes orders and stock of the database it is pointed at — it refuses to run unless that is on localhost.
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

type Json = Record<string, any>;
let token = '';
let viewerToken = '';
async function api(method: string, path: string, body?: unknown, opts: { token?: string; season?: number } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${opts.token ?? token}`,
      ...(opts.season ? { 'X-Season-Id': String(opts.season) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json as Json };
}

const PREPARED = 'تم الحجز', NOT_PAID_OUT = 'لم يتم الصرف', PAID_OUT = 'تم الصرف', CANCELED = 'تم الإلغاء';
let orderNo = 0;
type Line = { code: string; qty: number; color: string };
const payload = (o: Json & { lines?: Line[] }) => {
  const lines = o.lines ?? [{ code: 'M1', qty: 10, color: 'أسود' }];
  const p: Json = {
    order_number: o.order_number ?? `C-${++orderNo}`, marketer: 'm', client: 'عميل', mobile: '', invoice_value: 8500, deposit_paid: 0,
    deposit_receiver: '', shipping_number: '', order_status: NOT_PAID_OUT, delivery_method: 'ايرجنت', warehouse: '', shipping_collected: 0, row_number: 1, ...o,
  };
  delete p.lines;
  for (let i = 1; i <= 5; i++) { const l = lines[i - 1]; p[`model${i}_code`] = l?.code ?? ''; p[`model${i}_qty`] = l?.qty ?? 0; p[`model${i}_color`] = l?.color ?? ''; }
  return p;
};

async function reset() {
  await prisma.charityPayment.deleteMany({}); await prisma.expenseRevenue.deleteMany({});
  await prisma.sale.deleteMany({});            // cascades to collections / movements / cancellations
  await prisma.returnItem.deleteMany({});
  await prisma.readyStock.deleteMany({});
  await api('POST', '/ready-stock', { model_code: 'M1', product_name: 'M1', color: 'أسود', opening_balance: 100, cost_per_piece: 600, location: '' });
  await api('POST', '/ready-stock', { model_code: 'M2', product_name: 'M2', color: 'أبيض', opening_balance: 50, cost_per_piece: 400, location: '' });
}
const dash = async () => (await api('GET', '/dashboard')).body;
const stockQty = async (code: string, color: string) => {
  const d = await dash();
  const it = (d.stock_items as { model_code: string; color: string; actual_qty: number }[]).find(i => i.model_code === code && i.color === color);
  return it?.actual_qty ?? 0;
};
const rows = async (saleId: number) => ({
  movements: await prisma.inventoryMovement.findMany({ where: { sale_id: saleId }, orderBy: { id: 'asc' } }),
  collections: await prisma.shippingCollection.findMany({ where: { sale_id: saleId }, orderBy: { id: 'asc' } }),
  cancellations: await prisma.orderCancellation.findMany({ where: { sale_id: saleId }, orderBy: { id: 'asc' } }),
  sale: await prisma.sale.findUnique({ where: { id: saleId } }),
});

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '')) { console.error('Refusing to run: DATABASE_URL is not a localhost database.'); process.exit(2); }

  // leftovers of an interrupted earlier run (scratch database only)
  const stale = await prisma.season.findMany({ where: { name: 'Winter E2E' }, select: { id: true } });
  for (const st of stale) {
    await prisma.sale.deleteMany({ where: { season_id: st.id } });
    await prisma.financialSnapshot.deleteMany({ where: { season_id: st.id } });
    await prisma.season.delete({ where: { id: st.id } });
  }

  const admin = await prisma.user.upsert({ where: { username: 'e2e-admin' }, update: {}, create: { username: 'e2e-admin', password: 'x', full_name: 'e2e', role: 'admin', is_active: true } });
  token = jwt.sign({ userId: admin.id, username: admin.username, role: 'admin' }, process.env.JWT_SECRET!);
  const viewer = await prisma.user.upsert({ where: { username: 'e2e-nobody' }, update: {}, create: { username: 'e2e-nobody', password: 'x', full_name: 'no perms', role: 'viewer', is_active: true } });
  viewerToken = jwt.sign({ userId: viewer.id, username: viewer.username, role: 'viewer' }, process.env.JWT_SECRET!);

  // ───────── 1. unshipped, no deposit ─────────
  await reset();
  let o = (await api('POST', '/sales', payload({ order_status: PREPARED }))).body;
  check('1. prepared order holds 10 units', (await prisma.readyStock.findFirst({ where: { model_code: 'M1' } }))?.reserved_quantity === 10);
  let r = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED }));
  let db = await rows(o.id);
  check('1. cancel unshipped (no disposition needed) → 200', r.status === 200, r.body);
  check('1. reservation released, stock untouched', (await prisma.readyStock.findFirst({ where: { model_code: 'M1' } }))?.reserved_quantity === 0 && (await stockQty('M1', 'أسود')) === 100);
  check('1. no ledger rows invented; one cancellation record (not shipped)', db.movements.length === 0 && db.collections.length === 0 && db.cancellations.length === 1 && db.cancellations[0].was_shipped === false && db.sale?.cancel_disposition === null, db);

  // ───────── 2. unshipped WITH a deposit ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: PREPARED, deposit_paid: 1000 }))).body;
  const before2 = await dash();
  await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, deposit_paid: 1000 }));
  const after2 = await dash();
  check('2. deposit stays in cash after cancelling (status change is not a refund)', after2.cash_on_hand === before2.cash_on_hand && after2.cash_on_hand === 1000, { before: before2.cash_on_hand, after: after2.cash_on_hand });
  check('2. refund liability shown: 1,000 owed back to the customer', after2.cancelled_orders?.customer_credit_due === 1000 && after2.advances_on_canceled_orders === 1000, after2.cancelled_orders);
  const k2 = `e2e-refund-${Date.now()}`;
  let rf = await api('POST', `/sales/${o.id}/refunds`, { kind: 'customer_refund', amount: 400, idempotency_key: k2, note: 'جزء' });
  check('2. real partial refund 400 recorded (201)', rf.status === 201 && rf.body.obligations?.customer_credit_due === 600, rf);
  const rfAgain = await api('POST', `/sales/${o.id}/refunds`, { kind: 'customer_refund', amount: 400, idempotency_key: k2 });
  check('2. retry with the same key creates nothing (200 duplicate)', rfAgain.status === 200 && rfAgain.body.duplicate === true && (await prisma.returnItem.count({ where: { order_number: o.order_number } })) === 1, rfAgain);
  check('2. refunding more than the deposit left is refused (400)', (await api('POST', `/sales/${o.id}/refunds`, { kind: 'customer_refund', amount: 700, idempotency_key: k2 + 'b' })).status === 400);
  const mid2 = await dash();
  check('2. cash fell by exactly the refund (1,000 → 600)', mid2.cash_on_hand === 600 && mid2.total_out === 400, { cash: mid2.cash_on_hand, out: mid2.total_out });
  await api('POST', `/sales/${o.id}/refunds`, { kind: 'customer_refund', amount: 600, idempotency_key: k2 + 'c' });
  const end2 = await dash();
  check('2. fully refunded → cash 0, liability 0', end2.cash_on_hand === 0 && end2.cancelled_orders?.customer_credit_due === 0, end2.cancelled_orders);
  const live = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT }))).body;
  check('2. refunds are only for cancelled orders (400 otherwise)', (await api('POST', `/sales/${live.id}/refunds`, { kind: 'customer_refund', amount: 1, idempotency_key: 'xxxxxxxx-live' })).status === 400);

  // ───────── 3. shipped, shipping company has not paid ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT, deposit_paid: 1000 }))).body;
  const shipped3 = await dash();
  check('3. before: receivable 7,500, COGS 6,000, recognised sales 8,500', shipped3.money_owed_to_us === 7500 && shipped3.cogs === 6000 && shipped3.recognized_sales === 8500, { owed: shipped3.money_owed_to_us, cogs: shipped3.cogs });
  await prisma.readyStock.updateMany({ where: { model_code: 'M1' }, data: { cost_per_piece: 700 } });   // cost changes after shipping
  r = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, deposit_paid: 1000 }));
  check('3. cancelling a shipped order WITHOUT a disposition is refused (400) and changes nothing', r.status === 400 && (await rows(o.id)).sale?.order_status === NOT_PAID_OUT && (await rows(o.id)).movements.length === 1, r);
  r = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, deposit_paid: 1000, cancel_disposition: 'returned_resalable', cancel_reason: 'العميل رفض الاستلام' }));
  db = await rows(o.id);
  check('3. cancel with disposition returned_resalable → 200', r.status === 200 && r.body.cancellation?.goods_qty === 10 && r.body.cancellation?.goods_cost === 6000, r.body.cancellation);
  check('3. cost ledger: original SHIP kept + SHIP_REVERSAL at the ORIGINAL cost 600 (not today\'s 700)',
    db.movements.length === 2 && db.movements[0].movement_type === 'SHIP' && db.movements[1].movement_type === 'SHIP_REVERSAL' && db.movements[1].unit_cost === 600 && db.movements[1].total_cost === 6000, db.movements);
  const after3 = await dash();
  check('3. receivable, recognised sales and COGS reversed; deposit still cash', after3.money_owed_to_us === 0 && after3.recognized_sales === 0 && after3.cogs === 0 && after3.cash_on_hand === 1000, { owed: after3.money_owed_to_us, rec: after3.recognized_sales, cogs: after3.cogs, cash: after3.cash_on_hand });
  check('3. stock back (100) because the goods are resalable', (await stockQty('M1', 'أسود')) === 100);
  check('3. cancellation record: user, reason, linked ledger rows', db.cancellations.length === 1 && db.cancellations[0].reason === 'العميل رفض الاستلام' && db.cancellations[0].created_by === 'e2e-admin'
    && JSON.parse(db.cancellations[0].linked_movement_ids).length === 2, db.cancellations);

  // 3b. goods not returned → no stock claimed, tracked as outside
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT }))).body;
  await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, cancel_disposition: 'not_returned' }));
  const out = await dash();
  check('3b. not returned → stock stays 90 (never claims the goods are in the warehouse)', (await stockQty('M1', 'أسود')) === 90 && out.stock_value === 90 * 600 + 50 * 400, { stock: await stockQty('M1', 'أسود'), value: out.stock_value });
  check('3b. goods tracked outside: 10 pcs at historical cost 6,000', out.cancelled_orders?.goods_outside?.qty === 10 && out.cancelled_orders?.goods_outside?.cost === 6000 && out.cancelled_orders?.goods_outside?.not_returned?.orders === 1, out.cancelled_orders);
  check('3b. receivable gone, but the cost of the goods that did NOT come back stays recognised (COGS 6,000)', out.cogs === 6000 && out.money_owed_to_us === 0, { cogs: out.cogs });
  await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, cancel_disposition: 'returned_resalable' }));
  db = await rows(o.id);
  check('3b. goods later received → disposition updated: stock restored once, no ledger duplication', (await stockQty('M1', 'أسود')) === 100 && db.movements.length === 2 && db.cancellations.length === 1 && db.cancellations[0].disposition === 'returned_resalable', db.cancellations);
  const outAfter = await dash();
  check('3b. nothing outside any more, COGS reversed once at the recorded cost', outAfter.cancelled_orders?.goods_outside?.qty === 0 && outAfter.cogs === 0 && db.movements[1].unit_cost === 600, outAfter.cancelled_orders);

  // ───────── 4. cancel after FULL collection ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: PAID_OUT, deposit_paid: 1000, shipping_collected: 7500, shipping_collected_date: '2026-10-05' }))).body;
  const paid = await dash();
  const colBefore = (await rows(o.id)).collections.map(c => [c.amount, c.kind]);
  r = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, deposit_paid: 1000, cancel_disposition: 'returned_resalable' }));
  db = await rows(o.id);
  const cancelled4 = await dash();
  check('4. full collection: cancel → 200', r.status === 200, r.body);
  check('4. collection history untouched (no reversal row) and the money stays cash', JSON.stringify(db.collections.map(c => [c.amount, c.kind])) === JSON.stringify(colBefore) && db.sale?.shipping_collected === 7500 && cancelled4.cash_on_hand === paid.cash_on_hand && cancelled4.cash_on_hand === 8500, { cash: cancelled4.cash_on_hand });
  check('4. amount owed back to the shipping company = 7,500', cancelled4.shipping_repayment_due === 7500 && cancelled4.cancelled_orders?.shipping_repayment_due === 7500, cancelled4.cancelled_orders);
  const k4 = `e2e-repay-${Date.now()}`;
  const rp = await api('POST', `/sales/${o.id}/refunds`, { kind: 'shipping_repayment', amount: 7500, date: '2026-10-20', idempotency_key: k4 });
  db = await rows(o.id);
  const repaid = await dash();
  check('4. real repayment recorded as a ledger row (−7,500, kind repayment); original kept', rp.status === 201 && db.collections.length === 2 && db.collections[1].amount === -7500 && db.collections[1].kind === 'repayment' && db.sale?.shipping_collected === 0, db.collections);
  check('4. cash fell by the repayment only (8,500 → 1,000)', repaid.cash_on_hand === 1000 && repaid.shipping_repayment_due === 0, { cash: repaid.cash_on_hand });
  check('4. repayment retry (same key) creates nothing', (await api('POST', `/sales/${o.id}/refunds`, { kind: 'shipping_repayment', amount: 7500, idempotency_key: k4 })).body.duplicate === true && (await rows(o.id)).collections.length === 2);
  check('4. repaying more than is held is refused (400)', (await api('POST', `/sales/${o.id}/refunds`, { kind: 'shipping_repayment', amount: 1, idempotency_key: k4 + 'z' })).status === 400);

  // ───────── 5. partially collected ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: PAID_OUT, shipping_collected: 8200, shipping_collected_date: '2026-10-05' }))).body;
  check('5. before: 300 gap is a receivable', (await dash()).money_owed_to_us === 300);
  await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, cancel_disposition: 'returned_resalable' }));
  const p5 = await dash();
  check('5. after cancel: gap no longer a receivable; 8,200 stays cash and is owed back', p5.money_owed_to_us === 0 && p5.cash_on_hand === 8200 && p5.shipping_repayment_due === 8200, { owed: p5.money_owed_to_us, cash: p5.cash_on_hand });

  // ───────── 6. multiple models and colours ─────────
  await reset();
  const lines: Line[] = [{ code: 'M1', qty: 5, color: 'أسود' }, { code: 'M2', qty: 7, color: 'أبيض' }];
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT, invoice_value: 9000, lines }))).body;
  check('6. multi-line order shipped: stock 95 / 43', (await stockQty('M1', 'أسود')) === 95 && (await stockQty('M2', 'أبيض')) === 43);
  r = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, invoice_value: 9000, lines, cancel_disposition: 'returned_resalable' }));
  db = await rows(o.id);
  const reversal = db.movements.filter(m => m.movement_type === 'SHIP_REVERSAL').map(m => [m.model_code, m.color, m.qty, m.unit_cost]).sort();
  check('6. every line reversed at its own historical cost; stock fully restored', r.status === 200 && JSON.stringify(reversal) === JSON.stringify([['M1', 'أسود', 5, 600], ['M2', 'أبيض', 7, 400]].sort()) && (await stockQty('M1', 'أسود')) === 100 && (await stockQty('M2', 'أبيض')) === 50, reversal);
  check('6. editing quantities of a cancelled shipped order is refused', (await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, invoice_value: 9000, lines: [{ code: 'M1', qty: 99, color: 'أسود' }], cancel_disposition: 'returned_resalable' }))).status === 400);

  // ───────── 7. repeated submissions ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: PAID_OUT, deposit_paid: 500, shipping_collected: 8000, shipping_collected_date: '2026-10-05' }))).body;
  const cancelBody = payload({ order_number: o.order_number, order_status: CANCELED, deposit_paid: 500, cancel_disposition: 'returned_resalable' });
  await api('PUT', `/sales/${o.id}`, cancelBody);
  const snapRows = JSON.stringify(await rows(o.id));
  const snapDash = JSON.stringify(((d) => ({ cash: d.cash_on_hand, owed: d.money_owed_to_us, cogs: d.cogs, rec: d.recognized_sales, stock: d.stock_value }))(await dash()));
  for (let i = 0; i < 4; i++) await api('PUT', `/sales/${o.id}`, cancelBody);
  const same = JSON.stringify(await rows(o.id)) === snapRows;
  const sameDash = JSON.stringify(((d) => ({ cash: d.cash_on_hand, owed: d.money_owed_to_us, cogs: d.cogs, rec: d.recognized_sales, stock: d.stock_value }))(await dash())) === snapDash;
  check('7. five identical cancellations leave every ledger row and balance exactly as after the first', same && sameDash, { same, sameDash });

  // ───────── reopen ─────────
  const blocked = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: NOT_PAID_OUT, deposit_paid: 500 }));
  check('reopen: a cancelled order still holding shipping-company money cannot be reopened to unpaid (400)', blocked.status === 400 && /محفوظ/.test(String(blocked.body.message)), blocked);
  const reopened = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: PAID_OUT, deposit_paid: 500, shipping_collected: 8000 }));
  db = await rows(o.id);
  check('reopen: reopening to «تم الصرف» ships again with NEW movements; originals + reversal kept', reopened.status === 200 && JSON.stringify(db.movements.map(m => m.movement_type)) === JSON.stringify(['SHIP', 'SHIP_REVERSAL', 'SHIP']) && db.cancellations[0].reopened_at !== null && db.sale?.cancel_disposition === null && db.collections.length === 1, { moves: db.movements.map(m => m.movement_type), reopened: db.cancellations[0]?.reopened_at });
  check('reopen: stock deducted again exactly once (90)', (await stockQty('M1', 'أسود')) === 90);

  // ───────── 10. seasons + authorisation ─────────
  const second = await prisma.season.create({ data: { name: 'Winter E2E', year: 2099, type: 'Winter', status: 'inactive', is_active: false } });
  const otherSeason = await api('GET', '/dashboard', undefined, { season: second.id });
  check('10. another season sees none of these cancellations, stock or cash', otherSeason.body.cancelled_orders?.count === 0 && otherSeason.body.cash_on_hand === 0 && otherSeason.body.stock_value === 0, otherSeason.body.cancelled_orders);
  const asOther = await api('GET', `/sales/${o.id}/ledger`, undefined, { season: second.id });
  check('10. an order of another season cannot be read through this season (404)', asOther.status === 404, asOther);
  const cancelOtherSeason = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, cancel_disposition: 'returned_resalable' }), { season: second.id });
  check('10. …nor cancelled through it (404)', cancelOtherSeason.status === 404, cancelOtherSeason);
  const noPerm = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, cancel_disposition: 'returned_resalable' }), { token: viewerToken });
  check('10. a user without sales.edit cannot cancel (403)', noPerm.status === 403, noPerm);
  const noPermRefund = await api('POST', `/sales/${o.id}/refunds`, { kind: 'customer_refund', amount: 1, idempotency_key: 'viewer-attempt-1' }, { token: viewerToken });
  check('10. …nor record a refund (403)', noPermRefund.status === 403, noPermRefund);
  check('10. nothing changed by the rejected attempts', (await rows(o.id)).sale?.order_status === PAID_OUT);
  await prisma.financialSnapshot.deleteMany({ where: { season_id: second.id } });
  await prisma.season.delete({ where: { id: second.id } });

  // ───────── L. Dashboard vs Financial Center agree after a partial cancellation ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT }))).body;
  await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, cancel_disposition: 'returned_resalable', cancel_returned_qty: [6] }));
  const dL = await dash();
  const fcL = (await api('GET', '/financial-center')).body;
  check('L. Dashboard and Financial Center agree on stock value (96 × 600 + 50 × 400) and on receivables after a partial cancellation', dL.stock_value === 96 * 600 + 50 * 400 && fcL.stock_value === dL.stock_value && fcL.money_owed_to_us === dL.money_owed_to_us, { dash: dL.stock_value, fc: fcL.stock_value });

  // ───────── J. partial return (per line) ─────────
  await reset();
  const jl: Line[] = [{ code: 'M1', qty: 10, color: 'أسود' }, { code: 'M2', qty: 6, color: 'أبيض' }];
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT, invoice_value: 9000, lines: jl }))).body;
  const jp = await api('GET', `/sales/${o.id}/cancellation-preview`);
  check('J. preview (server-computed): lines with shipped qty and recorded unit cost; receivable 9,000', jp.status === 200 && jp.body.lines.length === 2 && jp.body.lines[0].recorded_unit_cost === 600 && jp.body.money.outstanding_shipping_receivable === 9000, jp.body);
  const jbad = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, invoice_value: 9000, lines: jl, cancel_disposition: 'returned_resalable', cancel_returned_qty: [11, 6] }));
  check('J. returned qty above what shipped is refused (400) and nothing changes', jbad.status === 400 && (await rows(o.id)).sale?.order_status === NOT_PAID_OUT && (await rows(o.id)).movements.length === 2, jbad);
  const jr = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, invoice_value: 9000, lines: jl, cancel_disposition: 'returned_resalable', cancel_returned_qty: [7, 6] }));
  db = await rows(o.id);
  const jd = await dash();
  check('J. partial return: 7 of 10 (M1) and 6 of 6 (M2) restored; 3 pieces stay outside', jr.status === 200 && (await stockQty('M1', 'أسود')) === 97 && (await stockQty('M2', 'أبيض')) === 50, jr.body);
  check('J. COGS keeps the 3 unreturned pieces at their recorded cost (1,800); goods outside = 3 pcs / 1,800', jd.cogs === 1800 && jd.cancelled_orders?.goods_outside?.qty === 3 && jd.cancelled_orders?.goods_outside?.cost === 1800, { cogs: jd.cogs, out: jd.cancelled_orders?.goods_outside });
  check('J. the reversal rows reference the original cost per line; originals kept', db.movements.filter(m => m.movement_type === 'SHIP').length === 2 && db.movements.filter(m => m.movement_type === 'SHIP_REVERSAL').map(m => [m.model_code, m.qty, m.unit_cost]).sort().join('|') === 'M1,7,600|M2,6,400', db.movements);
  check('J. audit row stores restored_qty 13', db.cancellations[0].restored_qty === 13, db.cancellations[0]);
  await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, invoice_value: 9000, lines: jl, cancel_disposition: 'returned_resalable', cancel_returned_qty: [10, 6] }));
  check('J. remaining pieces arrive later → restored once (stock 100), COGS 0', (await stockQty('M1', 'أسود')) === 100 && (await dash()).cogs === 0);
  const nMov = (await rows(o.id)).movements.length;
  await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, invoice_value: 9000, lines: jl, cancel_disposition: 'returned_resalable', cancel_returned_qty: [10, 6] }));
  check('J. repeating the same save adds no rows', (await rows(o.id)).movements.length === nMov);

  // ───────── refund paid together with the cancellation — atomic ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT, deposit_paid: 1000 }))).body;
  const beforeAtomic = JSON.stringify(await rows(o.id));
  const tooMuch = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, deposit_paid: 1000, cancel_disposition: 'returned_resalable', refund_customer_now: 5000, refund_key: 'e2e-atomic-refund-1' }));
  check('ATOMIC. refunding more than the deposit inside the cancel save is refused (400)', tooMuch.status === 400, tooMuch);
  check('ATOMIC. …and the WHOLE cancellation rolled back: status, movements, cancellation rows, refunds unchanged', JSON.stringify(await rows(o.id)) === beforeAtomic && (await prisma.returnItem.count({ where: { order_number: o.order_number } })) === 0 && (await stockQty('M1', 'أسود')) === 90);
  const ok = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, deposit_paid: 1000, cancel_disposition: 'returned_resalable', refund_customer_now: 400, refund_key: 'e2e-atomic-refund-2' }));
  const okDash = await dash();
  check('ATOMIC. a valid refund-now: cancelled + refund recorded together; cash 1,000 → 600; 600 still owed', ok.status === 200 && okDash.cash_on_hand === 600 && okDash.cancelled_orders?.customer_credit_due === 600, { cash: okDash.cash_on_hand, c: okDash.cancelled_orders });
  await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: CANCELED, deposit_paid: 1000, cancel_disposition: 'returned_resalable', refund_customer_now: 400, refund_key: 'e2e-atomic-refund-2' }));
  check('ATOMIC. the same request repeated refunds nothing twice (cash still 600)', (await dash()).cash_on_hand === 600 && (await prisma.returnItem.count({ where: { order_number: o.order_number } })) === 1);
  check('ATOMIC. audit row records the refund paid (400)', (await rows(o.id)).cancellations[0].refund_customer_paid === 400);

  // ───────── client-account invoice of the cancelled order is reversed once ─────────
  await reset();
  const acct = await prisma.clientAccount.create({ data: { season_id: (await prisma.sale.findFirst({ select: { season_id: true } }))?.season_id ?? (await prisma.season.findFirst({ where: { is_active: true } }))!.id, date: '2026-10-05', client_name: 'عميل آجل', total_amount: 3000, remaining: 3000 } });
  o = (await api('POST', '/sales', payload({ order_status: PREPARED, order_number: 'ACC-1' }))).body;
  const inv = await prisma.clientAccountInvoice.create({ data: { season_id: acct.season_id, account_id: acct.id, date: '2026-10-05', order_number: 'ACC-1', amount: 3000 } });
  await api('PUT', `/sales/${o.id}`, payload({ order_number: 'ACC-1', order_status: CANCELED }));
  await api('PUT', `/sales/${o.id}`, payload({ order_number: 'ACC-1', order_status: CANCELED }));
  const invs = await prisma.clientAccountInvoice.findMany({ where: { account_id: acct.id }, orderBy: { id: 'asc' } });
  const acctAfter = await prisma.clientAccount.findUnique({ where: { id: acct.id } });
  check('INVOICE. one negative reversal row referencing the original; original kept; account balance reduced once', invs.length === 2 && invs[1].amount === -3000 && invs[1].notes.includes(`[reversal-of:${inv.id}]`) && acctAfter?.total_amount === 0 && acctAfter?.remaining === 0, { invs, acctAfter });
  check('INVOICE. cancellation audit row links the invoice', JSON.parse((await rows(o.id)).cancellations[0].linked_invoice_ids).includes(inv.id));
  await prisma.clientAccountInvoice.deleteMany({ where: { account_id: acct.id } }); await prisma.clientAccount.delete({ where: { id: acct.id } });


  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
