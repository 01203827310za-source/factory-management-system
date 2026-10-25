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

test('11. money pre-filled for goods that do not exist is not recorded as received: the order is saved as «يتم التجهيز», no collection, no cash', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 2;
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 10)], invoice: 1000, collected: 1000, date: '2026-10-05' });
  assert.equal(w.sales[0].order_status, PREPARED);
  assert.equal(w.sales[0].shipping_collected, 0);
  assert.equal(w.collections.length, 0);
  assert.equal(w.cash().cash, 0);
  assert.deepEqual(missing(w), [['M1', 'أسود', 8]]);
});

test('12. an order that already SHIPPED keeps the strict rule: its shipped quantity cannot grow beyond what exists', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 10;
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M1', 10)], invoice: 1000 });
  assert.equal(w.sales[0].order_status, NOT_PAID_OUT);
  await assert.rejects(() => w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [line('M1', 15)], invoice: 1500 }), /./);
  assert.equal(w.sales[0].model1_qty, 10);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP').length, 1);
});

// ───────── editing: the screenshot case — 8 black pieces, nothing available, 8 held for another order ─────────
function editWorld() {
  const w = new World();
  w.addStock('1002', 'أسود', 8, 600);
  return w;
}
const black = (qty: number) => [line('1002', qty, 'أسود')];

test('E1. editing an order to ship 8 black pieces when 0 are available (8 held for another order) is SAVED, not rejected', async () => {
  const w = editWorld();
  const a = await w.saveOrder({ order_number: 'A', status: PREPARED, slots: black(8), invoice: 800 });         // holds all 8
  const b = await w.saveOrder({ order_number: 'B', status: PREPARED, slots: black(8), invoice: 800 });         // waits: 8 pending
  assert.deepEqual(w.missingSummary().rows.map(r => r.missing), [8]);
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(8), invoice: 800 });                         // the failing edit
  assert.equal(w.sales[1].order_status, PREPARED);                          // not shipped, not collected
  assert.equal(w.sales[1].model1_qty, 8);                                   // requested quantity kept
  assert.deepEqual(w.missingSummary().rows.map(r => [r.model_code, r.color, r.missing]), [['1002', 'أسود', 8]]);
  assert.equal(w.allocation(a.id)!.reserved, 8);                            // the other order's reservation is untouched
  assert.equal(w.allocation(b.id)!.reserved, 0);
  assert.equal(w.movements.length, 0);                                      // no stock movement for pieces that do not exist
  assert.equal(w.stock().physicalQty, 8);
  invariant(w);
});

test('E2. repeated saves never duplicate the shortage or any movement; the quantity can go up and down', async () => {
  const w = editWorld();
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: black(8), invoice: 800 });
  const b = await w.saveOrder({ order_number: 'B', status: PREPARED, slots: black(8), invoice: 800 });
  const snap = () => JSON.stringify([w.missingSummary().rows.map(r => r.missing), w.readyStock.map(r => r.reserved_quantity), w.movements.length, w.collections.length]);
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(8), invoice: 800 });
  const first = snap();
  for (let i = 0; i < 4; i++) await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(8), invoice: 800 });
  assert.equal(snap(), first);
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(12), invoice: 1200 });
  assert.deepEqual(w.missingSummary().rows.map(r => r.missing), [12]);
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(5), invoice: 500 });
  assert.deepEqual(w.missingSummary().rows.map(r => r.missing), [5]);
  assert.equal(w.sales[1].order_status, PREPARED);
  assert.equal(w.movements.length, 0);
});

test('E3. «صرف الحجز» with the pre-filled received amount (the real UI request) is saved, not rejected; the amount is not recorded', async () => {
  const w = editWorld();
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: black(8), invoice: 800 });
  const b = await w.saveOrder({ order_number: 'B', status: PREPARED, slots: black(8), invoice: 800 });
  await w.saveOrder({ id: b.id, status: PAID_OUT, slots: black(8), invoice: 800, collected: 800, date: '2026-10-05' });
  assert.equal(w.sales[1].order_status, PREPARED);
  assert.equal(w.sales[1].shipping_collected, 0);
  assert.equal(w.collections.length, 0);
  assert.equal(w.cash().cash, 0);
  assert.deepEqual(w.missingSummary().rows.map(r => r.missing), [8]);
});

test('E4. actual shipment still follows the stock rules: once the pieces exist the same save really ships, deducting exactly once', async () => {
  const w = editWorld();
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: black(8), invoice: 800 });
  const b = await w.saveOrder({ order_number: 'B', status: PREPARED, slots: black(8), invoice: 800 });
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(8), invoice: 800 });
  assert.equal(w.sales[1].order_status, PREPARED);
  w.addProduction('1002', 'أسود', 8);
  await w.resync();
  assert.deepEqual(w.missingSummary().rows, []);
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(8), invoice: 800 });
  assert.equal(w.sales[1].order_status, NOT_PAID_OUT);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP').length, 1);
  assert.equal(w.stock().physicalQty, 8);                                   // 16 in total − 8 shipped
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(8), invoice: 800 });
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP').length, 1);
  invariant(w);
});

test('E5. cancelling an edited order with an outstanding shortage still clears the shortage and the reservation', async () => {
  const w = editWorld();
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: black(8), invoice: 800 });
  const b = await w.saveOrder({ order_number: 'B', status: PREPARED, slots: black(8), invoice: 800 });
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(8), invoice: 800 });
  await w.saveOrder({ id: b.id, status: CANCELED, slots: black(8), invoice: 800 });
  assert.deepEqual(w.missingSummary().rows, []);
  assert.equal(w.allocation(w.sales[0].id)!.reserved, 8);
  assert.equal(w.stock().physicalQty, 8);
});
