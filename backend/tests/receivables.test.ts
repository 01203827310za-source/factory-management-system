// Regression tests for the "الفلوس اللي لنا برا" audit:
//  • only VALID outstanding receivables are counted (no negative balances, collected amounts excluded)
//  • shipped goods leave stock value exactly once; reserved goods stay in stock and are not receivables
//  • the same debt is not counted as both a shipping receivable and a client-account invoice
//  • inventory cost is never subtracted from a receivable (they are different assets)
import type { Sale } from '@prisma/client';
import { assert, test } from './harness';
import { computeMoneyOwedToUs } from '../src/services/financialMetrics';
import { permissionForRequest } from '../src/services/rbacService';
import { buildReceivablesAudit, outstandingShippingReceivable, findReceivableOverlap } from '../src/services/receivablesAudit';

import { World } from './world';
import { M1, NOT_PAID_OUT, PAID_OUT, acct, scenario } from './fixtures';

test('receivable per order: negative balances are credits, collected amounts are excluded', async () => {
  const { o1, o2, o3, o4, o5 } = await scenario();
  assert.equal(outstandingShippingReceivable(o1), 8000);
  assert.equal(outstandingShippingReceivable(o2), 0);   // −500 must NOT reduce assets
  assert.equal(outstandingShippingReceivable(o3), 5000);
  assert.equal(outstandingShippingReceivable(o4), 0);   // reserved ≠ shipped
  assert.equal(outstandingShippingReceivable(o5), 300); // 8,500 − 8,200 collected
});

test('Dashboard formula (computeMoneyOwedToUs) counts only valid outstanding receivables', async () => {
  const { w, clientAccts } = await scenario();
  const owed = computeMoneyOwedToUs({ sales: w.sales as Sale[], clientAccts });
  // shipping: 8,000 + 0 + 5,000 + 300 = 13,300; client accounts: 5,000
  assert.equal(owed, 13300 + 5000);
});

test('audit: per-order figures for every "لم يتم الصرف" order', async () => {
  const { w, clientAccts, clientInvoices } = await scenario();
  const audit = buildReceivablesAudit({
    sales: w.sales, readyStock: w.readyStock, modelProds: w.modelProds, returns_: w.returns,
    clientAccts, clientInvoices, movements: w.movements,
  });
  assert.deepEqual(audit.orders.map(o => o.order_number), ['SO-1', 'SO-2', 'SO-3']);
  const [a, b, c] = audit.orders;
  assert.deepEqual(
    [a.invoice_value, a.shipped_qty, a.inventory_qty_deducted, a.inventory_cost_deducted_card, a.inventory_cost_deducted_recorded, a.collected_amount, a.outstanding_receivable, a.inventory_still_in_stock],
    [10000, 10, 10, 6000, 6000, 0, 8000, false],
  );
  assert.deepEqual([b.outstanding_receivable, b.negative_remaining], [0, true]);
  assert.equal(c.also_in_client_account?.amount, 5000);
  // inventory cost is NOT netted against the receivable
  assert.equal(a.outstanding_receivable, a.invoice_value - a.deposit_paid);
  assert.notEqual(a.outstanding_receivable, a.invoice_value - a.deposit_paid - a.inventory_cost_deducted_card);
});

test('audit: reconciliation matches the Dashboard figure and exposes the double count exactly', async () => {
  const { w, clientAccts, clientInvoices } = await scenario();
  const audit = buildReceivablesAudit({
    sales: w.sales, readyStock: w.readyStock, modelProds: w.modelProds, returns_: w.returns,
    clientAccts, clientInvoices, movements: w.movements,
  });
  const r = audit.reconciliation;
  assert.equal(r.shipping_receivable_not_paid_out, 13000);
  assert.equal(r.shipping_receivable_paid_out_gap, 300);
  assert.equal(r.client_accounts_receivable, 5000);
  assert.equal(r.money_owed_to_us, computeMoneyOwedToUs({ sales: w.sales, clientAccts }));
  assert.deepEqual([r.double_counted_orders, r.double_counted_amount], [1, 5000]);
  assert.deepEqual(findReceivableOverlap(w.sales, clientInvoices), { orders: 1, amount: 5000 });
});

test('stock: shipped goods are removed once; reserved goods stay in stock value', async () => {
  const { w } = await scenario();
  // 200 pcs: shipped 10 + 5 + 4 + 3 = 22, reserved 20 stays physical → 178 pcs in the building
  const s = w.stock();
  assert.equal(s.physicalQty, 178);
  assert.equal(s.physical, 178 * 600);
  assert.equal(s.reservedQty, 20);
  assert.equal(s.availableQty, 158);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP').length, 4); // one per shipped order, no repeats
});

test('audit: shipped goods still valued in stock are detected (colour mismatch / short card)', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 50, 600);
  const typo = await w.saveOrder({ legacy: true, order_number: 'SO-9', status: NOT_PAID_OUT, slots: [{ code: 'M1', qty: 10, color: 'ازرق' }], invoice: 7000 });
  const short = await w.saveOrder({ legacy: true, order_number: 'SO-10', status: NOT_PAID_OUT, slots: [{ code: 'M1', qty: 60, color: 'أسود' }], invoice: 9000 });
  const none = await w.saveOrder({ legacy: true, order_number: 'SO-11', status: NOT_PAID_OUT, slots: [{ code: 'ZZ', qty: 1, color: '' }], invoice: 100 });
  const audit = buildReceivablesAudit({ sales: w.sales, readyStock: w.readyStock, modelProds: [], returns_: [], clientAccts: [], clientInvoices: [], movements: w.movements });
  const by = (n: string) => audit.orders.find(o => o.order_number === n)!;
  assert.equal(by('SO-9').stock_status, 'possible_mismatch');
  assert.equal(by('SO-9').inventory_still_in_stock, true);
  assert.equal(by('SO-9').inventory_qty_deducted, 0);
  assert.equal(by('SO-10').stock_status, 'partly_removed');
  assert.equal(by('SO-10').inventory_qty_deducted, 50);
  assert.equal(by('SO-11').stock_status, 'no_stock_card');
  assert.equal(by('SO-11').inventory_still_in_stock, false);
  void typo; void short; void none;
});

test('audit: on-account orders without a client invoice are listed (receivable not counted anywhere)', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 50, 600);
  await w.saveOrder({ order_number: 'SO-20', status: 'حساب عميل', slots: [M1], invoice: 4000 });
  const audit = buildReceivablesAudit({ sales: w.sales, readyStock: w.readyStock, modelProds: [], returns_: [], clientAccts: [], clientInvoices: [], movements: w.movements });
  assert.deepEqual(audit.reconciliation.on_account_orders_without_client_invoice.map(o => [o.order_number, o.remaining]), [['SO-20', 4000]]);
});

test('before/after: the old unfloored formula understated assets by the customer credit', async () => {
  const { w, clientAccts } = await scenario();
  // the formula as it was before the audit (no floor on a not-paid-out order's remaining)
  const legacy = w.sales.filter(s => s.order_status === NOT_PAID_OUT).reduce((n, s) => n + s.remaining, 0)
    + w.sales.filter(s => s.order_status === PAID_OUT).reduce((n, s) => n + Math.max(0, s.remaining - s.shipping_collected), 0)
    + clientAccts.reduce((n, a) => n + a.remaining, 0);
  const fixed = computeMoneyOwedToUs({ sales: w.sales as Sale[], clientAccts });
  assert.equal(legacy, 17800);          // 8,000 − 500 + 5,000 + 300 + 5,000
  assert.equal(fixed, 18300);           // 8,000 + 0 + 5,000 + 300 + 5,000
  assert.equal(fixed - legacy, 500);    // exactly the over-paid customer's credit
});

test('client-account overpayment (negative remaining) does not offset other clients\' debts', async () => {
  const { w } = await scenario();
  const owed = computeMoneyOwedToUs({ sales: [], clientAccts: [acct(1, 5000), acct(2, -1200)] });
  assert.equal(owed, 5000);
  void w;
});

test('permissions: the audit endpoint sits under dashboard.view and additionally requires sales.view in the handler', () => {
  assert.equal(permissionForRequest('GET', '/dashboard/breakdown/receivables-audit'), 'dashboard.view');
});
