// Full order cancellation: selecting «تم الإلغاء» and saving reverses the WHOLE order automatically, exactly once.
//   stock      : the entire order comes back (no returned-goods condition, no quantities to enter)
//   cost / COGS: reversed at the originally recorded cost (append-only reversal rows)
//   revenue / receivable : drop out automatically (derived from status)
//   money      : the deposit and every collection are reversed with the order (append-only rows); nothing is left
//                as a refund liability and no cash is invented for money that was never received
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

test('A. cancel a RESERVED order: reservation released, nothing else created', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500 });
  assert.equal(w.readyStock[0].reserved_quantity, 10);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500 });
  assert.equal(w.readyStock[0].reserved_quantity, 0);
  assert.equal(w.stock().physicalQty, 100);
  assert.deepEqual([w.movements.length, w.collections.length], [0, 0]);
  assert.equal(w.cash().cash, 0);
  assert.deepEqual(w.cancellations.map(c => [c.was_shipped, c.goods_qty, c.deposit_held]), [[false, 0, 0]]);
});

test('B. cancel a RESERVED order WITH a deposit: the deposit is reversed with the order (no liability left); the amount stays in the record', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500, deposit: 1000 });
  assert.equal(w.cash().cash, 1000);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000 });
  assert.equal(w.cash().cash, 0);
  assert.deepEqual(w.obligations(o.id), { customer_credit_due: 0, customer_refunded: 0, shipping_repayment_due: 0 });
  assert.equal(w.cancellations[0].deposit_held, 1000);              // the audit trail keeps what was reversed
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000 });   // a stale form cannot bring it back
  assert.equal(w.cash().cash, 0);
});

test('C. cancel a SHIPPED (not yet paid out) order: stock, revenue, receivable and COGS all reverse; cost at the ORIGINAL cost', async () => {
  const w = world();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 8500, deposit: 1000 });
  assert.equal(w.shippingReceivable(), 7500);
  assert.equal(recognized(w), 8500);
  assert.equal(w.cogs(), 6000);
  w.readyStock[0].cost_per_piece = 700;                           // the card's cost changes before the cancellation
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000, reason: 'العميل رفض' });
  assert.equal(w.shippingReceivable(), 0);
  assert.equal(recognized(w), 0);
  assert.equal(w.cogs(), 0);
  assert.deepEqual(w.movements.map(m => [m.movement_type, m.qty, m.unit_cost, m.total_cost]),
    [['SHIP', 10, 600, 6000], ['SHIP_REVERSAL', 10, 600, 6000]]);  // original kept, reversal at 600 (not today's 700)
  assert.equal(w.stock().physicalQty, 100);                        // the whole order is back, no condition asked
  assert.equal(w.cash().cash, 0);                                  // deposit reversed
  assert.deepEqual(w.cancellations.map(c => [c.was_shipped, c.disposition, c.goods_qty, c.goods_cost, c.restored_qty, c.reason]), [[true, 'returned_resalable', 10, 6000, 10, 'العميل رفض']]);
});

test('D. cancel a PAID-OUT order: collections reversed by ledger rows (history kept); cash back to 0; no liability', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, deposit: 1000, collected: 7500, date: '2026-10-05' });
  assert.equal(w.cash().cash, 8500);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 1000 });
  assert.deepEqual(w.collections.map(c => c.amount), [7500, -7500]);   // original + reversal, nothing deleted
  assert.equal(w.collections[1].collected_date, '2026-10-05');         // reversed in the month it was received
  assert.equal(w.sales[0].shipping_collected, 0);
  assert.equal(w.cash().cash, 0);
  assert.deepEqual(w.obligations(o.id), { customer_credit_due: 0, customer_refunded: 0, shipping_repayment_due: 0 });
  assert.equal(w.shippingReceivable(), 0);
  assert.equal(w.stock().physicalQty, 100);
  assert.equal(w.cancellations[0].collected_held, 7500);
});

test('E. cancel a PARTIALLY collected order: collected part reversed, the unpaid gap stops being a receivable', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8200, date: '2026-10-05' });
  assert.equal(w.shippingReceivable(), 300);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500 });
  assert.equal(w.shippingReceivable(), 0);
  assert.equal(w.cash().cash, 0);
  assert.deepEqual(w.collections.map(c => c.amount), [8200, -8200]);
});

test('F. no money was ever received: no cash transaction is invented', async () => {
  const w = world();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 8500 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500 });
  assert.equal(w.collections.length, 0);
  assert.equal(w.cash().cash, 0);
  assert.equal(w.cash().totalOut, 0);
});

test('G. returned-goods inputs are ignored: any disposition / quantity still restores the whole order', async () => {
  const w = world();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 8500 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, disposition: 'not_returned', returnedQty: [2] });
  assert.equal(w.stock().physicalQty, 100);
  assert.equal(w.cogs(), 0);
});

test('H. multiple models and colours: every line is reversed at its own recorded cost', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 50, 600); w.addStock('M1', 'أبيض', 50, 650); w.addStock('M2', 'أسود', 50, 400);
  const lines = [...slot(5, 'M1', 'أسود'), ...slot(3, 'M1', 'أبيض'), ...slot(7, 'M2', 'أسود')];
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: lines, invoice: 9000 });
  const shipped = 5 * 600 + 3 * 650 + 7 * 400;
  assert.equal(w.cogs(), shipped);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: lines, invoice: 9000 });
  assert.equal(w.cogs(), 0);
  assert.equal(w.stock().physicalQty, 150);
  const rev = w.movements.filter(m => m.movement_type === 'SHIP_REVERSAL');
  assert.deepEqual(rev.map(m => [m.model_code, m.color, m.qty, m.unit_cost]).sort(), [['M1', 'أبيض', 3, 650], ['M1', 'أسود', 5, 600], ['M2', 'أسود', 7, 400]].sort());
  assert.equal(w.cancellations[0].goods_cost, shipped);
});

test('I. saving the cancelled order again and again never restores or reverses anything twice', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, deposit: 500, collected: 8000, date: '2026-10-05' });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 500 });
  const state = () => JSON.stringify([w.movements, w.collections, w.cancellations, w.stock(), w.cash(), w.sales[0].shipping_collected, w.sales[0].deposit_paid]);
  const snap = state();
  for (let i = 0; i < 5; i++) await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500, deposit: 500 });
  assert.equal(state(), snap);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP_REVERSAL').length, 1);
  assert.equal(w.collections.length, 2);
  assert.equal(w.stock().physicalQty, 100);
});

test('J. stock, historical cost, receivables, cash, revenue, COGS and profit all reconcile after a cancellation', async () => {
  const w = world();
  await w.saveOrder({ order_number: 'KEEP', status: NOT_PAID_OUT, slots: slot(10), invoice: 5000 });
  const gone = await w.saveOrder({ order_number: 'GONE', status: NOT_PAID_OUT, slots: slot(20), invoice: 9000, deposit: 1000 });
  assert.deepEqual([recognized(w), w.cogs(), w.shippingReceivable()], [14000, 18000, 5000 + 8000]);
  await w.saveOrder({ id: gone.id, status: CANCELED, slots: slot(20), invoice: 9000, deposit: 1000 });
  assert.equal(recognized(w), 5000);
  assert.equal(w.cogs(), 6000);
  assert.equal(w.shippingReceivable(), 5000);
  assert.equal(w.stock().physicalQty, 90);
  assert.equal(w.cash().cash, 0);                                  // GONE's deposit is reversed with the order
});

test('K. every reversal references the original: same line, original cost, originals untouched', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8500, date: '2026-10-05' });
  const originals = JSON.stringify([w.movements[0], w.collections[0]]);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500 });
  assert.equal(JSON.stringify([w.movements[0], w.collections[0]]), originals);
  assert.deepEqual([w.movements[1].model_code, w.movements[1].color, w.movements[1].unit_cost], [w.movements[0].model_code, w.movements[0].color, w.movements[0].unit_cost]);
  assert.equal(w.collections[1].sale_id, w.collections[0].sale_id);
});

test('L. reopening a cancelled order ships it again with NEW movements (originals + reversal kept)', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8500, date: '2026-10-05' });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500 });
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: slot(10), invoice: 8500 });
  assert.deepEqual(w.movements.map(m => m.movement_type), ['SHIP', 'SHIP_REVERSAL', 'SHIP']);
  assert.equal(w.stock().physicalQty, 90);
  assert.equal(w.cogs(), 6000);
  assert.equal(w.sales[0].cancel_disposition, null);
  assert.notEqual(w.cancellations[0].reopened_at, null);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: slot(10), invoice: 8500 });   // cancelling again is a NEW event
  assert.equal(w.cancellations.length, 2);
  assert.equal(w.stock().physicalQty, 100);
  assert.equal(w.cogs(), 0);
});

test('legacy: orders cancelled before this feature (no disposition) keep restoring stock as before', async () => {
  const w = world();
  await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 1000 });
  w.sales[0].order_status = CANCELED;                              // an old row: cancelled, disposition NULL
  assert.equal(w.sales[0].cancel_disposition, null);
  assert.equal(w.stock().physicalQty, 100);
});

test('M. seasons stay isolated and the refund endpoint needs sales.edit', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 50, 600, 1); w.addStock('M1', 'أسود', 50, 600, 2);
  const a = await w.saveOrder({ season: 1, status: NOT_PAID_OUT, slots: slot(10), invoice: 1000, deposit: 200 });
  await w.saveOrder({ season: 2, status: NOT_PAID_OUT, slots: slot(5), invoice: 1000, deposit: 300 });
  await w.saveOrder({ season: 1, id: a.id, status: CANCELED, slots: slot(10), invoice: 1000, deposit: 200 });
  assert.equal(w.stock(1).physicalQty, 50);                        // summer: restored
  assert.equal(w.stock(2).physicalQty, 45);                        // winter untouched
  assert.deepEqual([w.cash(1).cash, w.cash(2).cash], [0, 300]);
  assert.equal(w.cancellations.every(c => c.season_id === 1), true);
  assert.equal(permissionForRequest('POST', '/sales/5/refunds'), 'sales.edit');
  assert.equal(permissionForRequest('PUT', '/sales/5'), 'sales.edit');
  assert.equal(permissionForRequest('GET', '/sales/5/ledger'), 'sales.view');
});
