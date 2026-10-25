// «يتم التجهيز» without enough stock: accept the order, hold only what really exists, track the rest as
// pending, let new production fulfil it, and never ship what is not physically there.
import { assert, test } from './harness';
import { World } from './world';

const PREPARED = 'تم الحجز';        // stored value of «يتم التجهيز»
const NOT_PAID_OUT = 'لم يتم الصرف';
const PAID_OUT = 'تم الصرف';
const CANCELED = 'تم الإلغاء';
const slot = (qty: number) => [{ code: 'M1', qty, color: 'أسود' }];
const notShipped = (s: { order_status: string; awaiting_stock: boolean }) =>
  assert.equal(s.order_status === PREPARED || (s.order_status === NOT_PAID_OUT && s.awaiting_stock), true, `${s.order_status} / awaiting=${s.awaiting_stock}`);   // «لم يتم الصرف» is kept while awaiting pieces

function worldWithStock(qty: number) {
  const w = new World();
  w.addStock('M1', 'أسود', qty, 600);
  return w;
}

test('1. an order can be saved as «يتم التجهيز» when stock is zero', async () => {
  const w = worldWithStock(0);
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500, deposit: 1000 });
  notShipped(o);
  assert.equal(o.model1_qty, 10);                         // requested quantity preserved
  const a = w.allocation(o.id)!;
  assert.deepEqual([a.requested, a.reserved, a.pending], [10, 0, 10]);
  assert.equal(w.readyStock[0].reserved_quantity, 0);     // nothing fabricated
  assert.equal(w.stock().physical, 0);
  assert.equal(w.cash().cash, 1000);                      // only the real deposit is cash
  assert.equal(w.shippingReceivable(), 0);                // being prepared is not a receivable
});

test('1b. an order for a model with NO stock card yet is also accepted (all pending)', async () => {
  const w = new World();
  const o = await w.saveOrder({ status: PREPARED, slots: slot(5), invoice: 3000 });
  const a = w.allocation(o.id)!;
  assert.deepEqual([a.reserved, a.pending, a.slots[0].has_card], [0, 5, false]);
});

test('2+4. partial stock: 4 of 10 are reserved, 6 are pending', async () => {
  const w = worldWithStock(4);
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500 });
  const a = w.allocation(o.id)!;
  assert.deepEqual([a.requested, a.reserved, a.pending], [10, 4, 6]);
  assert.equal(w.readyStock[0].reserved_quantity, 4);
  const s = w.stock();
  assert.deepEqual([s.physicalQty, s.reservedQty, s.availableQty, s.pendingQty], [4, 4, 0, 6]);
  assert.equal(s.physical, 4 * 600);                      // only the 4 that exist are assets
});

test('3. reserved never exceeds physical; the same units are never held by two orders (first come, first served)', async () => {
  const w = worldWithStock(10);
  const a = await w.saveOrder({ status: PREPARED, slots: slot(7), invoice: 1 });
  const b = await w.saveOrder({ status: PREPARED, slots: slot(7), invoice: 1 });
  const c = await w.saveOrder({ status: PREPARED, slots: slot(5), invoice: 1 });
  const alloc = [a, b, c].map(o => w.allocation(o.id)!);
  assert.deepEqual(alloc.map(x => x.reserved), [7, 3, 0]);
  assert.deepEqual(alloc.map(x => x.pending), [0, 4, 5]);
  const s = w.stock();
  assert.equal(s.reservedQty, 10);
  assert.ok(s.reservedQty <= s.physicalQty);
  assert.equal(w.readyStock[0].reserved_quantity, 10);
  assert.equal(s.pendingQty, 9);
});

test('5. new production fulfils pending quantities with no duplicate reservations', async () => {
  const w = worldWithStock(4);
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500 });
  w.addProduction('M1', 'أسود', 3);                       // 3 more arrive
  await w.resync();
  let a = w.allocation(o.id)!;
  assert.deepEqual([a.reserved, a.pending], [7, 3]);
  assert.equal(w.readyStock[0].reserved_quantity, 7);
  assert.equal(w.stock().physicalQty, 7);
  // recording the same state again (or re-saving the order) never reserves anything twice
  for (let i = 0; i < 3; i++) { await w.resync(); await w.saveOrder({ id: o.id, status: PREPARED, slots: slot(10), invoice: 8500 }); }
  a = w.allocation(o.id)!;
  assert.deepEqual([a.reserved, a.pending, w.readyStock[0].reserved_quantity], [7, 3, 7]);
  w.addProduction('M1', 'أسود', 20);
  await w.resync();
  a = w.allocation(o.id)!;
  assert.deepEqual([a.reserved, a.pending], [10, 0]);     // fully held, not more than requested
  assert.equal(w.stock().availableQty, 27 - 10);          // the rest stays available to others
  notShipped(w.sales[0]);        // fulfilment never ships the order by itself
  assert.equal(w.movements.length, 0);
});

test('6. shipping is blocked when the quantity is not physically available / allocated', async () => {
  const w = worldWithStock(4);
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500 });
  // saving it as shipped is not a shipment: the edit is kept, the order stays «يتم التجهيز» (full quantity, 6 missing), nothing is deducted
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: slot(10), invoice: 8500 });
  notShipped(w.sales[0]);
  assert.equal(w.sales[0].model1_qty, 10);
  assert.equal(w.stock().physicalQty, 4);
  assert.equal(w.movements.length, 0);
  // a NEW order entered directly as shipped while the stock is short is not refused: it is saved as «يتم التجهيز», nothing deducted
  const direct = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(1), invoice: 100 });
  notShipped(direct);
  const noCard = await w.saveOrder({ status: NOT_PAID_OUT, slots: [{ code: 'ZZ', qty: 1, color: '' }], invoice: 100 });
  notShipped(noCard);            // …even with no stock card at all (all pending)
  assert.equal(w.movements.length, 0);
  assert.equal(w.stock().physicalQty, 4);
  await w.saveOrder({ id: direct.id, status: CANCELED, slots: slot(1), invoice: 100 });   // keep the following numbers simple
  await w.saveOrder({ id: noCard.id, status: CANCELED, slots: [{ code: 'ZZ', qty: 1, color: '' }], invoice: 100 });
  // once production covers it, shipping works and deducts exactly once
  w.addProduction('M1', 'أسود', 6);
  await w.resync();
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: slot(10), invoice: 8500 });
  assert.equal(w.stock().physicalQty, 0);
  assert.equal(w.movements.length, 1);
  assert.equal(w.movements[0].qty, 10);
  assert.equal(w.cash().cash, 0);                         // shipping creates no cash
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: slot(10), invoice: 8500, collected: 8500 });
  assert.equal(w.stock().physicalQty, 0);                 // payout does not deduct again
  assert.equal(w.movements.length, 1);
});

test('6b. units held for another prepared order cannot be shipped by a different order', async () => {
  const w = worldWithStock(4);
  const a = await w.saveOrder({ status: PREPARED, slots: slot(4), invoice: 1 });   // holds all 4
  const other = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(2), invoice: 1 });   // new order: saved, but as «يتم التجهيز» (nothing free to ship)
  notShipped(other);
  assert.equal(w.allocation(other.id)!.reserved, 0);
  await w.saveOrder({ id: other.id, status: NOT_PAID_OUT, slots: slot(2), invoice: 1 });   // the pieces held for the other order are never used
  notShipped(w.sales[1]);
  assert.equal(w.allocation(a.id)!.reserved, 4);
  assert.equal(w.movements.length, 0);
  await w.saveOrder({ id: other.id, status: CANCELED, slots: slot(2), invoice: 1 });
  // the owner can ship them
  await w.saveOrder({ id: a.id, status: NOT_PAID_OUT, slots: slot(4), invoice: 1 });
  assert.equal(w.stock().physicalQty, 0);
});

test('6c. editing an already-shipped order is not blocked unless it ships MORE', async () => {
  const w = worldWithStock(10);
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: slot(10), invoice: 1000 });   // stock now 0
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: slot(10), invoice: 1200 });   // unrelated edit: fine
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: slot(8), invoice: 1000 });    // shipping less: fine
  // shipping MORE than exists: the unpaid shipped order goes back to «يتم التجهيز» (shipment reversed at the recorded cost), edit kept
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: slot(12), invoice: 1000 });
  notShipped(w.sales[0]);
  assert.equal(w.sales[0].model1_qty, 12);
  assert.equal(w.cogs(), 0);
  assert.equal(w.stock().physicalQty, 10);                 // the 8 shipped pieces are back in physical stock (12 wanted: 10 reserved, 2 pending)
});

test('7. repeated saves of an under-stocked prepared order change nothing', async () => {
  const w = worldWithStock(4);
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500, deposit: 500 });
  const snap = JSON.stringify([w.readyStock, w.collections, w.movements, w.cash(), w.stock(), w.allocation(o.id)]);
  for (let i = 0; i < 4; i++) await w.saveOrder({ id: o.id, status: PREPARED, slots: slot(10), invoice: 8500, deposit: 500 });
  assert.equal(JSON.stringify([w.readyStock, w.collections, w.movements, w.cash(), w.stock(), w.allocation(o.id)]), snap);
});

test('editing the quantity of a prepared order re-derives its holding (no double hold)', async () => {
  const w = worldWithStock(6);
  const o = await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 1 });
  assert.equal(w.allocation(o.id)!.reserved, 6);
  await w.saveOrder({ id: o.id, status: PREPARED, slots: slot(3), invoice: 1 });
  assert.deepEqual([w.allocation(o.id)!.reserved, w.allocation(o.id)!.pending, w.readyStock[0].reserved_quantity], [3, 0, 3]);
  await w.saveOrder({ id: o.id, status: 'تم الإلغاء', slots: slot(3), invoice: 1 });
  assert.equal(w.readyStock[0].reserved_quantity, 0);
  assert.equal(w.stock().physicalQty, 6);
});

test('8. current assets contain only real inventory and valid receivables', async () => {
  const w = worldWithStock(4);
  await w.saveOrder({ status: PREPARED, slots: slot(10), invoice: 8500, deposit: 1000 });  // 6 pending
  const s = w.stock();
  assert.equal(s.physical, 4 * 600);                       // not 10 × 600
  assert.equal(w.shippingReceivable(), 0);                 // the 8,500 order is not owed by anyone yet
  assert.equal(w.cash().cash, 1000);                       // deposit = real cash
  assert.equal(s.physical + w.shippingReceivable(), 2400); // assets = real stock + valid receivables only
});
