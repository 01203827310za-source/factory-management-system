// Physical inventory reconciliation: the arithmetic and the guards (the database behaviour is covered by the real-Postgres e2e).
import { assert, test } from './harness';
import { isValidCount, planReconciliation } from '../src/services/stockReconciliation';
import { permissionForRequest } from '../src/services/rbacService';

test('reconciliation: adjustment = counted − current physical, with the direction', () => {
  assert.deepEqual([planReconciliation({ previousPhysical: 20, reserved: 8, counted: 25 }).difference, planReconciliation({ previousPhysical: 20, reserved: 8, counted: 25 }).direction], [5, 'increase']);
  assert.deepEqual([planReconciliation({ previousPhysical: 25, reserved: 8, counted: 15 }).difference, planReconciliation({ previousPhysical: 25, reserved: 8, counted: 15 }).direction], [-10, 'decrease']);
  assert.equal(planReconciliation({ previousPhysical: 7, reserved: 0, counted: 7 }).direction, 'none');
});

test('reconciliation: available = physical − reserved, never negative; reserved is never changed by the plan', () => {
  const up = planReconciliation({ previousPhysical: 20, reserved: 8, counted: 25 });
  assert.deepEqual([up.available_before, up.available_after, up.reserved], [12, 17, 8]);
  const low = planReconciliation({ previousPhysical: 15, reserved: 8, counted: 5 });
  assert.deepEqual([low.available_after, low.reserved, low.uncovered_reservations, low.reservation_conflict], [0, 8, 3, true]);
  assert.equal(planReconciliation({ previousPhysical: 15, reserved: 8, counted: 8 }).reservation_conflict, false);   // exactly covering is not a conflict
});

test('reconciliation: only whole non-negative counts are valid (zero is an empty shelf)', () => {
  for (const ok of [0, 1, 25, 999999]) assert.equal(isValidCount(ok), true, String(ok));
  for (const bad of [-1, 1.5, NaN, Infinity, '5', null, undefined, 1e9]) assert.equal(isValidCount(bad), false, String(bad));
});

test('reconciliation permissions: preview / history need ready_stock.view; the reconciliation itself needs ready_stock.create (and .edit in the handler)', () => {
  assert.equal(permissionForRequest('GET', '/ready-stock/5/reconcile-preview'), 'ready_stock.view');
  assert.equal(permissionForRequest('GET', '/ready-stock/5/adjustments'), 'ready_stock.view');
  assert.equal(permissionForRequest('POST', '/ready-stock/5/reconcile'), 'ready_stock.create');
});
