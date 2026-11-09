// End-to-end check of «تسوية المخزون» (physical inventory reconciliation) against a REAL backend + Postgres.
//   Run:   E2E_BASE_URL=http://localhost:3911 DATABASE_URL=... JWT_SECRET=... npm run test:e2e:recon
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
  await prisma.modelPart.deleteMany({}); await prisma.modelProduction.deleteMany({}); await prisma.cuttingOrder.deleteMany({});
  await prisma.sale.deleteMany({}); await prisma.returnItem.deleteMany({}); await prisma.readyStock.deleteMany({});
  await prisma.paymentLog.deleteMany({}); await prisma.expenseRevenue.deleteMany({}); await prisma.stockAdjustment.deleteMany({});
}
const dash = async () => (await api('GET', '/dashboard')).body;
const figures = async (id: number) => (await api('GET', `/ready-stock/${id}/reservations`)).body;
const order = (no: string, qty: number, status: string) => ({
  order_number: no, marketer: 'm', client: 'عميل', mobile: '', model1_code: '1001', model1_qty: qty, model1_color: 'شانيه',
  model2_code: '', model2_qty: 0, model2_color: '', model3_code: '', model3_qty: 0, model3_color: '', model4_code: '', model4_qty: 0, model4_color: '', model5_code: '', model5_qty: 0, model5_color: '',
  invoice_value: qty * 100, deposit_paid: 0, deposit_receiver: '', shipping_number: '', order_status: status, delivery_method: 'ايرجنت', warehouse: '', shipping_collected: 0, row_number: 1,
});

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '')) { console.error('Refusing to run: DATABASE_URL is not a localhost database.'); process.exit(2); }
  const admin = await prisma.user.upsert({ where: { username: 'e2e-admin' }, update: {}, create: { username: 'e2e-admin', password: 'x', full_name: 'e2e', role: 'admin', is_active: true } });
  token = jwt.sign({ userId: admin.id, username: admin.username, role: 'admin' }, process.env.JWT_SECRET!);
  const viewer = await prisma.user.upsert({ where: { username: 'e2e-nobody' }, update: {}, create: { username: 'e2e-nobody', password: 'x', full_name: 'no perms', role: 'viewer', is_active: true } });
  viewerToken = jwt.sign({ userId: viewer.id, username: viewer.username, role: 'viewer' }, process.env.JWT_SECRET!);
  // a warehouse user who may reconcile but may NOT override a reservation conflict (ready_stock.delete denied)
  const whRole = await prisma.role.findUnique({ where: { name: 'warehouse' } });
  const delPerm = await prisma.permission.findUnique({ where: { key: 'ready_stock.delete' } });
  const wh = await prisma.user.upsert({ where: { username: 'e2e-wh' }, update: { role_id: whRole?.id ?? null }, create: { username: 'e2e-wh', password: 'x', full_name: 'wh', role: 'warehouse', role_id: whRole?.id ?? null, is_active: true } });
  if (delPerm) await prisma.userPermission.upsert({ where: { user_id_permission_id: { user_id: wh.id, permission_id: delPerm.id } }, update: { allowed: false }, create: { user_id: wh.id, permission_id: delPerm.id, allowed: false } });
  const whToken = jwt.sign({ userId: wh.id, username: wh.username, role: 'warehouse' }, process.env.JWT_SECRET!);

  await reset();
  const card = (await api('POST', '/ready-stock', { model_code: '1001', product_name: 'قميص', color: 'شانيه', opening_balance: 20, cost_per_piece: 100, location: '' })).body;
  const ordR = (await api('POST', '/sales', order('R-1', 8, PREPARED))).body;    // holds 8
  let f = await figures(card.id);
  check('SETUP. physical 20, reserved 8, available 12', f.actual === 20 && f.reserved === 8 && f.available === 12, f);

  // ───────── preview ─────────
  const pv = await api('GET', `/ready-stock/${card.id}/reconcile-preview?counted=25`);
  check('PREVIEW. counted 25 → difference +5 (increase); available 12 → 17; no reservation conflict; nothing changed', pv.status === 200 && pv.body.difference === 5 && pv.body.direction === 'increase' && pv.body.available_before === 12 && pv.body.available_after === 17 && pv.body.reservation_conflict === false && (await figures(card.id)).actual === 20, pv.body);

  // ───────── increase ─────────
  const countsBefore = { sales: await prisma.sale.count(), prod: await prisma.modelProduction.count(), ret: await prisma.returnItem.count(), mov: await prisma.inventoryMovement.count(), cash: (await dash()).cash_on_hand, owed: (await dash()).money_owed_to_us };
  const k1 = 'e2e-recon-key-0001';
  const up = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 25, reason: 'جرد نهاية الشهر', notes: 'عُدّت 5 قطع زيادة', idempotency_key: k1 });
  f = await figures(card.id);
  check('INCREASE. counted 25 against 20 is recorded (201): physical 25, reserved still 8, available 17', up.status === 201 && f.actual === 25 && f.reserved === 8 && f.available === 17, { up: up.status, f });
  check('INCREASE. it is a dedicated adjustment — not a sale, purchase, production entry, return, cost movement, cash or receivable change', await prisma.sale.count() === countsBefore.sales && await prisma.modelProduction.count() === countsBefore.prod && await prisma.returnItem.count() === countsBefore.ret && await prisma.inventoryMovement.count() === countsBefore.mov && (await dash()).cash_on_hand === countsBefore.cash && (await dash()).money_owed_to_us === countsBefore.owed);
  check('INCREASE. the order that holds the reservation is untouched (quantity 8, status «يتم التجهيز»)', (await prisma.sale.findUnique({ where: { id: ordR.id } }))?.model1_qty === 8 && (await prisma.sale.findUnique({ where: { id: ordR.id } }))?.order_status === PREPARED);
  const dup = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 25, reason: 'جرد نهاية الشهر', idempotency_key: k1 });
  check('DUPLICATE. the same submission again returns the same adjustment (200) and changes nothing: one history row, physical still 25', dup.status === 200 && dup.body.duplicate === true && (await prisma.stockAdjustment.count()) === 1 && (await figures(card.id)).actual === 25, dup.body);
  const hist = (await api('GET', `/ready-stock/${card.id}/adjustments`)).body as Json[];
  check('HISTORY. the row keeps model, colour, previous 20, counted 25, difference +5, reserved at the time 8, reason, notes, user and time', hist.length === 1 && hist[0].model_code === '1001' && hist[0].color === 'شانيه' && hist[0].previous_physical === 20 && hist[0].counted_physical === 25 && hist[0].difference === 5 && hist[0].reserved_at_time === 8 && hist[0].reason === 'جرد نهاية الشهر' && hist[0].notes === 'عُدّت 5 قطع زيادة' && hist[0].created_by === 'e2e-admin' && !!hist[0].created_at, hist[0]);
  const aud = await prisma.auditLog.findFirst({ where: { module: 'ReadyStock', record_id: String(card.id) }, orderBy: { id: 'desc' } });
  check('AUDIT. the audit log has the previous and counted balance, the difference, the reason and the user', !!aud && /20/.test(aud.description) && /25/.test(aud.description) && /\+5/.test(aud.description) && /جرد نهاية الشهر/.test(aud.description) && aud.user_name === 'e2e-admin' && /20/.test(String(aud.before_data)) && /25/.test(String(aud.after_data)), aud);

  // ───────── decrease ─────────
  const down = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 15, reason: 'تالف وفاقد', idempotency_key: 'e2e-recon-key-0002' });
  f = await figures(card.id);
  check('DECREASE. counted 15 against 25: physical 15, reserved still 8, available 7', down.status === 201 && down.body.adjustment.difference === -10 && f.actual === 15 && f.reserved === 8 && f.available === 7, { f, down: down.body });
  const same = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 15, reason: 'نفس الرصيد', idempotency_key: 'e2e-recon-key-0003' });
  check('NO DIFFERENCE. a count equal to the balance records nothing (200, changed: false)', same.status === 200 && same.body.changed === false && (await prisma.stockAdjustment.count()) === 2);

  // ───────── invalid input ─────────
  const bad = [
    ['negative', { counted: -1, reason: 'جرد', idempotency_key: 'e2e-recon-bad-01' }], ['fraction', { counted: 1.5, reason: 'جرد', idempotency_key: 'e2e-recon-bad-02' }],
    ['text', { counted: 'abc', reason: 'جرد', idempotency_key: 'e2e-recon-bad-03' }], ['absurd', { counted: 1e9, reason: 'جرد', idempotency_key: 'e2e-recon-bad-04' }],
    ['no reason', { counted: 10, reason: '', idempotency_key: 'e2e-recon-bad-05' }], ['no key', { counted: 10, reason: 'جرد' }], ['missing count', { reason: 'جرد', idempotency_key: 'e2e-recon-bad-06' }],
  ] as const;
  const badStatuses = await Promise.all(bad.map(async ([label, b]) => [label, (await api('POST', `/ready-stock/${card.id}/reconcile`, b)).status] as const));
  check('INVALID. negative, fractional, text, absurd, missing count / reason / key are all refused (400) and nothing is recorded', badStatuses.every(([, st]) => st === 400) && (await prisma.stockAdjustment.count()) === 2 && (await figures(card.id)).actual === 15, badStatuses);
  const badPreview = await api('GET', `/ready-stock/${card.id}/reconcile-preview?counted=-3`);
  check('INVALID. a negative count is refused by the preview too (400)', badPreview.status === 400);

  // ───────── a count lower than the reservations ─────────
  const pvLow = await api('GET', `/ready-stock/${card.id}/reconcile-preview?counted=5`);
  check('CONFLICT PREVIEW. counted 5 against reserved 8: 3 reserved pieces would be uncovered; order R-1 would hold 5 instead of 8; available 0', pvLow.body.reservation_conflict === true && pvLow.body.uncovered_reservations === 3 && pvLow.body.available_after === 0 && pvLow.body.affected_orders.length === 1 && pvLow.body.affected_orders[0].order_number === 'R-1' && pvLow.body.affected_orders[0].reserved_after === 5, pvLow.body);
  const lowNoConfirm = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 5, reason: 'جرد مفاجئ', idempotency_key: 'e2e-recon-key-0004' });
  check('CONFLICT. without an explicit decision the reconciliation is NOT applied (409 RESERVATION_CONFLICT, orders listed); stock and reservations unchanged', lowNoConfirm.status === 409 && lowNoConfirm.body.code === 'RESERVATION_CONFLICT' && lowNoConfirm.body.affected_orders.length === 1 && (await figures(card.id)).actual === 15 && (await figures(card.id)).reserved === 8 && (await prisma.stockAdjustment.count()) === 2, lowNoConfirm.body);
  const whOverride = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 5, reason: 'جرد مفاجئ', idempotency_key: 'e2e-recon-key-0005', confirm_shortfall: true }, { token: whToken });
  check('CONFLICT. a user who may reconcile but is not authorised to override cannot force it (409, can_override_conflict false); nothing changes', whOverride.status === 409 && whOverride.body.can_override_conflict === false && (await figures(card.id)).actual === 15 && (await prisma.stockAdjustment.count()) === 2, whOverride.body);
  const whNormal = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 16, reason: 'عدّ مخزن', idempotency_key: 'e2e-recon-key-0006' }, { token: whToken });
  check('PERMISSIONS. the same warehouse user CAN reconcile when the count covers the reservations (201)', whNormal.status === 201 && (await figures(card.id)).actual === 16 && (await prisma.stockAdjustment.findFirst({ orderBy: { id: 'desc' } }))?.created_by === 'e2e-wh', whNormal.body);
  const approved = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 5, reason: 'جرد مفاجئ', notes: 'تم التأكد من المخزن', idempotency_key: 'e2e-recon-key-0007', confirm_shortfall: true });
  const afterLow = await figures(card.id);
  const rRow = await prisma.sale.findUnique({ where: { id: ordR.id } });
  check('CONFLICT. with the authorised, explicit decision it is applied (201): physical 5, reservation re-derived to 5, the order is now short by 3', approved.status === 201 && approved.body.adjustment.conflict_acknowledged === true && afterLow.actual === 5 && afterLow.reserved === 5 && afterLow.pending === 3 && afterLow.available === 0, { approved: approved.status, afterLow });
  check('CONFLICT. no order was changed: quantity 8, status «يتم التجهيز», no shipment, no movement', rRow?.model1_qty === 8 && rRow?.order_status === PREPARED && (await prisma.inventoryMovement.count()) === 0);
  const audLow = await prisma.auditLog.findFirst({ where: { module: 'ReadyStock', record_id: String(card.id) }, orderBy: { id: 'desc' } });
  check('CONFLICT. the audit entry says the decision was explicit despite reserved 16 > counted 5', !!audLow && /بقرار صريح/.test(audLow.description) && /5/.test(audLow.description), audLow);

  // ───────── other workflows unchanged ─────────
  const ship = await api('POST', '/sales', order('NP-1', 2, NOT_PAID_OUT));
  check('WORKFLOWS. a short order still follows the existing rules after reconciliation: 0 available → kept «لم يتم الصرف» awaiting stock, nothing deducted, no extra adjustment row', ship.status === 201 && ship.body.awaiting_stock === true && (await prisma.stockAdjustment.count()) === 4 && (await figures(card.id)).actual === 5);
  await prisma.cuttingOrder.create({ data: { season_id: card.season_id, date: '2026-10-01', cut_number: 1, cut_description: 'قصة', material_type: 'قطن', color: 'شانيه', total_pieces: 100 } });
  const prod = await api('POST', `/ready-stock/${card.id}/production`, { qty: 10, cut_number: 1, idempotency_key: 'e2e-prod-after-recon' });
  check('WORKFLOWS. a production entry after the reconciliation adds on top of the counted balance: 5 + 10 = 15', prod.status === 201 && (await figures(card.id)).actual === 15);

  // ───────── duplicate card, permissions, seasons ─────────
  const twin = (await api('POST', '/ready-stock', { model_code: '1001', product_name: 'قميص', color: 'شانيه', opening_balance: 3, cost_per_piece: 100, location: '' })).body;
  const twinTry = await api('POST', `/ready-stock/${twin.id}/reconcile`, { counted: 9, reason: 'جرد', idempotency_key: 'e2e-recon-key-0008' });
  check('DUPLICATE CARD. a second card of the same model and colour cannot be reconciled (400): the first card holds the balance', twinTry.status === 400 && (await prisma.stockAdjustment.count()) === 4, twinTry.body);
  const noPerm = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 30, reason: 'جرد', idempotency_key: 'e2e-recon-key-0009' }, { token: viewerToken });
  const viewPreview = await api('GET', `/ready-stock/${card.id}/reconcile-preview?counted=30`, undefined, { token: viewerToken });
  check('AUTH. a user without the permission cannot reconcile (403) but may look at the preview (200)', noPerm.status === 403 && viewPreview.status === 200 && (await prisma.stockAdjustment.count()) === 4);
  const second = await prisma.season.create({ data: { name: 'Winter E2E', year: 2099, type: 'Winter', status: 'inactive', is_active: false } });
  const otherSeason = await api('POST', `/ready-stock/${card.id}/reconcile`, { counted: 1, reason: 'جرد', idempotency_key: 'e2e-recon-key-0010' }, { season: second.id });
  check('SEASON. a stock row of another season cannot be reconciled through this season (404)', otherSeason.status === 404);
  await prisma.financialSnapshot.deleteMany({ where: { season_id: second.id } });
  await prisma.season.delete({ where: { id: second.id } });
  const frozen = JSON.stringify(await prisma.stockAdjustment.findMany({ orderBy: { id: 'asc' } }));
  await api('GET', `/ready-stock/${card.id}/adjustments`);
  check('HISTORY. the adjustment history is append-only: reading it never changes it', JSON.stringify(await prisma.stockAdjustment.findMany({ orderBy: { id: 'asc' } })) === frozen);

  await reset();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
