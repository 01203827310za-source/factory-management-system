// Scenarios A–J from the order / inventory / cash / receivables audit.
// They drive the real ledger + stock + cash code through an in-memory transaction (see world.ts).
import { assert, test } from './harness';
import { World } from './world';
import { isStockDeducting } from '../src/services/readyStockPositions';
import { collectionsByMonthFromLedger } from '../src/services/shippingCollections';
import { permissionForRequest } from '../src/services/rbacService';

const PREPARED = 'تم الحجز';        // "Prepared": reserved, still in the warehouse
const NOT_PAID_OUT = 'لم يتم الصرف'; // shipped, money not yet received
const PAID_OUT = 'تم الصرف';         // shipping company paid
const CANCELED = 'تم الإلغاء';
const M1 = { code: 'M1', qty: 10, color: 'أسود' };

function setup() {
  const w = new World();
  w.addStock('M1', 'أسود', 100, 600); // 100 pcs @ 600 = 60,000
  return w;
}

test('A. preparing an order cuts available stock but not physical stock or asset value', async () => {
  const w = setup();
  const before = w.stock();
  await w.saveOrder({ status: PREPARED, slots: [M1], invoice: 8500 });
  const after = w.stock();
  assert.equal(before.physical, 60000);
  assert.equal(after.physical, 60000);                 // asset value unchanged
  assert.equal(after.physicalQty, 100);                // physical quantity unchanged
  assert.equal(after.availableQty, 90);                // available-to-sell reduced
  assert.equal(after.reservedQty, 10);
  assert.equal(after.available + after.reserved, after.physical); // never double-counted
  assert.equal(w.readyStock[0].reserved_quantity, 10); // existing reserved_quantity field reused
  assert.equal(w.movements.length, 0);                 // nothing has left the warehouse
  assert.equal(w.collections.length, 0);
  assert.equal(w.cash().cash, 0);                      // preparing never creates cash
});

test('B+C. shipping deducts stock once at recorded cost; cash unchanged; receivable = 8,500 (not cash)', async () => {
  const w = setup();
  const o = await w.saveOrder({ status: PREPARED, slots: [M1], invoice: 8500 });
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [M1], invoice: 8500 });

  const s = w.stock();
  assert.equal(s.physical, 54000);                     // 60,000 − (10 × 600) = −6,000 exactly once
  assert.equal(s.physicalQty, 90);
  assert.equal(s.reservedQty, 0);                      // reservation released as goods left
  assert.equal(w.movements.length, 1);
  assert.deepEqual(
    [w.movements[0].movement_type, w.movements[0].qty, w.movements[0].unit_cost, w.movements[0].total_cost],
    ['SHIP', 10, 600, 6000],                           // recorded COST, not the 8,500 selling price
  );
  assert.equal(w.cogs(), 6000);
  assert.equal(w.cash().cash, 0);                      // shipping alone adds no cash
  assert.equal(w.shippingReceivable(), 8500);          // owed by the shipping company
  assert.equal(w.collections.length, 0);
  // the receivable is not also cash
  assert.equal(w.cash().cash + w.shippingReceivable(), 8500);
});

test('D. partial collection 8,200 of 8,500: cash +8,200, receivable 300 remains, no second deduction', async () => {
  const w = setup();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: [M1], invoice: 8500 });
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8200, date: '2026-10-05' });

  assert.equal(w.cash().cash, 8200);
  assert.equal(w.shippingReceivable(), 300);
  assert.equal(w.ledgerFor(o.id).total, 8200);
  assert.equal(w.collections.length, 1);
  assert.deepEqual([w.collections[0].amount, w.collections[0].kind, w.collections[0].collected_date], [8200, 'collection', '2026-10-05']);
  assert.equal(w.movements.length, 1);                 // payout did not deduct inventory again
  assert.equal(w.stock().physical, 54000);
  // invoice = cash received + still owed (no overlap, nothing lost)
  assert.equal(w.cash().cash + w.shippingReceivable(), 8500);
});

test('E. re-saving a shipped / paid-out order creates no new movements, collections or cash', async () => {
  const w = setup();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: [M1], invoice: 8500 });
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8200, date: '2026-10-05' });
  const snapshot = JSON.stringify([w.collections, w.movements, w.cash(), w.stock()]);
  for (let i = 0; i < 3; i++) {
    await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8200, date: '2026-10-05' });
    // also: the edit form re-sends the old stored date — still must not add anything
    await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8200, date: '2026-10-05' });
  }
  assert.equal(JSON.stringify([w.collections, w.movements, w.cash(), w.stock()]), snapshot);
});

test('F. correcting a collection 8,200 → 8,000 applies only the −200 difference', async () => {
  const w = setup();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: [M1], invoice: 8500 });
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8200, date: '2026-10-05' });
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8000 });

  assert.deepEqual(w.collections.map(c => [c.amount, c.kind]), [[8200, 'collection'], [-200, 'correction']]);
  assert.equal(w.ledgerFor(o.id).total, 8000);
  assert.equal(w.sales[0].shipping_collected, 8000);
  assert.equal(w.cash().cash, 8000);                   // moved by 200 only
  assert.equal(w.shippingReceivable(), 500);           // receivable re-opened by the same 200
  assert.equal(w.movements.length, 1);                 // inventory untouched by a cash correction
  // the correction is booked against the month the money was originally recorded
  assert.equal(w.collections[1].collected_date, '2026-10-05');
});

test('F2. a later top-up is a separate dated collection (full history), never a re-add', async () => {
  const w = setup();
  const o = await w.saveOrder({ status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8200, date: '2026-10-05' });
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8500, date: '2026-11-02' });
  assert.deepEqual(w.collections.map(c => [c.amount, c.collected_date]), [[8200, '2026-10-05'], [300, '2026-11-02']]);
  assert.equal(w.cash().cash, 8500);
  assert.equal(w.shippingReceivable(), 0);
});

test('F3. un-paying an order reverses the cash; un-shipping reverses cost at the ORIGINALLY recorded cost', async () => {
  const w = setup();
  const o = await w.saveOrder({ status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8200, date: '2026-10-05' });
  w.readyStock[0].cost_per_piece = 700; // the stock card's cost is edited afterwards
  await w.saveOrder({ id: o.id, status: PREPARED, slots: [M1], invoice: 8500 });

  assert.equal(w.cash().cash, 0);
  assert.equal(w.ledgerFor(o.id).total, 0);
  assert.deepEqual(w.collections.map(c => [c.amount, c.kind]), [[8200, 'collection'], [-8200, 'reversal']]);
  assert.deepEqual(w.movements.map(m => [m.movement_type, m.unit_cost, m.total_cost]), [['SHIP', 600, 6000], ['SHIP_REVERSAL', 600, 6000]]);
  assert.equal(w.cogs(), 0);
  assert.equal(w.stock().physicalQty, 100);            // back in the warehouse, reserved again
});

test('F4. editing the shipped quantity records only the delta; cost changes do not rewrite history', async () => {
  const w = setup();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: [M1], invoice: 8500 });
  w.readyStock[0].cost_per_piece = 650;
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [{ ...M1, qty: 12 }], invoice: 8500 });
  assert.deepEqual(w.movements.map(m => [m.movement_type, m.qty, m.unit_cost]), [['SHIP', 10, 600], ['SHIP', 2, 650]]);
  assert.equal(w.cogs(), 10 * 600 + 2 * 650);
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [{ ...M1, qty: 8 }], invoice: 8500 });
  assert.equal(w.movements.at(-1)?.movement_type, 'SHIP_REVERSAL');
  assert.equal(w.stock().physicalQty, 92);
});

test('G. cancelling a prepared order releases the reservation; physical value unchanged', async () => {
  const w = setup();
  const o = await w.saveOrder({ status: PREPARED, slots: [M1], invoice: 8500 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: [M1], invoice: 8500 });
  const s = w.stock();
  assert.equal(s.physical, 60000);
  assert.equal(s.physicalQty, 100);
  assert.equal(s.availableQty, 100);
  assert.equal(w.readyStock[0].reserved_quantity, 0);
  assert.equal(w.movements.length, 0);
});

test('H. cancelling a shipped order needs a stated disposition; stock returns only when the goods are back', async () => {
  const w = setup();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: [M1], invoice: 8500, order_number: 'SO-77' });
  // no disposition → refused, nothing changes
  await assert.rejects(() => w.saveOrder({ id: o.id, status: CANCELED, slots: [M1], invoice: 8500 }), /حالة البضاعة/);
  assert.equal(w.sales[0].order_status, NOT_PAID_OUT);
  assert.equal(w.stock().physicalQty, 90);
  // goods NOT returned → stock is not restored
  await w.saveOrder({ id: o.id, status: CANCELED, slots: [M1], invoice: 8500, disposition: 'not_returned' });
  assert.equal(w.stock().physicalQty, 90);
  assert.equal(isStockDeducting(NOT_PAID_OUT), true);
  // a recorded return still adds stock (existing Returns workflow)
  w.returns.push({
    id: 1, season_id: 1, date: '2026-10-09', order_number: 'SO-77', client_name: 'c', returned_by: '', paid_by: '',
    model_code: 'M1', model_qty: 3, model_color: 'أسود', refund_amount: 0, notes: '', created_at: new Date(),
  });
  assert.equal(w.stock().physicalQty, 93);
  assert.equal(w.stock().physical, 93 * 600);
});

test('I. cash + inventory + receivable reconcile; nothing counted twice across the whole lifecycle', async () => {
  const w = setup();
  const invoice = 8500, deposit = 1000;
  const o = await w.saveOrder({ status: PREPARED, slots: [M1], invoice, deposit });
  const owed = () => w.shippingReceivable();
  const cash = () => w.cash().cash;
  const invariant = (label: string, collected: number, shipped: boolean) => {
    assert.equal(cash(), deposit + collected, `${label}: cash = deposit + actually collected`);
    // once shipped, the invoice is fully accounted for: cash received + still owed, no overlap
    if (shipped) assert.equal(cash() + owed(), invoice, `${label}: cash + receivable = invoice`);
  };
  // prepared: deposit is cash, order not yet a receivable
  assert.equal(owed(), 0);
  invariant('prepared', 0, false);
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [M1], invoice, deposit });
  assert.equal(owed(), invoice - deposit);
  invariant('shipped', 0, true);
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice, deposit, collected: 7000 });
  assert.equal(owed(), 500);
  invariant('part-paid', 7000, true);
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice, deposit, collected: 7500 });
  assert.equal(owed(), 0);
  invariant('settled', 7500, true);
  // total current assets = inventory (cost) + cash + receivable: components are disjoint
  const total = w.stock().physical + cash() + owed();
  assert.equal(total, 54000 + 8500);
});

test('I2. collections cannot exceed the outstanding balance or be negative', async () => {
  const w = setup();
  await assert.rejects(() => w.saveOrder({ status: PAID_OUT, slots: [M1], invoice: 8500, collected: 9000 }));
  await assert.rejects(() => w.saveOrder({ status: PAID_OUT, slots: [M1], invoice: 8500, collected: -5 }));
  assert.equal(w.collections.length, 0);
});

test('J. seasons are isolated for stock, cash, receivables and the collection ledger', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 100, 600, 1);
  w.addStock('M1', 'أسود', 40, 800, 2);
  await w.saveOrder({ season: 1, status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8200, date: '2026-10-05' });
  await w.saveOrder({ season: 2, status: NOT_PAID_OUT, slots: [{ ...M1, qty: 5 }], invoice: 4000 });
  assert.equal(w.stock(1).physical, 90 * 600);
  assert.equal(w.stock(2).physical, 35 * 800);
  assert.equal(w.cash(1).cash, 8200);
  assert.equal(w.cash(2).cash, 0);
  assert.equal(w.shippingReceivable(1), 300);
  assert.equal(w.shippingReceivable(2), 4000);
  // a winter order cannot be satisfied from summer stock
  assert.equal(w.movements.find(m => m.season_id === 2)?.unit_cost, 800);
  // charity by month sees only the season's own ledger rows
  const s1 = collectionsByMonthFromLedger(w.collections.filter(c => c.season_id === 1));
  const s2 = collectionsByMonthFromLedger(w.collections.filter(c => c.season_id === 2));
  assert.equal(s1.get('2026-10')?.total, 8200);
  assert.equal(s2.size, 0);
});

test('J2. permissions: new endpoints are guarded by existing module permissions', () => {
  assert.equal(permissionForRequest('GET', '/sales/5/ledger'), 'sales.view');
  assert.equal(permissionForRequest('PUT', '/sales/5'), 'sales.edit');
  assert.equal(permissionForRequest('GET', '/charity/summary'), 'expenses.view');
  assert.equal(permissionForRequest('POST', '/charity/payments'), 'expenses.create');
  assert.equal(permissionForRequest('DELETE', '/charity/payments/3'), 'expenses.delete');
  assert.equal(permissionForRequest('GET', '/dashboard/breakdown/sales'), 'dashboard.view');
});
