// End-to-end check of the CASH RECONCILIATION report (/api/cash-report) against a REAL running backend + Postgres.
//   Needs the same setup as cancellation.e2e.ts (scratch database, server running, DATABASE_URL / JWT_SECRET exported). Localhost only.
//   Run:   E2E_BASE_URL=http://localhost:3911 DATABASE_URL=... JWT_SECRET=... npm run test:e2e:cash
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
  await prisma.cashCount.deleteMany({}); await prisma.cashAdjustment.deleteMany({});
  await prisma.charityPayment.deleteMany({}); await prisma.expenseRevenue.deleteMany({}); await prisma.paymentLog.deleteMany({});
  await prisma.sale.deleteMany({}); await prisma.returnItem.deleteMany({}); await prisma.readyStock.deleteMany({});
  await api('POST', '/ready-stock', { model_code: 'M1', product_name: 'M1', color: 'أسود', opening_balance: 100, cost_per_piece: 600, location: '' });
}
const dash = async () => (await api('GET', '/dashboard')).body;
const report = async (q = '') => (await api('GET', `/cash-report${q}`)).body;

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '')) { console.error('Refusing to run: DATABASE_URL is not a localhost database.'); process.exit(2); }
  const stale = await prisma.season.findMany({ where: { name: 'Winter E2E' }, select: { id: true } });
  for (const st of stale) { await prisma.cashAdjustment.deleteMany({ where: { season_id: st.id } }); await prisma.sale.deleteMany({ where: { season_id: st.id } }); await prisma.financialSnapshot.deleteMany({ where: { season_id: st.id } }); await prisma.season.delete({ where: { id: st.id } }); }
  const admin = await prisma.user.upsert({ where: { username: 'e2e-admin' }, update: {}, create: { username: 'e2e-admin', password: 'x', full_name: 'e2e', role: 'admin', is_active: true } });
  token = jwt.sign({ userId: admin.id, username: admin.username, role: 'admin' }, process.env.JWT_SECRET!);
  const viewer = await prisma.user.upsert({ where: { username: 'e2e-nobody' }, update: {}, create: { username: 'e2e-nobody', password: 'x', full_name: 'no perms', role: 'viewer', is_active: true } });
  viewerToken = jwt.sign({ userId: viewer.id, username: viewer.username, role: 'viewer' }, process.env.JWT_SECRET!);

  await reset();
  const season = (await prisma.season.findFirst({ where: { is_active: true } }))!.id;
  const one: Line[] = [{ code: 'M1', qty: 5, color: 'أسود' }];
  // a mix of every cash source
  const a = (await api('POST', '/sales', payload({ order_status: PAID_OUT, deposit_paid: 1000, shipping_collected: 7500, shipping_collected_date: '2026-10-05' }))).body;
  const b = (await api('POST', '/sales', payload({ order_status: NOT_PAID_OUT, deposit_paid: 500, invoice_value: 4000, lines: one }))).body;
  const c = (await api('POST', '/sales', payload({ order_status: PAID_OUT, deposit_paid: 200, invoice_value: 3000, shipping_collected: 2800, shipping_collected_date: '2026-10-06', lines: one }))).body;
  await api('PUT', `/sales/${c.id}`, payload({ order_number: c.order_number, order_status: CANCELED, invoice_value: 3000, deposit_paid: 200, lines: one }));
  await prisma.expenseRevenue.create({ data: { season_id: season, date: '2026-10-06', operation_type: 'مصروف', statement: 'كهرباء', amount_in: 0, amount_out: 400 } });
  await prisma.expenseRevenue.create({ data: { season_id: season, date: '2026-10-06', operation_type: 'إيراد', statement: 'بيع خردة', amount_in: 50, amount_out: 0 } });
  await prisma.paymentLog.create({ data: { season_id: season, date: '2026-10-07', type: 'client_payment', amount: 600 } });
  await prisma.paymentLog.create({ data: { season_id: season, date: '2026-10-07', type: 'debt_payment', amount: 250 } });
  await prisma.returnItem.create({ data: { season_id: season, date: '2026-10-08', order_number: a.order_number, client_name: 'عميل', refund_amount: 300 } });

  const d = await dash();
  const r = await report();
  check('REPORT. the ledger adds up to the Dashboard «الصافي» exactly (discrepancy 0)', r.reconciliation.discrepancy === 0 && r.reconciliation.dashboard_net === d.net_profit && r.cards.closing_balance === d.net_profit, { dash: d.net_profit, closing: r.cards.closing_balance, rec: r.reconciliation });
  check('REPORT. running balance after the last line equals the closing balance; lines are in date order', r.lines.length > 0 && r.lines[r.lines.length - 1].balance === r.cards.closing_balance && r.lines.every((l: Json, i: number, arr: Json[]) => i === 0 || arr[i - 1].date <= l.date), r.lines.length);
  check('REPORT. every line points to its source record', r.lines.every((l: Json) => l.source?.table && l.source?.id > 0));
  const cats = new Set(r.lines.map((l: Json) => l.category));
  check('REPORT. deposits, collections, cancellation reversals, expenses, income, client payment, debt payment and refund are all present', ['deposit', 'shipping_collection', 'deposit_reversal', 'shipping_reversal', 'expense', 'other_income', 'client_payment', 'debt_payment', 'customer_refund'].every(k => cats.has(k)), [...cats]);
  check('REPORT. the shipped-but-unpaid order adds only its deposit, never its invoice or expected collection; the gap is reported as a receivable', r.lines.filter((l: Json) => l.order_id === b.id).map((l: Json) => l.category).join() === 'deposit' && r.cards.shipping_receivable === 3500, r.cards.shipping_receivable);
  check('REPORT. cancellation reversals are surfaced as not paid out; only the real refund is a refund', r.reconciliation.reversals_not_paid_out === 3000 && r.cards.customer_refunds_paid === 300, r.reconciliation);

  const o = await api('GET', `/cash-report/order/${c.id}`);
  check('ORDER. the cancelled order shows deposit 200 (reversed), collected 2,800 reversed to 0, no refund paid, cancellation history', o.status === 200 && o.body.deposit_received === 200 && o.body.deposit_reversed_on_cancel === 200 && o.body.shipping_collected_gross === 2800 && o.body.shipping_collected_net === 0 && o.body.customer_refunded === 0 && o.body.cancellations.length === 1, o.body);

  const part = await report('?from=2026-10-07&to=2026-10-31');
  check('PERIOD. a period starts from the balance of everything before it', Math.round((part.cards.opening_balance + part.cards.net_movement - part.cards.closing_balance) * 100) === 0 && part.cards.opening_balance !== 0, part.cards);
  check('PERIOD. an invalid range is refused (400)', (await api('GET', '/cash-report?from=2026-10-31&to=2026-10-01')).status === 400);

  const ok1 = await api('POST', '/cash-report/adjustments', { kind: 'opening', amount: 5000, reason: 'رصيد أول الموسم', idempotency_key: 'e2e-open-0001' });
  check('ADJ. opening balance recorded once (201)', ok1.status === 201, ok1);
  check('ADJ. the same request again creates nothing (200 duplicate)', (await api('POST', '/cash-report/adjustments', { kind: 'opening', amount: 5000, reason: 'رصيد أول الموسم', idempotency_key: 'e2e-open-0001' })).body.duplicate === true && (await prisma.cashAdjustment.count()) === 1);
  check('ADJ. a second opening balance with a new key is refused (400)', (await api('POST', '/cash-report/adjustments', { kind: 'opening', amount: 1, reason: 'مرة أخرى', idempotency_key: 'e2e-open-0002' })).status === 400);
  check('ADJ. an adjustment without a reason is refused (400)', (await api('POST', '/cash-report/adjustments', { kind: 'adjustment', amount: 10, reason: '', idempotency_key: 'e2e-adj-0001' })).status === 400);
  await api('POST', '/cash-report/adjustments', { kind: 'adjustment', amount: -100, reason: 'فرق جرد مبرر', idempotency_key: 'e2e-adj-0002' });
  const r2 = await report();
  check('ADJ. closing = الصافي + opening 5,000 − 100; the adjustment is its own labelled line; discrepancy still 0', r2.cards.closing_balance === d.net_profit + 5000 - 100 && r2.lines.filter((l: Json) => l.category === 'adjustment').length === 1 && r2.reconciliation.discrepancy === 0, r2.cards);

  const k1 = await api('POST', '/cash-report/counts', { counted_amount: r2.cards.closing_balance + 70, note: 'جرد المساء', idempotency_key: 'e2e-count-001' });
  check('COUNT. physical count recorded: calculated, counted and difference (+70) stored with the user', k1.status === 201 && k1.body.count.difference === 70 && k1.body.count.calculated_amount === r2.cards.closing_balance && k1.body.count.created_by === 'e2e-admin', k1.body);
  check('COUNT. duplicate submission creates nothing', (await api('POST', '/cash-report/counts', { counted_amount: 1, idempotency_key: 'e2e-count-001' })).body.duplicate === true && (await prisma.cashCount.count()) === 1);
  const snapshot = async () => JSON.stringify([await prisma.sale.findMany({ orderBy: { id: 'asc' } }), await prisma.shippingCollection.findMany({ orderBy: { id: 'asc' } }), await prisma.expenseRevenue.findMany({ orderBy: { id: 'asc' } })]);
  const sources = await snapshot();
  await api('POST', '/cash-report/counts', { counted_amount: 5, idempotency_key: 'e2e-count-002' });
  check('COUNT. recording a count never changes a financial record', (await snapshot()) === sources);

  const linesBefore = (await report()).lines.length;
  for (let i = 0; i < 3; i++) await api('PUT', `/sales/${c.id}`, payload({ order_number: c.order_number, order_status: CANCELED, invoice_value: 3000, deposit_paid: 200, lines: one }));
  check('IDEMPOTENT. saving the cancelled order again adds no cash line', (await report()).lines.length === linesBefore);

  check('AUTH. a read-only viewer (dashboard.view) can read the report but cannot write (see next check)', (await api('GET', '/cash-report', undefined, { token: viewerToken })).status === 200);
  check('AUTH. …nor record a count or adjustment (403)', (await api('POST', '/cash-report/counts', { counted_amount: 1, idempotency_key: 'viewer-attempt-1' }, { token: viewerToken })).status === 403 && (await api('POST', '/cash-report/adjustments', { kind: 'adjustment', amount: 1, reason: 'xxx', idempotency_key: 'viewer-attempt-2' }, { token: viewerToken })).status === 403);
  const second = await prisma.season.create({ data: { name: 'Winter E2E', year: 2099, type: 'Winter', status: 'inactive', is_active: false } });
  const other = await api('GET', '/cash-report', undefined, { season: second.id });
  check('SEASON. another season sees none of these lines, counts or adjustments', other.status === 200 && other.body.lines.length === 0 && other.body.cards.closing_balance === 0 && other.body.counts.length === 0 && other.body.adjustments.length === 0, other.body.cards);
  check('SEASON. an order of another season cannot be read through it (404)', (await api('GET', `/cash-report/order/${a.id}`, undefined, { season: second.id })).status === 404);
  await prisma.financialSnapshot.deleteMany({ where: { season_id: second.id } });
  await prisma.season.delete({ where: { id: second.id } });

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
