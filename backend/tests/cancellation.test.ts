// Full order cancellation: every effect of the order is reversed exactly once, history is kept, and
// money / goods are never assumed to have moved just because a status changed.
//   stock      : restored ONLY if the goods are back and resalable (disposition)
//   cost / COGS: reversed at the originally recorded cost (append-only reversal rows)
//   revenue / receivable : drop out automatically (derived from status)
//   cash       : money already received STAYS until a real refund / repayment is recorded
import { assert, test } from './harness';
import { World } from './world';
import { isStockDeducting } from '../src/services/readyStockPositions';
import { permissionForRequest } from '../src/services/rbacService';

const PREPARED = 'تم الحجز';
const NOT_PAID_OUT = 'لم يتم الصرف';
const PAID_OUT = 'تم الصرف';
const CANCELED = 'تم الإلغاء';
const slot = (qty: number, code = 'M1', color = 'أسود') => [{ code, qty, color }];

const recognized = (w: World, season = 1) =>
  w.sales.filter(s => s.season_id === season && isStockDeducting(s.order_status)).reduce((n, s) => n + s.invoice_value, 0);

function world() {
  const w = new World();
  w.addStock('M1', 'أسود', 100, 600);
  return w;
}

test('1. cancel an UNSHIPPED order with no deposit: reservation released, nothing else created', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500 });
  assert.equal(w.readyStock[0].reserved_quantity, 10);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500 });
  assert.equal(w.readyStock[0].reserved_quantity, 0);
  assert.equal(w.stock().physicalQty, 100);                       // no artificial stock return
  assert.deepEqual([w.movements.length, w.collections.length], [0, 0]);   // no financial reversals invented
  assert.equal(w.cash().cash, 0);
  assert.equal(w.sales[0].cancel_disposition, null);
  assert.deepEqual(w.cancellations.map(c => [c.was_shipped, c.goods_qty, c.deposit_held]), [[false, 0, 0]]);
  assert.deepEqual(w.obligations(o.id), { customer_credit_due: 0, customer_refunded: 0, shipping_repayment_due: 0 });
});

test('2. cancel an UNSHIPPED order WITH a deposit: the deposit stays in cash as a refund liability until really refunded', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500, deposit: 1000 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000 });
  assert.equal(w.cash().cash, 1000);                              // real money received is not erased
  assert.deepEqual(w.obligations(o.id), { customer_credit_due: 1000, customer_refunded: 0, shipping_repayment_due: 0 });
  w.recordCustomerRefund(o.id, 400);                              // a real partial refund
  assert.equal(w.cash().cash, 600);
  assert.equal(w.obligations(o.id).customer_credit_due, 600);
  w.recordCustomerRefund(o.id, 600);
  assert.deepEqual([w.cash().cash, w.obligations(o.id).customer_credit_due], [0, 0]);
});

test('3. cancel a SHIPPED order before the shipping company pays: revenue, receivable and COGS reverse; cost at the recorded cost', async () => {
  const w = world();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 8500, deposit: 1000 });
  assert.equal(w.shippingReceivable(), 7500);
  assert.equal(recognized(w), 8500);
  assert.equal(w.cogs(), 6000);
  w.readyStock[0].cost_per_piece = 700;                           // the card's cost changes before the cancellation
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000, disposition: 'returned_resalable', reason: 'العميل رفض' });
  assert.equal(w.shippingReceivable(), 0);                         // the receivable is reversed
  assert.equal(recognized(w), 0);                                  // recognised revenue reversed
  assert.equal(w.cogs(), 0);                                       // COGS reversed…
  assert.deepEqual(w.movements.map(m => [m.movement_type, m.qty, m.unit_cost, m.total_cost]),
    [['SHIP', 10, 600, 6000], ['SHIP_REVERSAL', 10, 600, 6000]]);  // …at the ORIGINAL cost (600), not today's 700; original kept
  assert.equal(w.stock().physicalQty, 100);                        // goods back and resalable → stock restored exactly
  assert.equal(w.cash().cash, 1000);                               // the deposit stays
  assert.deepEqual(w.cancellations.map(c => [c.was_shipped, c.disposition, c.goods_qty, c.goods_cost, c.reason]), [[true, 'returned_resalable', 10, 6000, 'العميل رفض']]);
});

test('3b. goods NOT returned: COGS reverses but stock is NOT restored (still outside the building)', async () => {
  const w = world();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 8500 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, disposition: 'not_returned' });
  assert.equal(w.stock().physicalQty, 90);                         // never claim they are in the warehouse
  assert.equal(w.stock().physical, 90 * 600);
  assert.equal(w.cogs(), 0);
  assert.deepEqual(w.cancellations.map(c => [c.disposition, c.goods_qty, c.goods_cost]), [['not_returned', 10, 6000]]);   // tracked separately, at historical cost
  // later the goods really come back → the user updates the disposition: stock restored once, no ledger duplication
  const movementsBefore = w.movements.length;
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, disposition: 'returned_resalable' });
  assert.equal(w.stock().physicalQty, 100);
  assert.equal(w.movements.length, movementsBefore);
  assert.equal(w.cancellations.length, 1);
  assert.equal(w.cancellations[0].disposition, 'returned_resalable');
});

test('3c. goods returned DAMAGED: not sellable stock, tracked as outside the sellable stock', async () => {
  const w = world();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(4), invoice: 3000 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(4), invoice: 3000, disposition: 'returned_damaged' });
  assert.equal(w.stock().physicalQty, 96);
  assert.equal(w.sales[0].cancel_disposition, 'returned_damaged');
});

test('4. cancel after FULL collection: the cash stays; it becomes money owed back to the shipping company until repaid', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, deposit: 1000, collected: 7500, date: '2026-10-05' });
  assert.equal(w.cash().cash, 8500);
  const ledgerBefore = w.collections.map(c => [c.amount, c.kind]);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000, disposition: 'returned_resalable' });
  assert.equal(w.cash().cash, 8500);                               // NOT pretended never received
  assert.deepEqual(w.collections.map(c => [c.amount, c.kind]), ledgerBefore);   // collection history untouched, no reversal row
  assert.equal(w.sales[0].shipping_collected, 7500);
  assert.deepEqual(w.obligations(o.id), { customer_credit_due: 1000, customer_refunded: 0, shipping_repayment_due: 7500 });
  assert.equal(w.shippingReceivable(), 0);
  // the real repayment is what reduces cash
  w.recordShippingRepayment(o.id, 7500);
  assert.equal(w.cash().cash, 1000);
  assert.deepEqual(w.collections.map(c => c.kind), ['collection', 'repayment']);
  assert.equal(w.obligations(o.id).shipping_repayment_due, 0);
});

test('5. cancel a PARTIALLY collected order: the unpaid gap stops being a receivable; the collected part is held', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8200, date: '2026-10-05' });
  assert.equal(w.shippingReceivable(), 300);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, disposition: 'returned_resalable' });
  assert.equal(w.shippingReceivable(), 0);
  assert.equal(w.cash().cash, 8200);
  assert.equal(w.obligations(o.id).shipping_repayment_due, 8200);
});

test('6. multiple models and colours: every line is reversed at its own recorded cost', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 50, 600); w.addStock('M1', 'أبيض', 50, 650); w.addStock('M2', 'أسود', 50, 400);
  const lines = [...slot(5, 'M1', 'أسود'), ...slot(3, 'M1', 'أبيض'), ...slot(7, 'M2', 'أسود')];
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: lines, invoice: 9000 });
  const shipped = 5 * 600 + 3 * 650 + 7 * 400;
  assert.equal(w.cogs(), shipped);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: lines, invoice: 9000, disposition: 'returned_resalable' });
  assert.equal(w.cogs(), 0);
  assert.equal(w.stock().physicalQty, 150);
  const rev = w.movements.filter(m => m.movement_type === 'SHIP_REVERSAL');
  assert.deepEqual(rev.map(m => [m.model_code, m.color, m.qty, m.unit_cost]).sort(), [['M1', 'أبيض', 3, 650], ['M1', 'أسود', 5, 600], ['M2', 'أسود', 7, 400]].sort());
  assert.equal(w.cancellations[0].goods_qty, 15);
  assert.equal(w.cancellations[0].goods_cost, shipped);
});

test('7. submitting the cancellation many times never duplicates a reversal, a record, stock or cash', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, deposit: 500, collected: 8000, date: '2026-10-05' });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 500, disposition: 'returned_resalable' });
  const snap = JSON.stringify([w.movements, w.collections, w.cancellations, w.stock(), w.cash(), w.sales[0].shipping_collected]);
  for (let i = 0; i < 5; i++) await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 500, disposition: 'returned_resalable' });
  assert.equal(JSON.stringify([w.movements, w.collections, w.cancellations, w.stock(), w.cash(), w.sales[0].shipping_collected]), snap);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP_REVERSAL').length, 1);
  assert.equal(w.stock().physicalQty, 100);                        // restored once, not 5 times
});

test('8+9. stock, historical cost, receivables, cash, revenue, COGS and profit all reconcile after a cancellation', async () => {
  const w = world();
  const keep = await w.saveOrder({ order_number: 'KEEP', status: NOT_PAID_OUT, slots: slot(10), invoice: 5000 });
  const gone = await w.saveOrder({ order_number: 'GONE', status: NOT_PAID_OUT, slots: slot(20), invoice: 9000, deposit: 1000 });
  assert.deepEqual([recognized(w), w.cogs(), w.shippingReceivable()], [14000, 18000, 5000 + 8000]);   // KEEP 5,000 owed + GONE (9,000 − 1,000 deposit)
  void keep;
  await w.saveOrder({ id: gone.id, status: CANCELED, slots: slot(20), invoice: 9000, deposit: 1000, disposition: 'returned_resalable' });
  assert.equal(recognized(w), 5000);                               // only KEEP is revenue
  assert.equal(w.cogs(), 6000);                                    // only KEEP's 10 × 600
  assert.equal(w.shippingReceivable(), 5000);                      // only KEEP's receivable
  assert.equal(w.stock().physicalQty, 90);                         // 100 − KEEP's 10
  assert.equal(w.stock().physical, 90 * 600);
  assert.equal(w.cash().cash, 1000);                               // GONE's deposit still held
  assert.equal(w.cash().netProfit, 1000);                          // cash-basis profit does not move on a status change
});

test('reopening a cancelled order ships it again with NEW movements (originals + reversal kept)', async () => {
  const w = world();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 8500 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, disposition: 'returned_resalable' });
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: slot(10), invoice: 8500 });
  assert.deepEqual(w.movements.map(m => m.movement_type), ['SHIP', 'SHIP_REVERSAL', 'SHIP']);
  assert.equal(w.stock().physicalQty, 90);
  assert.equal(w.cogs(), 6000);
  assert.equal(w.sales[0].cancel_disposition, null);
  assert.notEqual(w.cancellations[0].reopened_at, null);          // the first cancel event is marked reopened
  // cancelling again is a NEW event
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, disposition: 'not_returned' });
  assert.equal(w.cancellations.length, 2);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP_REVERSAL').length, 2);
});

test('a cancelled order that still holds shipping-company money cannot be silently reopened to unpaid', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8500, date: '2026-10-05' });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, disposition: 'returned_resalable' });
  await assert.rejects(() => w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: slot(10), invoice: 8500 }), /محتجز/);
  assert.equal(w.cash().cash, 8500);                               // cash never erased by the attempt
});

test('legacy: orders cancelled before this feature (no disposition) keep restoring stock as before', async () => {
  const w = world();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 1000 });
  w.sales[0].order_status = CANCELED;                              // an old row: cancelled, disposition NULL
  assert.equal(w.sales[0].cancel_disposition, null);
  assert.equal(w.stock().physicalQty, 100);
  void o;
});

test('10. seasons stay isolated and the refund endpoint needs sales.edit', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 50, 600, 1); w.addStock('M1', 'أسود', 50, 600, 2);
  const a = await w.saveOrder({ season: 1, status: NOT_PAID_OUT, slots: slot(10), invoice: 1000, deposit: 200 });
  await w.saveOrder({ season: 2, status: NOT_PAID_OUT, slots: slot(5), invoice: 1000, deposit: 300 });
  await w.saveOrder({ season: 1, id: a.id, status: CANCELED, slots: slot(10), invoice: 1000, deposit: 200, disposition: 'not_returned' });
  assert.equal(w.stock(1).physicalQty, 40);                        // summer: goods still outside
  assert.equal(w.stock(2).physicalQty, 45);                        // winter untouched
  assert.deepEqual([w.cash(1).cash, w.cash(2).cash], [200, 300]);
  assert.equal(w.cancellations.every(c => c.season_id === 1), true);
  assert.equal(permissionForRequest('POST', '/sales/5/refunds'), 'sales.edit');
  assert.equal(permissionForRequest('PUT', '/sales/5'), 'sales.edit');
  assert.equal(permissionForRequest('GET', '/sales/5/ledger'), 'sales.view');
});
