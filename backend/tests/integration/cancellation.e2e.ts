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

  const cancelBody = (o: Json, extra: Json = {}) => payload({ order_number: o.order_number, order_status: CANCELED, ...extra });
  const dashSnap = async () => { const d = await dash(); return JSON.stringify({ cash: d.cash_on_hand, owed: d.money_owed_to_us, cogs: d.cogs, rec: d.recognized_sales, stock: d.stock_value }); };

  // ───────── A. cancel a RESERVED order (no deposit) ─────────
  await reset();
  let o = (await api('POST', '/sales', payload({ order_status: PREPARED }))).body;
  check('A. reserved order holds 10 units', (await prisma.readyStock.findFirst({ where: { model_code: 'M1' } }))?.reserved_quantity === 10);
  let r = await api('PUT', `/sales/${o.id}`, cancelBody(o));
  let db = await rows(o.id);
  check('A. cancel needs no condition / quantity / refund field → 200', r.status === 200, r.body);
  check('A. reservation released, stock untouched, no ledger rows invented', (await prisma.readyStock.findFirst({ where: { model_code: 'M1' } }))?.reserved_quantity === 0 && (await stockQty('M1', 'أسود')) === 100 && db.movements.length === 0 && db.collections.length === 0 && db.cancellations.length === 1 && db.cancellations[0].was_shipped === false, db);

  // ───────── B. reserved WITH a deposit: reversed with the order, no liability ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: PREPARED, deposit_paid: 1000 }))).body;
  check('B. before: the deposit is cash (1,000)', (await dash()).cash_on_hand === 1000);
  await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 1000 }));
  const b2 = await dash();
  db = await rows(o.id);
  check('B. deposit reversed with the order: cash 0, no refund liability, nothing paid out', b2.cash_on_hand === 0 && b2.total_out === 0 && b2.cancelled_orders?.customer_credit_due === 0 && b2.advances_on_canceled_orders === 0, { cash: b2.cash_on_hand, out: b2.total_out, c: b2.cancelled_orders });
  check('B. the reversed amount stays in the cancellation record (audit)', db.cancellations[0].deposit_held === 1000 && db.sale?.deposit_paid === 0, db.cancellations[0]);
  await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 1000 }));   // a stale form cannot bring the deposit back
  check('B. a repeated save with the old deposit value changes nothing', (await dash()).cash_on_hand === 0 && (await rows(o.id)).sale?.deposit_paid === 0);

  // ───────── C. shipped, not yet paid out (with deposit) ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT, deposit_paid: 1000 }))).body;
  const shipped3 = await dash();
  check('C. before: receivable 7,500, COGS 6,000, recognised sales 8,500', shipped3.money_owed_to_us === 7500 && shipped3.cogs === 6000 && shipped3.recognized_sales === 8500, { owed: shipped3.money_owed_to_us, cogs: shipped3.cogs });
  await prisma.readyStock.updateMany({ where: { model_code: 'M1' }, data: { cost_per_piece: 700 } });   // cost changes after shipping
  r = await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 1000, cancel_reason: 'العميل رفض الاستلام' }));
  db = await rows(o.id);
  check('C. cancel → 200 with no extra fields', r.status === 200 && r.body.cancellation?.goods_qty === 10 && r.body.cancellation?.goods_cost === 6000, r.body.cancellation);
  check('C. cost ledger: original SHIP kept + SHIP_REVERSAL at the ORIGINAL cost 600 (not today\'s 700)',
    db.movements.length === 2 && db.movements[0].movement_type === 'SHIP' && db.movements[1].movement_type === 'SHIP_REVERSAL' && db.movements[1].unit_cost === 600 && db.movements[1].total_cost === 6000, db.movements);
  const after3 = await dash();
  check('C. receivable, recognised sales, COGS and cash (deposit) all back to 0', after3.money_owed_to_us === 0 && after3.recognized_sales === 0 && after3.cogs === 0 && after3.cash_on_hand === 0, { owed: after3.money_owed_to_us, rec: after3.recognized_sales, cogs: after3.cogs, cash: after3.cash_on_hand });
  check('C. the whole order is back in stock (100)', (await stockQty('M1', 'أسود')) === 100);
  check('C. cancellation record: user, reason, linked ledger rows, restored qty', db.cancellations.length === 1 && db.cancellations[0].reason === 'العميل رفض الاستلام' && db.cancellations[0].created_by === 'e2e-admin'
    && JSON.parse(db.cancellations[0].linked_movement_ids).length === 2 && db.cancellations[0].restored_qty === 10 && db.cancellations[0].revenue_reversed === 8500 && db.cancellations[0].receivable_reversed === 7500, db.cancellations);

  // ───────── C2. returned-goods fields from an old client are ignored ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT }))).body;
  await api('PUT', `/sales/${o.id}`, cancelBody(o, { cancel_disposition: 'not_returned', cancel_returned_qty: [2], refund_customer_now: 999, refund_key: 'ignored-by-server' }));
  db = await rows(o.id);
  check('C2. a stale client sending disposition / returned qty / refund fields still gets the whole order back and no refund', (await stockQty('M1', 'أسود')) === 100 && (await dash()).cogs === 0 && (await prisma.returnItem.count()) === 0 && db.sale?.cancel_disposition === 'returned_resalable', db.sale);

  // ───────── D. paid out (fully collected) ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: PAID_OUT, deposit_paid: 1000, shipping_collected: 7500, shipping_collected_date: '2026-10-05' }))).body;
  const paid = await dash();
  check('D. before: cash 8,500', paid.cash_on_hand === 8500);
  r = await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 1000 }));
  db = await rows(o.id);
  const cancelled4 = await dash();
  check('D. cancel → 200', r.status === 200, r.body);
  check('D. collection history kept + ONE reversal row (−7,500) in the month it was received; cached total 0', db.collections.length === 2 && db.collections[0].amount === 7500 && db.collections[1].amount === -7500 && db.collections[1].kind === 'reversal' && db.collections[1].collected_date === '2026-10-05' && db.sale?.shipping_collected === 0, db.collections);
  check('D. cash back to 0, no refund liability, no receivable, stock restored', cancelled4.cash_on_hand === 0 && cancelled4.shipping_repayment_due === 0 && cancelled4.money_owed_to_us === 0 && (await stockQty('M1', 'أسود')) === 100, { cash: cancelled4.cash_on_hand });
  check('D. audit record keeps the reversed amounts', db.cancellations[0].collected_held === 7500 && db.cancellations[0].deposit_held === 1000, db.cancellations[0]);
  const snapRows = JSON.stringify(await rows(o.id)); const snapDash = await dashSnap();
  for (let i = 0; i < 4; i++) await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 1000 }));
  check('D. five identical saves leave every ledger row and balance exactly as after the first', JSON.stringify(await rows(o.id)) === snapRows && (await dashSnap()) === snapDash);

  // ───────── E. partially collected ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: PAID_OUT, shipping_collected: 8200, shipping_collected_date: '2026-10-05' }))).body;
  check('E. before: 300 gap is a receivable', (await dash()).money_owed_to_us === 300);
  await api('PUT', `/sales/${o.id}`, cancelBody(o));
  const p5 = await dash();
  check('E. after: gap is no longer a receivable, collected part reversed, cash 0', p5.money_owed_to_us === 0 && p5.cash_on_hand === 0 && (await rows(o.id)).collections.map(c => c.amount).join() === '8200,-8200', { owed: p5.money_owed_to_us, cash: p5.cash_on_hand });

  // ───────── F. 'حساب عميل' order ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: 'حساب عميل' }))).body;
  const f1 = await stockQty('M1', 'أسود');
  r = await api('PUT', `/sales/${o.id}`, cancelBody(o));
  check('F. a «حساب عميل» order is cancelled the same way: stock back, receivable 0', r.status === 200 && f1 === 90 && (await stockQty('M1', 'أسود')) === 100 && (await dash()).money_owed_to_us === 0, r.body);

  // ───────── G. multiple models and colours ─────────
  await reset();
  const lines: Line[] = [{ code: 'M1', qty: 5, color: 'أسود' }, { code: 'M2', qty: 7, color: 'أبيض' }];
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT, invoice_value: 9000, lines }))).body;
  check('G. multi-line order shipped: stock 95 / 43', (await stockQty('M1', 'أسود')) === 95 && (await stockQty('M2', 'أبيض')) === 43);
  r = await api('PUT', `/sales/${o.id}`, cancelBody(o, { invoice_value: 9000, lines }));
  db = await rows(o.id);
  const reversal = db.movements.filter(m => m.movement_type === 'SHIP_REVERSAL').map(m => [m.model_code, m.color, m.qty, m.unit_cost]).sort();
  check('G. every line reversed at its own historical cost; stock fully restored', r.status === 200 && JSON.stringify(reversal) === JSON.stringify([['M1', 'أسود', 5, 600], ['M2', 'أبيض', 7, 400]].sort()) && (await stockQty('M1', 'أسود')) === 100 && (await stockQty('M2', 'أبيض')) === 50, reversal);
  check('G. editing quantities of a cancelled order is refused', (await api('PUT', `/sales/${o.id}`, cancelBody(o, { invoice_value: 9000, lines: [{ code: 'M1', qty: 99, color: 'أسود' }] }))).status === 400);

  // ───────── H. atomicity: a failure in the middle rolls EVERYTHING back ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: PAID_OUT, deposit_paid: 500, shipping_collected: 8000, shipping_collected_date: '2026-10-05' }))).body;
  const beforeFail = JSON.stringify(await rows(o.id)); const dashBefore = await dashSnap();
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION e2e_fail_cancel() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'e2e forced failure'; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER e2e_fail_cancel_trg BEFORE INSERT ON order_cancellations FOR EACH ROW EXECUTE FUNCTION e2e_fail_cancel()`);
  const failed500 = await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 500 }));
  await prisma.$executeRawUnsafe(`DROP TRIGGER e2e_fail_cancel_trg ON order_cancellations`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION e2e_fail_cancel()`);
  check('H. a database failure while recording the cancellation → error response', failed500.status === 500, failed500);
  check('H. …and NOTHING changed: status, stock, reversal rows, collections, deposit and dashboard are exactly as before', JSON.stringify(await rows(o.id)) === beforeFail && (await dashSnap()) === dashBefore);
  const retry = await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 500 }));
  check('H. retrying afterwards succeeds and reverses everything once', retry.status === 200 && (await dash()).cash_on_hand === 0 && (await rows(o.id)).movements.filter(m => m.movement_type === 'SHIP_REVERSAL').length === 1);

  // ───────── reopen ─────────
  const reopened = await api('PUT', `/sales/${o.id}`, payload({ order_number: o.order_number, order_status: PAID_OUT, deposit_paid: 500, shipping_collected: 8000 }));
  db = await rows(o.id);
  check('reopen: reopening ships again with NEW movements; originals + reversal kept', reopened.status === 200 && JSON.stringify(db.movements.map(m => m.movement_type)) === JSON.stringify(['SHIP', 'SHIP_REVERSAL', 'SHIP']) && db.cancellations[0].reopened_at !== null && db.sale?.cancel_disposition === null, { moves: db.movements.map(m => m.movement_type) });
  check('reopen: stock deducted again exactly once (90)', (await stockQty('M1', 'أسود')) === 90);
  const reopenedOrder = o;

  // ───────── client-account invoice of the cancelled order is reversed once ─────────
  await reset();
  const acct = await prisma.clientAccount.create({ data: { season_id: (await prisma.season.findFirst({ where: { is_active: true } }))!.id, date: '2026-10-05', client_name: 'عميل آجل', total_amount: 3000, remaining: 3000 } });
  o = (await api('POST', '/sales', payload({ order_status: PREPARED, order_number: 'ACC-1' }))).body;
  const inv = await prisma.clientAccountInvoice.create({ data: { season_id: acct.season_id, account_id: acct.id, date: '2026-10-05', order_number: 'ACC-1', amount: 3000 } });
  await api('PUT', `/sales/${o.id}`, payload({ order_number: 'ACC-1', order_status: CANCELED }));
  await api('PUT', `/sales/${o.id}`, payload({ order_number: 'ACC-1', order_status: CANCELED }));
  const invs = await prisma.clientAccountInvoice.findMany({ where: { account_id: acct.id }, orderBy: { id: 'asc' } });
  const acctAfter = await prisma.clientAccount.findUnique({ where: { id: acct.id } });
  check('INVOICE. one negative reversal row referencing the original; original kept; balance reduced once; unrelated rows untouched', invs.length === 2 && invs[1].amount === -3000 && invs[1].notes.includes(`[reversal-of:${inv.id}]`) && acctAfter?.total_amount === 0 && acctAfter?.remaining === 0, { invs, acctAfter });
  check('INVOICE. cancellation audit row links the invoice', JSON.parse((await rows(o.id)).cancellations[0].linked_invoice_ids).includes(inv.id));
  await prisma.clientAccountInvoice.deleteMany({ where: { account_id: acct.id } }); await prisma.clientAccount.delete({ where: { id: acct.id } });

  // ───────── L. Dashboard vs Financial Center ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT, deposit_paid: 300 }))).body;
  await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 300 }));
  const dL = await dash();
  const fcL = (await api('GET', '/financial-center')).body;
  check('L. Dashboard and Financial Center agree after a cancellation (stock 100 × 600 + 50 × 400, receivable 0)', dL.stock_value === 100 * 600 + 50 * 400 && fcL.stock_value === dL.stock_value && fcL.money_owed_to_us === 0 && dL.money_owed_to_us === 0, { dash: dL.stock_value, fc: fcL.stock_value });

  // ───────── LEGACY: cancelled by an earlier version (goods "not returned", deposit + collection still held) ─────────
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: PAID_OUT, deposit_paid: 1000, shipping_collected: 7500, shipping_collected_date: '2026-10-05' }))).body;
  // what the old rule left behind: status cancelled, goods outside, cost already reversed, money untouched
  await prisma.sale.update({ where: { id: o.id }, data: { order_status: CANCELED, cancel_disposition: 'not_returned' } });
  const shipRow = (await rows(o.id)).movements[0];
  await prisma.inventoryMovement.create({ data: { season_id: shipRow.season_id, sale_id: o.id, stock_id: shipRow.stock_id, movement_type: 'SHIP_REVERSAL', model_code: shipRow.model_code, color: shipRow.color, qty: shipRow.qty, unit_cost: shipRow.unit_cost, total_cost: shipRow.total_cost, reference: 'legacy', created_by: 'legacy' } });
  check('LEGACY. before: the stock is NOT back (90) and cash still holds 8,500', (await stockQty('M1', 'أسود')) === 90 && (await dash()).cash_on_hand === 8500);
  r = await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 1000 }));
  db = await rows(o.id);
  const legacyDash = await dash();
  check('LEGACY. saving it again restores the stock (100) on the Dashboard', r.status === 200 && (await stockQty('M1', 'أسود')) === 100 && legacyDash.stock_value === 100 * 600 + 50 * 400, { status: r.status, stock: await stockQty('M1', 'أسود') });
  check('LEGACY. cost not reversed twice (1 reversal), collection reversed once, deposit reversed, cash 0', db.movements.filter(m => m.movement_type === 'SHIP_REVERSAL').length === 1 && db.collections.map(c => c.amount).join() === '7500,-7500' && db.sale?.deposit_paid === 0 && legacyDash.cash_on_hand === 0, { moves: db.movements.length, cols: db.collections.map(c => c.amount) });
  const rs = (await api('GET', '/ready-stock')).body as { model_code: string; reserved_quantity: number }[];
  check('LEGACY. the Ready Stock endpoint shows nothing reserved or deducted for it', rs.every(x => x.reserved_quantity === 0));
  const snapLegacy = JSON.stringify(await rows(o.id)); const snapLegacyDash = await dashSnap();
  for (let i = 0; i < 3; i++) await api('PUT', `/sales/${o.id}`, cancelBody(o, { deposit_paid: 1000 }));
  check('LEGACY. saving it three more times restores / reverses nothing more', JSON.stringify(await rows(o.id)) === snapLegacy && (await dashSnap()) === snapLegacyDash && (await stockQty('M1', 'أسود')) === 100);

  // ───────── seasons + authorisation ─────────
  o = reopenedOrder;
  await reset();
  o = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT }))).body;
  const second = await prisma.season.create({ data: { name: 'Winter E2E', year: 2099, type: 'Winter', status: 'inactive', is_active: false } });
  const otherSeason = await api('GET', '/dashboard', undefined, { season: second.id });
  check('seasons: another season sees none of these cancellations, stock or cash', otherSeason.body.cancelled_orders?.count === 0 && otherSeason.body.cash_on_hand === 0 && otherSeason.body.stock_value === 0, otherSeason.body.cancelled_orders);
  check('seasons: an order of another season cannot be read (404) …', (await api('GET', `/sales/${o.id}/ledger`, undefined, { season: second.id })).status === 404);
  check('seasons: … nor cancelled through it (404)', (await api('PUT', `/sales/${o.id}`, cancelBody(o), { season: second.id })).status === 404);
  const noPerm = await api('PUT', `/sales/${o.id}`, cancelBody(o), { token: viewerToken });
  check('auth: a user without sales.edit cannot cancel (403)', noPerm.status === 403, noPerm);
  check('auth: nothing changed by the rejected attempts', (await rows(o.id)).sale?.order_status === NOT_PAID_OUT);
  await prisma.financialSnapshot.deleteMany({ where: { season_id: second.id } });
  await prisma.season.delete({ where: { id: second.id } });

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
