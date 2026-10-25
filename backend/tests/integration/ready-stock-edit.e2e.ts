// End-to-end check of the Ready Stock page actions (reservation view / reconciliation, production entry and correction) against a REAL backend + Postgres.
//   Run:   E2E_BASE_URL=http://localhost:3911 DATABASE_URL=... JWT_SECRET=... npm run test:e2e:stock
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

const dash = async () => (await api('GET', '/dashboard')).body;
async function reset() {
  await prisma.modelPart.deleteMany({}); await prisma.modelProduction.deleteMany({}); await prisma.cuttingOrder.deleteMany({});
  await prisma.sale.deleteMany({}); await prisma.returnItem.deleteMany({}); await prisma.readyStock.deleteMany({});
  await prisma.paymentLog.deleteMany({}); await prisma.expenseRevenue.deleteMany({});
}
// the stock figures of one row, from the same derivation the page uses (actual = available + reserved)
const row = async (id: number) => {
  const r = (await api('GET', `/ready-stock/${id}/reservations`)).body;
  const prod = (await api('GET', `/ready-stock/${id}/production`)).body;
  return { ...r, actual_balance: r.actual, available_quantity: r.available, reserved_quantity: r.reserved, pending_quantity: r.pending, new_production: (prod.entries as Json[]).reduce((n, e) => n + e.qty_received, 0) };
};
const sale = (no: string, qty: number, status: string, invoice = qty * 100) => ({
  order_number: no, marketer: 'm', client: 'عميل', mobile: '', model1_code: '1001', model1_qty: qty, model1_color: 'شانيه',
  model2_code: '', model2_qty: 0, model2_color: '', model3_code: '', model3_qty: 0, model3_color: '', model4_code: '', model4_qty: 0, model4_color: '', model5_code: '', model5_qty: 0, model5_color: '',
  invoice_value: invoice, deposit_paid: 0, deposit_receiver: '', shipping_number: '', order_status: status, delivery_method: 'ايرجنت', warehouse: '', shipping_collected: 0, row_number: 1,
});

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '')) { console.error('Refusing to run: DATABASE_URL is not a localhost database.'); process.exit(2); }
  const admin = await prisma.user.upsert({ where: { username: 'e2e-admin' }, update: {}, create: { username: 'e2e-admin', password: 'x', full_name: 'e2e', role: 'admin', is_active: true } });
  token = jwt.sign({ userId: admin.id, username: admin.username, role: 'admin' }, process.env.JWT_SECRET!);
  const viewer = await prisma.user.upsert({ where: { username: 'e2e-nobody' }, update: {}, create: { username: 'e2e-nobody', password: 'x', full_name: 'no perms', role: 'viewer', is_active: true } });
  viewerToken = jwt.sign({ userId: viewer.id, username: viewer.username, role: 'viewer' }, process.env.JWT_SECRET!);

  // ───────── setup: card 1001 شانيه (opening 10), a cutting order of 100 pieces, one prepared order of 15 ─────────
  await reset();
  const season = (await prisma.season.findFirst({ where: { is_active: true } }))!.id;
  const card = (await api('POST', '/ready-stock', { model_code: '1001', product_name: 'قميص', color: 'شانيه', opening_balance: 10, cost_per_piece: 100, location: '' })).body;
  await prisma.cuttingOrder.create({ data: { season_id: season, date: '2026-10-01', cut_number: 1, cut_description: 'قصة 1', material_type: 'قطن', color: 'شانيه', total_pieces: 100 } });
  await prisma.cuttingOrder.create({ data: { season_id: season, date: '2026-10-01', cut_number: 2, cut_description: 'قصة 2', material_type: 'قطن', color: 'أسود', total_pieces: 100 } });
  const orderR = (await api('POST', '/sales', sale('R-1', 15, PREPARED))).body;

  // ───────── reserved quantity: derived, explained, reconciled — never typed over ─────────
  const res1 = await api('GET', `/ready-stock/${card.id}/reservations`);
  check('RESERVED. the breakdown shows the order holding the stock: reserved 10 of 15 requested, pending 5, available 0', res1.status === 200 && res1.body.reserved === 10 && res1.body.available === 0 && res1.body.pending === 5 && res1.body.orders.length === 1 && res1.body.orders[0].order_number === 'R-1' && res1.body.orders[0].reserved === 10 && res1.body.orders[0].pending === 5, res1.body);
  const rec1 = await api('PUT', `/ready-stock/${card.id}/reconcile-reservations`, {});
  check('RESERVED. reconciliation is safe and idempotent: same numbers on repeat, the order is untouched', rec1.status === 200 && rec1.body.after === 10 && (await api('PUT', `/ready-stock/${card.id}/reconcile-reservations`, {})).body.changed === false && (await prisma.sale.findUnique({ where: { id: orderR.id } }))?.model1_qty === 15);
  await prisma.readyStock.update({ where: { id: card.id }, data: { reserved_quantity: 999 } });   // simulate a stale cached value
  const rec2 = await api('PUT', `/ready-stock/${card.id}/reconcile-reservations`, {});
  check('RESERVED. a stale stored value (999) is corrected from the orders (→ 10), not accepted as typed', rec2.body.before === 999 && rec2.body.after === 10 && rec2.body.changed === true && (await row(card.id)).reserved_quantity === 10, rec2.body);
  const auditRec = await prisma.auditLog.findFirst({ where: { module: 'ReadyStock', record_id: String(card.id) }, orderBy: { id: 'desc' } });
  check('RESERVED. the reconciliation is in the audit log with the old and new value and the user', !!auditRec && /999/.test(auditRec.description) && auditRec.user_name === 'e2e-admin', auditRec);

  // ───────── production: a NEW entry ─────────
  const key1 = 'e2e-prod-key-0001';
  const p1 = await api('POST', `/ready-stock/${card.id}/production`, { qty: 5, cut_number: 1, idempotency_key: key1, reason: 'دفعة الصباح' });
  const after1 = await row(card.id);
  check('PRODUCTION. a new entry of 5 from cut 1 is recorded (201): stock 10 → 15, new_production 5', p1.status === 201 && after1.new_production === 5 && after1.actual_balance === 15, { p1: p1.status, after1 });
  check('PRODUCTION. availability and shortage recalculated: order R now holds all 15 (pending 0, available 0)', after1.reserved_quantity === 15 && after1.available_quantity === 0 && (after1.pending_quantity ?? 0) === 0 && (await dash()).missing_stock?.total_missing_units === 0, after1);
  const again = await api('POST', `/ready-stock/${card.id}/production`, { qty: 5, cut_number: 1, idempotency_key: key1 });
  check('PRODUCTION. repeating the same submission creates nothing (200 duplicate): still ONE entry, stock still 15', again.status === 200 && again.body.duplicate === true && (await prisma.modelProduction.count()) === 1 && (await row(card.id)).actual_balance === 15, again.body);
  const entry = await prisma.modelProduction.findFirst({});
  check('PRODUCTION. the entry belongs to the right model / colour / cut and takes the card cost; the cut\'s pieces are consumed', entry?.model_code === '1001' && entry?.color === 'شانيه' && entry?.cut_number === 1 && entry?.qty_received === 5 && entry?.qty_from_cutting === 5 && entry?.cost_per_piece === 100 && entry?.status === 'تام', entry);
  const bad = [
    ['qty 0', { qty: 0, cut_number: 1, idempotency_key: 'e2e-prod-key-bad1' }], ['qty -3', { qty: -3, cut_number: 1, idempotency_key: 'e2e-prod-key-bad2' }],
    ['qty 1.5', { qty: 1.5, cut_number: 1, idempotency_key: 'e2e-prod-key-bad3' }], ['qty text', { qty: 'x', cut_number: 1, idempotency_key: 'e2e-prod-key-bad4' }],
    ['no cut', { qty: 2, idempotency_key: 'e2e-prod-key-bad5' }], ['no key', { qty: 2, cut_number: 1 }],
    ['more than the cut holds', { qty: 500, cut_number: 1, idempotency_key: 'e2e-prod-key-bad6' }], ['a cut of another colour', { qty: 2, cut_number: 2, idempotency_key: 'e2e-prod-key-bad7' }],
  ] as const;
  const badResults = await Promise.all(bad.map(async ([label, body]) => [label, (await api('POST', `/ready-stock/${card.id}/production`, body)).status] as const));
  check('PRODUCTION. invalid input is refused in Arabic with 400 (zero, negative, fractional, text, no cut, no key, too many, wrong colour) and nothing is created', badResults.every(([, st]) => st === 400) && (await prisma.modelProduction.count()) === 1, badResults);

  // ───────── production: a CORRECTION of an existing entry ─────────
  const fix = await api('PUT', `/ready-stock/${card.id}/production/${entry!.id}`, { qty_received: 3, reason: 'العد الفعلي 3' });
  const afterFix = await row(card.id);
  check('CORRECTION. received 5 → 3 on the SAME entry: no new record, stock 15 → 13, order R re-derived (reserved 13, pending 2)', fix.status === 200 && fix.body.changed === true && (await prisma.modelProduction.count()) === 1 && afterFix.actual_balance === 13 && afterFix.reserved_quantity === 13 && afterFix.pending_quantity === 2, { fix: fix.body, afterFix });
  const fixAgain = await api('PUT', `/ready-stock/${card.id}/production/${entry!.id}`, { qty_received: 3, reason: 'العد الفعلي 3' });
  check('CORRECTION. repeating it changes nothing (changed: false)', fixAgain.status === 200 && fixAgain.body.changed === false && (await row(card.id)).actual_balance === 13);
  const auditFix = await prisma.auditLog.findFirst({ where: { module: 'ModelProduction', record_id: String(entry!.id), action: 'UPDATE' }, orderBy: { id: 'desc' } });
  check('CORRECTION. the audit log has old 5, new 3, the reason and the user', !!auditFix && /5/.test(auditFix.description) && /3/.test(auditFix.description) && /العد الفعلي/.test(auditFix.description) && auditFix.user_name === 'e2e-admin' && /5/.test(String(auditFix.before_data)) && /3/.test(String(auditFix.after_data)), auditFix);
  const noReason = await api('PUT', `/ready-stock/${card.id}/production/${entry!.id}`, { qty_received: 4, reason: '' });
  const tooMany = await api('PUT', `/ready-stock/${card.id}/production/${entry!.id}`, { qty_received: 6, reason: 'خطأ' });
  const negative = await api('PUT', `/ready-stock/${card.id}/production/${entry!.id}`, { qty_received: -1, reason: 'خطأ' });
  check('CORRECTION. missing reason, more than left the cut, and negative values are refused (400) and change nothing', noReason.status === 400 && tooMany.status === 400 && negative.status === 400 && (await prisma.modelProduction.findFirst({}))?.qty_received === 3);

  // ───────── no negative inventory from a correction ─────────
  await reset();
  const card2 = (await api('POST', '/ready-stock', { model_code: '1001', product_name: 'قميص', color: 'شانيه', opening_balance: 10, cost_per_piece: 100, location: '' })).body;
  await prisma.cuttingOrder.create({ data: { season_id: season, date: '2026-10-01', cut_number: 1, cut_description: 'قصة 1', material_type: 'قطن', color: 'شانيه', total_pieces: 100 } });
  const p2 = await api('POST', `/ready-stock/${card2.id}/production`, { qty: 5, cut_number: 1, idempotency_key: 'e2e-prod-key-0002' });
  const shipped = await api('POST', '/sales', sale('S-1', 12, NOT_PAID_OUT));
  check('NEGATIVE. setup: 12 pieces really shipped out of 15, 3 left', p2.status === 201 && shipped.body.order_status === NOT_PAID_OUT && (await row(card2.id)).actual_balance === 3, shipped.body.order_status);
  const e2 = await prisma.modelProduction.findFirst({});
  const neg = await api('PUT', `/ready-stock/${card2.id}/production/${e2!.id}`, { qty_received: 0, reason: 'تصحيح' });
  check('NEGATIVE. correcting production to 0 would make stock −2: refused (400) with an Arabic explanation; nothing changes', neg.status === 400 && /سالب|الرصيد/.test(String(neg.body.message)) && (await row(card2.id)).actual_balance === 3 && (await prisma.modelProduction.findFirst({}))?.qty_received === 5, neg.body);
  const okLower = await api('PUT', `/ready-stock/${card2.id}/production/${e2!.id}`, { qty_received: 2, reason: 'تصحيح' });
  check('NEGATIVE. correcting to 2 (stock exactly 0) is allowed', okLower.status === 200 && (await row(card2.id)).actual_balance === 0);

  // ───────── permissions, seasons ─────────
  const noPermProd = await api('POST', `/ready-stock/${card2.id}/production`, { qty: 1, cut_number: 1, idempotency_key: 'e2e-prod-key-0003' }, { token: viewerToken });
  const noPermFix = await api('PUT', `/ready-stock/${card2.id}/production/${e2!.id}`, { qty_received: 4, reason: 'تصحيح' }, { token: viewerToken });
  const noPermRec = await api('PUT', `/ready-stock/${card2.id}/reconcile-reservations`, {}, { token: viewerToken });
  check('AUTH. a user without the permissions cannot record production, correct it or reconcile (403) — nothing changes', noPermProd.status === 403 && noPermFix.status === 403 && noPermRec.status === 403 && (await prisma.modelProduction.count()) === 1 && (await prisma.modelProduction.findFirst({}))?.qty_received === 2);
  const second = await prisma.season.create({ data: { name: 'Winter E2E', year: 2099, type: 'Winter', status: 'inactive', is_active: false } });
  const otherSeason = await api('GET', `/ready-stock/${card2.id}/production`, undefined, { season: second.id });
  check('SEASON. a stock row of another season is not reachable through this season (404)', otherSeason.status === 404);
  await prisma.financialSnapshot.deleteMany({ where: { season_id: second.id } });
  await prisma.season.delete({ where: { id: second.id } });
  await reset();

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
