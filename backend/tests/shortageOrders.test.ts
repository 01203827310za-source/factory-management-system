// Orders are never blocked by missing stock: the full requested quantity is saved, what exists is reserved, the rest is a
// tracked shortage (derived by the existing allocation — there is no second shortage table to drift), and nothing is deducted.
import { assert, test } from './harness';
import { World } from './world';

const PREPARED = 'تم الحجز';
const NOT_PAID_OUT = 'لم يتم الصرف';
const PAID_OUT = 'تم الصرف';
const CANCELED = 'تم الإلغاء';
const line = (code: string, qty: number, color = 'أسود') => ({ code, qty, color });

function world(opening: number) {
  const w = new World();
  w.addStock('M1', 'أسود', opening, 600);
  w.addStock('M1', 'أبيض', opening, 600);
  return w;
}
const missing = (w: World) => w.missingSummary().rows.map(r => [r.model_code, r.color, r.missing]);
const invariant = (w: World) => {
  const st = w.stock();
  assert.equal(st.physicalQty >= 0 && st.availableQty >= 0 && st.reservedQty <= st.physicalQty, true, JSON.stringify(st));
};

test('1. full quantity available: a directly shipped order is saved as shipped, no shortage', async () => {
  const w = world(10);
  await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M1', 6)], invoice: 600 });
  assert.equal(w.sales[0].order_status, NOT_PAID_OUT);
  assert.deepEqual(missing(w), []);
  assert.equal(w.stock().physicalQty, 14);                                 // 20 − 6 shipped
});

test('2. quantity exceeds stock: the order is saved with the FULL quantity, 4 reserved, 6 tracked as shortage, nothing deducted', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 4;
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 10)], invoice: 1000, collected: 0 });
  assert.equal(w.sales[0].model1_qty, 10);                                 // requested quantity untouched
  assert.equal(w.sales[0].order_status, PREPARED);                          // saved as «يتم التجهيز», not shipped
  assert.deepEqual(missing(w), [['M1', 'أسود', 6]]);
  assert.equal(w.allocation(w.sales[0].id)!.reserved, 4);
  assert.equal(w.movements.length, 0);                                     // no SHIP cost rows for goods that do not exist
  assert.equal(w.stock().physicalQty, 4);                                  // physical stock untouched
  invariant(w);
});

test('3. zero stock: saved, everything is a shortage, stock stays at zero (never negative)', async () => {
  const w = world(0);
  await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M1', 10)], invoice: 1000 });
  assert.equal(w.sales[0].order_status, PREPARED);
  assert.deepEqual(missing(w), [['M1', 'أسود', 10]]);
  assert.equal(w.stock().physicalQty, 0);
  invariant(w);
});

test('4. several colours: each line has its own shortage', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 3; w.readyStock[1].opening_balance = 20;
  await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M1', 5, 'أسود'), line('M1', 5, 'أبيض')], invoice: 1000 });
  assert.equal(w.sales[0].order_status, PREPARED);
  assert.deepEqual(missing(w), [['M1', 'أسود', 2]]);                      // the white line is fully covered
  invariant(w);
});

test('5. existing reservations are respected: only the unreserved stock counts as available', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 5;
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: [line('M1', 4)], invoice: 400 });
  await w.saveOrder({ order_number: 'B', status: NOT_PAID_OUT, slots: [line('M1', 3)], invoice: 300 });
  assert.equal(w.sales[1].order_status, PREPARED);                          // only 1 free: B cannot ship
  assert.equal(w.allocation(w.sales[0].id)!.reserved, 4);
  assert.equal(w.allocation(w.sales[1].id)!.reserved, 1);
  assert.deepEqual(missing(w), [['M1', 'أسود', 2]]);
  invariant(w);
});

test('6. editing the quantity of an order with a shortage re-derives it (no duplicate)', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 4;
  const o = await w.saveOrder({ status: PREPARED, slots: [line('M1', 10)], invoice: 1000 });
  await w.saveOrder({ id: o.id, status: PREPARED, slots: [line('M1', 7)], invoice: 700 });
  assert.deepEqual(missing(w), [['M1', 'أسود', 3]]);
  await w.saveOrder({ id: o.id, status: PREPARED, slots: [line('M1', 3)], invoice: 300 });
  assert.deepEqual(missing(w), []);
});

test('7. cancelling an order with an outstanding shortage removes the shortage and the reservation', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 4;
  const o = await w.saveOrder({ status: PREPARED, slots: [line('M1', 10)], invoice: 1000 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: [line('M1', 10)], invoice: 1000 });
  assert.deepEqual(missing(w), []);
  assert.equal(w.readyStock[0].reserved_quantity, 0);
  assert.equal(w.stock().physicalQty, 4);
});

test('8. repeated saves / retries never duplicate the shortage, the reservation or a stock movement', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 4;
  const o = await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 10)], invoice: 1000, collected: 0 });
  const snap = () => JSON.stringify([missing(w), w.readyStock.map(r => r.reserved_quantity), w.movements.length, w.collections.length, w.sales.length]);
  const first = snap();
  for (let i = 0; i < 4; i++) await w.saveOrder({ id: o.id, status: PREPARED, slots: [line('M1', 10)], invoice: 1000 });
  assert.equal(snap(), first);
  assert.deepEqual(missing(w), [['M1', 'أسود', 6]]);
});

test('9. stock arriving later reduces the shortage by allocation; the order is NOT shipped automatically', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 4;
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M1', 10)], invoice: 1000 });
  w.addProduction('M1', 'أسود', 4);
  await w.resync();
  assert.deepEqual(missing(w), [['M1', 'أسود', 2]]);
  assert.equal(w.sales[0].order_status, PREPARED);                          // still waiting — shipping is an explicit action
  w.addProduction('M1', 'أسود', 10);
  await w.resync();
  assert.deepEqual(missing(w), []);
  assert.equal(w.allocation(o.id)!.reserved, 10);
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [line('M1', 10)], invoice: 1000 });   // the user ships it explicitly
  assert.equal(w.sales[0].order_status, NOT_PAID_OUT);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP').length, 1);
  invariant(w);
});

test('10. inventory never goes negative however many short orders are entered', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 5;
  for (let i = 0; i < 6; i++) await w.saveOrder({ order_number: `S${i}`, status: i % 2 ? PAID_OUT : NOT_PAID_OUT, slots: [line('M1', 4)], invoice: 400, collected: 0 });
  invariant(w);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP').reduce((n, m) => n + m.qty, 0) <= 5, true);   // never shipped more than existed
});

test('11. shipping-company money already entered for goods that do not exist is refused, never dropped silently', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 2;
  await assert.rejects(() => w.saveOrder({ status: PAID_OUT, slots: [line('M1', 10)], invoice: 1000, collected: 1000, date: '2026-10-05' }), /./);
  assert.equal(w.sales.length, 0);
});

test('12. shipping an EXISTING under-stocked order is still blocked (only creation is relaxed)', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 4;
  const o = await w.saveOrder({ status: PREPARED, slots: [line('M1', 10)], invoice: 1000 });
  await assert.rejects(() => w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [line('M1', 10)], invoice: 1000 }), /./);
  assert.equal(w.sales[0].order_status, PREPARED);
});
