// End-to-end check of "ship what exists, remove the excess" (explicit «تم الصرف») against a REAL backend + Postgres, with the exact Sales.tsx payload.
//   Run:   E2E_BASE_URL=http://localhost:3911 DATABASE_URL=... JWT_SECRET=... npm run test:e2e:trim
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
  await prisma.paymentLog.deleteMany({}); await prisma.expenseRevenue.deleteMany({});
}
const dash = async () => (await api('GET', '/dashboard')).body;
// exactly the field set Sales.tsx sends
const form = (no: string, lines: [string, number, string][], status: string, invoice: number, collected: number, deposit = 0) => {
  const o: Record<string, unknown> = { order_number: no, marketer: 'm', client: 'عميل', mobile: '', invoice_value: invoice, deposit_paid: deposit, deposit_receiver: '', shipping_number: '', order_status: status, delivery_method: 'ايرجنت', warehouse: '', shipping_collected: collected, shipping_collected_date: '2026-10-05', row_number: 1 };
  for (let i = 1; i <= 5; i++) { const l = lines[i - 1]; o[`model${i}_code`] = l?.[0] ?? ''; o[`model${i}_qty`] = l?.[1] ?? 0; o[`model${i}_color`] = l?.[2] ?? ''; }
  return o;
};
const confirmOf = (plan: { lines: { index: number; shippable: number }[] }) => ({ shippable: [0, 1, 2, 3, 4].map(i => plan.lines.find(l => l.index === i)?.shippable ?? 0) });
const reservedOf = async (code: string, color: string) => (await prisma.readyStock.findFirst({ where: { model_code: code, color } }))?.reserved_quantity;

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '')) { console.error('Refusing to run: DATABASE_URL is not a localhost database.'); process.exit(2); }
  const admin = await prisma.user.upsert({ where: { username: 'e2e-admin' }, update: {}, create: { username: 'e2e-admin', password: 'x', full_name: 'e2e', role: 'admin', is_active: true } });
  token = jwt.sign({ userId: admin.id, username: admin.username, role: 'admin' }, process.env.JWT_SECRET!);
  const viewer = await prisma.user.upsert({ where: { username: 'e2e-nobody' }, update: {}, create: { username: 'e2e-nobody', password: 'x', full_name: 'no perms', role: 'viewer', is_active: true } });
  viewerToken = jwt.sign({ userId: viewer.id, username: viewer.username, role: 'viewer' }, process.env.JWT_SECRET!);

  // ───────── the screenshot state: 88 in stock, 60 held by order R, order Y wants 40 ─────────
  await reset();
  await api('POST', '/ready-stock', { model_code: '1001', product_name: 'قميص', color: 'شانيه', opening_balance: 88, cost_per_piece: 100, location: '' });
  await api('POST', '/ready-stock', { model_code: '1002', product_name: 'بنطلون', color: 'أسود', opening_balance: 50, cost_per_piece: 200, location: '' });
  const old = (await api('POST', '/sales', form('OLD', [['1002', 5, 'أسود']], PAID_OUT, 1000, 1000))).body;     // a historical shipped order
  const oldSnapshot = JSON.stringify(await prisma.sale.findUnique({ where: { id: old.id } }));
  const oldMoves = JSON.stringify(await prisma.inventoryMovement.findMany({ where: { sale_id: old.id }, orderBy: { id: 'asc' } }));
  const r = (await api('POST', '/sales', form('R', [['1001', 60, 'شانيه']], PREPARED, 6000, 0))).body;
  const y = (await api('POST', '/sales', form('Y', [['1001', 40, 'شانيه']], PREPARED, 4000, 0, 500))).body;
  check('SETUP. R holds 60, Y holds 28 and misses 12', (await reservedOf('1001', 'شانيه')) === 88 && (await dash()).missing_stock?.total_missing_units === 12);

  // ───────── preview (read-only) ─────────
  const pv = await api('POST', '/sales/ship-preview', { ...form('Y', [['1001', 40, 'شانيه']], PAID_OUT, 4000, 3500, 500), id: y.id });
  check('PREVIEW. applicable: requested 40, shippable 28, removed 12; invoice 4,000 → 2,800; remaining after the 500 deposit = 2,300', pv.status === 200 && pv.body.applicable === true && pv.body.plan.requested_total === 40 && pv.body.plan.shippable_total === 28 && pv.body.plan.removed_total === 12 && pv.body.plan.invoice_after === 2800 && pv.body.plan.remaining_after === 2300, pv.body);
  check('PREVIEW. it saved nothing: Y is still «يتم التجهيز» with 40, no movement', (await prisma.sale.findUnique({ where: { id: y.id } }))?.order_status === PREPARED && (await prisma.inventoryMovement.count({ where: { sale_id: y.id } })) === 0);

  // ───────── ship without confirmation / with a wrong confirmation ─────────
  const body = form('Y', [['1001', 40, 'شانيه']], PAID_OUT, 4000, 3500, 500);
  const noConfirm = await api('PUT', `/sales/${y.id}`, body);
  check('NO CONFIRMATION. the save is refused (409 SHIPMENT_TRIM_REQUIRED) with the plan; nothing changes', noConfirm.status === 409 && noConfirm.body.code === 'SHIPMENT_TRIM_REQUIRED' && noConfirm.body.plan.removed_total === 12 && (await prisma.sale.findUnique({ where: { id: y.id } }))?.model1_qty === 40, noConfirm.body);
  const wrong = await api('PUT', `/sales/${y.id}`, { ...body, trim_confirm: { shippable: [30, 0, 0, 0, 0] } });
  check('STALE CONFIRMATION. a confirmation that no longer matches the stock is refused (409) and nothing changes', wrong.status === 409 && (await prisma.sale.findUnique({ where: { id: y.id } }))?.order_status === PREPARED, wrong.body);

  // ───────── confirmed shipment ─────────
  const done = await api('PUT', `/sales/${y.id}`, { ...body, trim_confirm: confirmOf(pv.body.plan) });
  const yRow = await prisma.sale.findUnique({ where: { id: y.id } });
  const yMoves = await prisma.inventoryMovement.findMany({ where: { sale_id: y.id } });
  const yCols = await prisma.shippingCollection.findMany({ where: { sale_id: y.id } });
  check('SHIPPED. status «تم الصرف», quantity 28, invoice 2,800, remaining 2,300', done.status === 200 && yRow?.order_status === PAID_OUT && yRow?.model1_qty === 28 && yRow?.invoice_value === 2800 && yRow?.remaining === 2300, done.body);
  check('SHIPPED. the 12 removed are nowhere: not reserved, not a shortage, not deducted (one SHIP of 28), extra 0', yRow?.model1_extra_qty === 0 && (await dash()).missing_stock?.total_missing_units === 0 && yMoves.length === 1 && yMoves[0].qty === 28, { moves: yMoves.map(m => m.qty) });
  check('SHIPPED. order R keeps all 60 reserved; total reserved 60; stock 60 left', (await reservedOf('1001', 'شانيه')) === 60 && (await prisma.sale.findUnique({ where: { id: r.id } }))?.model1_qty === 60);
  check('SHIPPED. the pre-filled received amount 3,500 was corrected to the new balance 2,300: ONE collection of 2,300', yRow?.shipping_collected === 2300 && yCols.length === 1 && yCols[0].amount === 2300, yCols);
  const cashY = (await dash()).cash_on_hand;
  // repeated saves: the exact same request again (double click / retry)
  for (let i = 0; i < 3; i++) await api('PUT', `/sales/${y.id}`, { ...body, trim_confirm: confirmOf(pv.body.plan) });
  check('REPEAT. saving the same confirmed request again changes nothing: one SHIP, one collection, same quantity and invoice, same cash',
    (await prisma.inventoryMovement.count({ where: { sale_id: y.id } })) === 1 && (await prisma.shippingCollection.count({ where: { sale_id: y.id } })) === 1 && (await prisma.sale.findUnique({ where: { id: y.id } }))?.model1_qty === 28 && (await prisma.sale.findUnique({ where: { id: y.id } }))?.invoice_value === 2800 && (await dash()).cash_on_hand === cashY);

  // ───────── zero available: nothing ships ─────────
  const z = (await api('POST', '/sales', form('Z', [['1001', 5, 'شانيه']], PREPARED, 500, 0))).body;
  const zero = await api('PUT', `/sales/${z.id}`, form('Z', [['1001', 5, 'شانيه']], PAID_OUT, 500, 500));
  check('ZERO STOCK. everything left is held for R: the order is NOT shipped (400, NO_STOCK_TO_SHIP, Arabic message) and stays untouched', zero.status === 400 && zero.body.code === 'NO_STOCK_TO_SHIP' && /لا يوجد مخزون متاح/.test(zero.body.message) && (await prisma.sale.findUnique({ where: { id: z.id } }))?.order_status === PREPARED && (await prisma.sale.findUnique({ where: { id: z.id } }))?.model1_qty === 5, zero.body);

  // ───────── multi-model order: each line on its own ─────────
  const m = (await api('POST', '/sales', form('M', [['1001', 10, 'شانيه'], ['1002', 10, 'أسود']], PREPARED, 4000, 0))).body;
  const mPv = await api('POST', '/sales/ship-preview', { ...form('M', [['1001', 10, 'شانيه'], ['1002', 10, 'أسود']], PAID_OUT, 4000, 4000), id: m.id });
  check('MULTI. line 1 (nothing free) loses all 10, line 2 ships all 10; invoice halves to 2,000', mPv.body.plan.lines[0].shippable === 0 && mPv.body.plan.lines[0].removed === 10 && mPv.body.plan.lines[1].shippable === 10 && mPv.body.plan.invoice_after === 2000, mPv.body.plan);
  const mDone = await api('PUT', `/sales/${m.id}`, { ...form('M', [['1001', 10, 'شانيه'], ['1002', 10, 'أسود']], PAID_OUT, 4000, 4000), trim_confirm: confirmOf(mPv.body.plan) });
  const mRow = await prisma.sale.findUnique({ where: { id: m.id } });
  check('MULTI. saved: the empty line is gone, line 2 is 10, status «تم الصرف», only 1002 deducted, no shortage', mDone.status === 200 && mRow?.model1_code === '' && mRow?.model1_qty === 0 && mRow?.model2_code === '1002' && mRow?.model2_qty === 10 && mRow?.invoice_value === 2000 && (await prisma.inventoryMovement.findMany({ where: { sale_id: m.id } })).map(x => `${x.model_code}:${x.qty}`).join() === '1002:10' && (await dash()).missing_stock?.rows.every((x: Json) => x.model_code !== '1001' || x.missing === 5), mRow);

  // ───────── creation: a NEW order entered directly as «تم الصرف» ─────────
  const newBody = form('N', [['1002', 80, 'أسود']], PAID_OUT, 8000, 8000);
  const nPv = await api('POST', '/sales/ship-preview', newBody);
  const nNo = await api('POST', '/sales', newBody);
  check('CREATE. a new «تم الصرف» order for 80 when 35 exist needs confirmation (409) and creates nothing', nPv.body.plan.shippable_total === 35 && nNo.status === 409 && (await prisma.sale.count({ where: { order_number: 'N' } })) === 0, nNo.body);
  const nYes = await api('POST', '/sales', { ...newBody, trim_confirm: confirmOf(nPv.body.plan) });
  check('CREATE. confirmed: saved as «تم الصرف» with 35 and invoice 3,500; one SHIP of 35; one collection of 3,500', nYes.status === 201 && nYes.body.order_status === PAID_OUT && nYes.body.model1_qty === 35 && nYes.body.invoice_value === 3500 && (await prisma.inventoryMovement.findMany({ where: { sale_id: nYes.body.id } })).length === 1 && (await prisma.shippingCollection.findMany({ where: { sale_id: nYes.body.id } })).map(c => c.amount).join() === '3500', nYes.body);

  // ───────── enough stock: ships normally, no confirmation ─────────
  await api('POST', '/ready-stock', { model_code: '2000', product_name: 'جاكيت', color: 'أحمر', opening_balance: 100, cost_per_piece: 50, location: '' });
  const okOrder = (await api('POST', '/sales', form('OK', [['2000', 30, 'أحمر']], PREPARED, 3000, 0))).body;
  const okShip = await api('PUT', `/sales/${okOrder.id}`, form('OK', [['2000', 30, 'أحمر']], PAID_OUT, 3000, 3000));
  check('NORMAL. with enough stock the order ships as is (no confirmation, no trim): 30 pieces, invoice 3,000', okShip.status === 200 && okShip.body.order_status === PAID_OUT && okShip.body.model1_qty === 30 && okShip.body.invoice_value === 3000 && okShip.body.trimmed === null, okShip.body);

  // ───────── ordinary editing never trims; historical orders untouched; permissions ─────────
  const edit = await api('PUT', `/sales/${r.id}`, form('R', [['1001', 90, 'شانيه']], PREPARED, 9000, 0));
  check('ORDINARY EDIT. raising a «يتم التجهيز» order beyond stock keeps the full 90 (shortage tracked) — nothing is removed', edit.status === 200 && edit.body.model1_qty === 90 && edit.body.trimmed === null, edit.body);
  check('HISTORY. the old shipped order and its stock movements are exactly as before', JSON.stringify(await prisma.sale.findUnique({ where: { id: old.id } })) === oldSnapshot && JSON.stringify(await prisma.inventoryMovement.findMany({ where: { sale_id: old.id }, orderBy: { id: 'asc' } })) === oldMoves);
  const noPerm = await api('PUT', `/sales/${edit.body.id}`, form('R', [['1001', 90, 'شانيه']], PAID_OUT, 9000, 0), { token: viewerToken });
  check('AUTH. a user without edit permission cannot ship (403)', noPerm.status === 403);

  await reset();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
