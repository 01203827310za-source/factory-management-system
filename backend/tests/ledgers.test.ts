// Unit tests for the pure planners and for monthly-charity maths (rates, ledger months, corrections).
import { assert, test } from './harness';
import { planCollectionChange, collectionsByMonthFromLedger } from '../src/services/shippingCollections';
import { planMovements } from '../src/services/inventoryMovements';
import { charityDue, charityRate, charityStatus, isValidDate } from '../src/services/charity';
import { valueStockRow } from '../src/services/readyStockPositions';

test('charity: cases A–F (150k/200k/350k/400k/800k/900k) and edge rates', () => {
  assert.deepEqual([150000, 200000, 350000, 400000, 800000, 900000].map(t => charityDue(t).due), [1500, 3000, 5250, 8000, 16000, 27000]);
  assert.deepEqual([199999.99, 399999.99, 800000, 800000.01, 800001].map(charityRate), [0.01, 0.015, 0.02, 0.03, 0.03]);
  assert.equal(5250 - 3000, 2250);
  assert.deepEqual([charityStatus(5250, 0), charityStatus(5250, 3000), charityStatus(5250, 5250), charityStatus(0, 0)], ['unpaid', 'partial', 'paid', 'none_due']);
  assert.deepEqual([isValidDate('2026-02-30'), isValidDate('2026-10-14')], [false, true]);
});

test('collection planner: idempotent, delta-only, opening balance for legacy orders', () => {
  assert.deepEqual(planCollectionChange({ rows: [], previousCached: 0, desiredTotal: 0, date: '2026-10-01' }), []);
  assert.deepEqual(planCollectionChange({ rows: [], previousCached: 0, desiredTotal: 8200, date: '2026-10-01' }).map(r => [r.amount, r.kind]), [[8200, 'collection']]);
  const rows = [{ amount: 8200, collected_date: '2026-10-05' }];
  assert.deepEqual(planCollectionChange({ rows, previousCached: 8200, desiredTotal: 8200, date: '2026-10-09' }), []);
  assert.deepEqual(planCollectionChange({ rows, previousCached: 8200, desiredTotal: 8000, date: '2026-10-09' }).map(r => [r.amount, r.kind, r.collected_date]), [[-200, 'correction', '2026-10-05']]);
  // legacy order with a stored amount but no ledger rows yet → opening row first, then only the delta
  assert.deepEqual(planCollectionChange({ rows: [], previousCached: 5000, desiredTotal: 5000, date: '2026-10-09' }).map(r => [r.amount, r.kind]), [[5000, 'opening']]);
  assert.deepEqual(planCollectionChange({ rows: [], previousCached: 5000, desiredTotal: 5200, date: '2026-10-09' }).map(r => [r.amount, r.kind]), [[5000, 'opening'], [200, 'collection']]);
});

test('charity by month follows the ledger: correction hits the month the money was recorded', () => {
  const rows = [
    { sale_id: 1, amount: 5000, collected_date: '2026-10-05' },
    { sale_id: 1, amount: 3000, collected_date: '2026-11-02' },
  ];
  const plan = planCollectionChange({ rows, previousCached: 8000, desiredTotal: 4000, date: '2026-11-20' });
  assert.deepEqual(plan.map(r => [r.amount, r.collected_date]), [[-3000, '2026-11-02'], [-1000, '2026-10-05']]);
  const after = collectionsByMonthFromLedger([...rows, ...plan.map(p => ({ sale_id: 1, amount: p.amount, collected_date: p.collected_date }))]);
  assert.equal(after.get('2026-10')?.total, 4000);
  assert.equal(after.has('2026-11'), false);
  // creation month is irrelevant: only the receipt date counts
  assert.equal(collectionsByMonthFromLedger([{ sale_id: 9, amount: 100, collected_date: '2026-12-31' }]).get('2026-12')?.total, 100);
});

test('movement planner: only differences are recorded; reversals use the recorded cost', () => {
  const keyOf = (c: string, col: string) => `${c}|${col}`;
  const costOf = () => ({ unit_cost: 700, stock_id: 1 });
  const slot = (qty: number) => [{ code: 'M1', color: 'x', qty }];
  const first = planMovements({ existing: [], desired: slot(10), keyOf, costOf });
  assert.deepEqual(first.map(m => [m.movement_type, m.qty, m.total_cost]), [['SHIP', 10, 7000]]);
  const existing = first.map(m => ({ ...m }));
  assert.deepEqual(planMovements({ existing, desired: slot(10), keyOf, costOf }), []);           // re-save
  assert.deepEqual(planMovements({ existing, desired: slot(10), keyOf, costOf: () => ({ unit_cost: 999, stock_id: 1 }) }), []); // card cost edited later
  const back = planMovements({ existing, desired: [], keyOf, costOf: () => null });
  assert.deepEqual(back.map(m => [m.movement_type, m.qty, m.unit_cost, m.total_cost]), [['SHIP_REVERSAL', 10, 700, 7000]]);
  const noCard = planMovements({ existing: [], desired: slot(2), keyOf, costOf: () => null });
  assert.deepEqual([noCard[0].unit_cost, noCard[0].stock_id], [0, null]);                         // unknown cost is explicit, not guessed
});

test('stock: valuation invariant (available + reserved = physical)', () => {
  const v = valueStockRow(100, 10, 1000);
  assert.deepEqual([v.availableValue, v.reservedValue, v.physicalValue], [90000, 10000, 100000]);
  assert.equal(valueStockRow(5, 9, 10).reservedQty, 5);   // never reserved above what exists
});
