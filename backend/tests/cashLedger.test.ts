// The cash ledger behind «الصافي»: every line traces to a source record, and the lines add up to the Dashboard figure.
import { assert, test } from './harness';
import { World } from './world';
import { computeDashboardCashFlow } from '../src/services/financialMetrics';
import { permissionForRequest } from '../src/services/rbacService';
import { buildCashLines, buildCashReport, type CashLedgerInput } from '../src/services/cashLedger';
import type { CashAdjustment, ExpenseRevenue, PaymentLog, ReturnItem } from '@prisma/client';

const PAID_OUT = 'تم الصرف';
const NOT_PAID_OUT = 'لم يتم الصرف';
const CANCELED = 'تم الإلغاء';
const slot = (qty: number) => [{ code: 'M1', qty, color: 'أسود' }];

let nid = 1;
const expense = (o: Partial<ExpenseRevenue>): ExpenseRevenue => ({ id: nid++, season_id: 1, date: '2026-10-06', operation_type: 'مصروف', statement: 'x', amount_in: 0, amount_out: 0, hatem_in: 0, hatem_out: 0, mido_in: 0, mido_out: 0, created_at: new Date('2026-10-06T10:00:00Z'), ...o });
const payment = (o: Partial<PaymentLog>): PaymentLog => ({ id: nid++, season_id: 1, date: '2026-10-07', type: 'client_payment', amount: 0, receiver: '', description: '', created_at: new Date('2026-10-07T10:00:00Z'), ...o });
const adjustment = (o: Partial<CashAdjustment>): CashAdjustment => ({ id: nid++, season_id: 1, kind: 'adjustment', amount: 0, entry_date: '2026-10-01', reason: 'سبب', idempotency_key: `k${nid}`, created_by: 'u', created_at: new Date('2026-10-01T08:00:00Z'), ...o });

function inputOf(w: World, extra: Partial<CashLedgerInput> = {}, season = 1): CashLedgerInput {
  const sales = w.sales.filter(s => s.season_id === season);
  const ids = new Set(sales.map(s => s.id));
  return {
    sales, collections: w.collections.filter(c => ids.has(c.sale_id)), cancellations: w.cancellations.filter(c => c.season_id === season),
    expenses: [], paymentLogs: [], returns_: w.returns.filter(r => r.season_id === season), adjustments: [], ...extra,
  };
}
const dashNet = (i: CashLedgerInput) => computeDashboardCashFlow({ sales: i.sales, expenses: i.expenses, returns_: i.returns_, paymentLogs: i.paymentLogs }).netProfit;
const report = (i: CashLedgerInput, opts = {}) => buildCashReport({ ...i, dashboardNet: dashNet(i) }, opts);
const world = () => { const w = new World(); w.addStock('M1', 'أسود', 100, 600); return w; };

test('cash ledger: the lines add up to the Dashboard «الصافي» for every kind of movement (discrepancy 0)', async () => {
  const w = world();
  await w.saveOrder({ order_number: 'A', status: PAID_OUT, slots: slot(10), invoice: 8500, deposit: 1000, collected: 7500, date: '2026-10-05' });
  await w.saveOrder({ order_number: 'B', status: NOT_PAID_OUT, slots: slot(5), invoice: 4000, deposit: 500 });        // shipped, nothing collected
  const c = await w.saveOrder({ order_number: 'C', status: PAID_OUT, slots: slot(4), invoice: 3000, deposit: 200, collected: 2800, date: '2026-10-05' });
  await w.saveOrder({ id: c.id, status: CANCELED, slots: slot(4), invoice: 3000, deposit: 200 });                       // cancelled after payout
  w.recordCustomerRefund(w.sales[0].id, 300);
  const i = inputOf(w, {
    expenses: [expense({ amount_out: 400 }), expense({ amount_in: 50, operation_type: 'إيراد' }), expense({ amount_out: 20, operation_type: 'صدقة' })],
    paymentLogs: [payment({ type: 'client_payment', amount: 600 }), payment({ type: 'debt_payment', amount: 250 })],
  });
  const r = report(i);
  assert.equal(r.reconciliation.discrepancy, 0);
  assert.equal(r.reconciliation.ledger_operating_net, dashNet(i));
  assert.equal(r.cards.closing_balance, dashNet(i));                       // no opening balance recorded → closing = الصافي
  assert.equal(r.lines[r.lines.length - 1].balance, r.cards.closing_balance);
});

test('cash ledger: a shipped order that was never paid out adds no cash; only the deposit counts', async () => {
  const w = world();
  await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 8500, deposit: 1000 });
  const r = report(inputOf(w));
  assert.deepEqual(r.lines.map(l => [l.category, l.in, l.out]), [['deposit', 1000, 0]]);
  assert.equal(r.cards.closing_balance, 1000);
});

test('cash ledger: cancellation reverses the money with labelled reversal lines — not as a paid refund', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, deposit: 1000, collected: 7500, date: '2026-10-05' });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000 });
  const i = inputOf(w);
  const r = report(i);
  assert.deepEqual(r.lines.map(l => l.category).sort(), ['deposit', 'deposit_reversal', 'shipping_collection', 'shipping_reversal']);
  assert.equal(r.cards.closing_balance, 0);
  assert.equal(r.reconciliation.discrepancy, 0);
  assert.equal(r.reconciliation.reversals_not_paid_out, 8500);             // surfaced: cash the books took back but nobody was paid
  assert.equal(r.cards.customer_refunds_paid, 0);                          // a refund is only a refund when it was paid
  assert.equal(buildCashLines(i).some(l => l.category === 'customer_refund'), false);
  // the goods returning to stock are an inventory movement, never a cash line
  assert.equal(r.lines.every(l => l.source.table !== 'inventory_movements'), true);
});

test('cash ledger: a real refund is the only refund line, and saving the cancelled order again adds no line', async () => {
  const w = world();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 8500, deposit: 1000 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000 });
  const before = report(inputOf(w)).lines.length;
  for (let k = 0; k < 3; k++) await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000 });
  assert.equal(report(inputOf(w)).lines.length, before);
  w.recordCustomerRefund(o.id, 400);
  const r = report(inputOf(w));
  assert.equal(r.cards.customer_refunds_paid, 400);
  assert.equal(r.reconciliation.discrepancy, 0);
});

test('cash ledger: editing a collection appends a correction; status changes never duplicate a line', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8500, date: '2026-10-05' });
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8000, date: '2026-10-05' });   // correction −500
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8000, date: '2026-10-05' });   // same save again
  const i = inputOf(w);
  const r = report(i);
  assert.deepEqual(r.lines.map(l => l.in - l.out), [8500, -500]);
  assert.equal(r.cards.closing_balance, 8000);
  assert.equal(r.reconciliation.discrepancy, 0);
});

test('cash ledger: legacy collected amount with no ledger rows is still listed — flagged unverified, never dropped or invented', async () => {
  const w = world();
  await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8500, date: '2026-10-05' });
  w.collections.length = 0;                                                // the history was never recorded
  const r = report(inputOf(w));
  assert.deepEqual(r.lines.map(l => [l.category, l.in, l.verified]), [['shipping_unrecorded', 8500, false]]);
  assert.equal(r.reconciliation.unverified_count, 1);
  assert.equal(r.reconciliation.discrepancy, 0);
});

test('cash ledger: opening balance and adjustments are explicit; the calculated total is never forced to a physical count', async () => {
  const w = world();
  await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 8500, deposit: 1000 });
  const i = inputOf(w, { adjustments: [adjustment({ kind: 'opening', amount: 5000 }), adjustment({ kind: 'adjustment', amount: -150, reason: 'فرق جرد موثق' })] });
  const r = report(i);
  assert.equal(r.cards.opening_balance, 5000);
  assert.equal(r.cards.closing_balance, 5000 + 1000 - 150);
  assert.equal(r.lines.filter(l => l.category === 'adjustment').length, 1);
  assert.equal(r.reconciliation.discrepancy, 0);                           // adjustments are excluded from the Dashboard comparison
});

test('cash ledger: a period carries the balance of everything before it as its opening balance', async () => {
  const w = world();
  const i = inputOf(w, { expenses: [expense({ date: '2026-09-30', amount_in: 1000, operation_type: 'إيراد' }), expense({ date: '2026-10-10', amount_out: 300 })] });
  const r = report(i, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([r.cards.opening_balance, r.cards.total_in, r.cards.total_out, r.cards.closing_balance], [1000, 0, 300, 700]);
  assert.equal(r.lines[0].balance, 700);
});

test('cash ledger: seasons never mix', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 100, 600, 1); w.addStock('M1', 'أسود', 100, 600, 2);
  await w.saveOrder({ season: 1, status: NOT_PAID_OUT, slots: slot(5), invoice: 1000, deposit: 300 });
  await w.saveOrder({ season: 2, status: NOT_PAID_OUT, slots: slot(5), invoice: 1000, deposit: 700 });
  assert.equal(report(inputOf(w, {}, 1)).cards.closing_balance, 300);
  assert.equal(report(inputOf(w, {}, 2)).cards.closing_balance, 700);
});

test('cash ledger: debt payments are outflows, client payments inflows, charity is its own category', () => {
  const w = world();
  const i = inputOf(w, {
    expenses: [expense({ amount_out: 20, operation_type: 'صدقة' }), expense({ amount_out: 100 })],
    paymentLogs: [payment({ type: 'debt_payment', amount: 250 }), payment({ type: 'client_payment', amount: 600 })],
  });
  const cats = Object.fromEntries(buildCashLines(i).map(l => [l.category, l.in - l.out]));
  assert.deepEqual(cats, { charity: -20, expense: -100, debt_payment: -250, client_payment: 600 });
});

void ({} as ReturnItem);

test('cash report permissions: reading needs dashboard.view; counts / adjustments need expenses.create', () => {
  assert.equal(permissionForRequest('GET', '/cash-report'), 'dashboard.view');
  assert.equal(permissionForRequest('GET', '/cash-report/order/5'), 'dashboard.view');
  assert.equal(permissionForRequest('POST', '/cash-report/counts'), 'expenses.create');
  assert.equal(permissionForRequest('POST', '/cash-report/adjustments'), 'expenses.create');
});

test('ready stock actions: reading needs ready_stock.view; production entry needs .create, correction / reconciliation .edit', () => {
  assert.equal(permissionForRequest('GET', '/ready-stock/5/reservations'), 'ready_stock.view');
  assert.equal(permissionForRequest('GET', '/ready-stock/5/production'), 'ready_stock.view');
  assert.equal(permissionForRequest('POST', '/ready-stock/5/production'), 'ready_stock.create');
  assert.equal(permissionForRequest('PUT', '/ready-stock/5/production/9'), 'ready_stock.edit');
  assert.equal(permissionForRequest('PUT', '/ready-stock/5/reconcile-reservations'), 'ready_stock.edit');
});
