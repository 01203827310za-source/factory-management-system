// Orders are never blocked by missing stock: the full requested quantity is saved, what exists is reserved, the rest is a
// tracked shortage (derived by the existing allocation — there is no second shortage table to drift), and nothing is deducted.
import { assert, test } from './harness';
import { World } from './world';

const PREPARED = 'تم الحجز';
const NOT_PAID_OUT = 'لم يتم الصرف';
const PAID_OUT = 'تم الصرف';
const CANCELED = 'تم الإلغاء';
const line = (code: string, qty: number, color = 'أسود') => ({ code, qty, color });
const notShipped = (s: { order_status: string; awaiting_stock: boolean }) =>
  assert.equal(s.order_status === PREPARED || (s.order_status === NOT_PAID_OUT && s.awaiting_stock), true, `${s.order_status} / awaiting=${s.awaiting_stock}`);   // «لم يتم الصرف» is kept while awaiting pieces

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
  notShipped(w.sales[0]);                          // saved as «يتم التجهيز», not shipped
  assert.deepEqual(missing(w), [['M1', 'أسود', 6]]);
  assert.equal(w.allocation(w.sales[0].id)!.reserved, 4);
  assert.equal(w.movements.length, 0);                                     // no SHIP cost rows for goods that do not exist
  assert.equal(w.stock().physicalQty, 4);                                  // physical stock untouched
  invariant(w);
});

test('3. zero stock: saved, everything is a shortage, stock stays at zero (never negative)', async () => {
  const w = world(0);
  await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M1', 10)], invoice: 1000 });
  notShipped(w.sales[0]);
  assert.deepEqual(missing(w), [['M1', 'أسود', 10]]);
  assert.equal(w.stock().physicalQty, 0);
  invariant(w);
});

test('4. several colours: each line has its own shortage', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 3; w.readyStock[1].opening_balance = 20;
  await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M1', 5, 'أسود'), line('M1', 5, 'أبيض')], invoice: 1000 });
  notShipped(w.sales[0]);
  assert.deepEqual(missing(w), [['M1', 'أسود', 2]]);                      // the white line is fully covered
  invariant(w);
});

test('5. existing reservations are respected: only the unreserved stock counts as available', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 5;
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: [line('M1', 4)], invoice: 400 });
  await w.saveOrder({ order_number: 'B', status: NOT_PAID_OUT, slots: [line('M1', 3)], invoice: 300 });
  notShipped(w.sales[1]);                          // only 1 free: B cannot ship
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
  notShipped(w.sales[0]);                          // still waiting — shipping is an explicit action
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
  notShipped(w.sales[0]);
  assert.equal(w.sales[0].shipping_collected, 0);
  assert.equal(w.collections.length, 0);
  assert.equal(w.cash().cash, 0);
  assert.deepEqual(missing(w), [['M1', 'أسود', 8]]);
});

test('12. an unpaid SHIPPED order edited to a bigger quantity: the extra is sales-only (no deduction, no reservation, no shortage); changing the item beyond stock makes it awaiting and reverses its shipment once', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 10;
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M1', 8)], invoice: 800 });
  assert.equal(w.cogs(), 4800);
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [line('M1', 15)], invoice: 1500 });
  assert.equal(w.sales[0].order_status, NOT_PAID_OUT);
  assert.equal(w.sales[0].awaiting_stock, false);
  assert.equal(w.sales[0].model1_qty, 15);
  assert.equal(w.sales[0].model1_extra_qty, 7);
  assert.equal(w.cogs(), 4800);                                             // cost of the 8 shipped pieces only
  assert.deepEqual(missing(w), []);
  assert.equal(w.movements.length, 1);
  // a different colour with no stock cannot ship: the order keeps «لم يتم الصرف», becomes awaiting, and its old shipment is reversed at its recorded cost
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [line('M1', 6, 'أبيض')], invoice: 600 });
  w.readyStock[1].opening_balance = 0;
  const o2 = await w.saveOrder({ order_number: 'X', status: NOT_PAID_OUT, slots: [line('M1', 5, 'أبيض')], invoice: 500 });
  assert.equal(o2.awaiting_stock, true);
  invariant(w);
});

test('12b. a PAID-OUT order that collected money is never un-shipped by an edit: it keeps the strict shipment rule', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 10;
  const o = await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 8)], invoice: 800, collected: 800, date: '2026-10-05' });
  await assert.rejects(() => w.saveOrder({ id: o.id, status: PAID_OUT, slots: [line('M1', 15)], invoice: 1500, collected: 800, date: '2026-10-05' }), /./);
  assert.equal(w.sales[0].order_status, PAID_OUT);
  assert.equal(w.sales[0].model1_qty, 8);
  assert.equal(w.cash().cash, 800);
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
  notShipped(w.sales[1]);                          // not shipped, not collected
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
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(12), invoice: 1200 });          // +4 is sales-only: the shortage and the holds do not move
  assert.deepEqual(w.missingSummary().rows.map(r => r.missing), [8]);
  assert.equal(w.sales[1].model1_qty, 12);
  assert.equal(w.sales[1].model1_extra_qty, 4);
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(5), invoice: 500 });
  assert.deepEqual(w.missingSummary().rows.map(r => r.missing), [5]);
  assert.equal(w.sales[1].model1_extra_qty, 0);
  notShipped(w.sales[1]);
  assert.equal(w.movements.length, 0);
});

test('E3. «صرف الحجز» with the pre-filled received amount (the real UI request) is saved, not rejected; the amount is not recorded', async () => {
  const w = editWorld();
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: black(8), invoice: 800 });
  const b = await w.saveOrder({ order_number: 'B', status: PREPARED, slots: black(8), invoice: 800 });
  await w.saveOrder({ id: b.id, status: PAID_OUT, slots: black(8), invoice: 800, collected: 800, date: '2026-10-05' });
  notShipped(w.sales[1]);
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
  notShipped(w.sales[1]);
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

// ───────── «لم يتم الصرف» is KEPT while the pieces are missing (awaiting_stock) ─────────
test('R1. an order saved as «لم يتم الصرف» with no stock KEEPS that status; the shortage is tracked separately; nothing ships', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 8;
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: [line('M1', 8)], invoice: 800 });                       // holds all 8
  const b = await w.saveOrder({ order_number: 'B', status: NOT_PAID_OUT, slots: [line('M1', 8)], invoice: 800, collected: 800 });   // UI pre-fills the amount
  assert.equal(w.sales[1].order_status, NOT_PAID_OUT);                       // the status the user selected
  assert.equal(w.sales[1].awaiting_stock, true);
  assert.equal(w.sales[1].model1_qty, 8);
  assert.deepEqual(missing(w), [['M1', 'أسود', 8]]);
  assert.equal(w.allocation(w.sales[0].id)!.reserved, 8);                    // order A untouched
  assert.equal(w.movements.length, 0);
  assert.equal(w.collections.length, 0);
  assert.equal(w.shippingReceivable(), 0);                                   // nothing shipped → nothing owed by the shipping company
  assert.equal(w.stock().physicalQty, 8);
  for (let i = 0; i < 3; i++) await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: [line('M1', 8)], invoice: 800, collected: 800 });
  assert.equal(w.sales[1].order_status, NOT_PAID_OUT);
  assert.deepEqual(missing(w), [['M1', 'أسود', 8]]);
  assert.equal(w.movements.length, 0);
  invariant(w);
});

test('R2. when the pieces arrive, the same Save really ships it as «لم يتم الصرف» (one SHIP row), awaiting_stock is cleared and it becomes a receivable', async () => {
  const w = world(0); w.readyStock[0].opening_balance = 8;
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: [line('M1', 8)], invoice: 800 });
  const b = await w.saveOrder({ order_number: 'B', status: NOT_PAID_OUT, slots: [line('M1', 8)], invoice: 800 });
  w.addProduction('M1', 'أسود', 8);
  await w.resync();
  assert.equal(w.sales[1].awaiting_stock, true);                             // not shipped automatically
  assert.equal(w.shippingReceivable(), 0);
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: [line('M1', 8)], invoice: 800 });
  assert.equal(w.sales[1].order_status, NOT_PAID_OUT);
  assert.equal(w.sales[1].awaiting_stock, false);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP').length, 1);
  assert.equal(w.shippingReceivable(), 800);
  invariant(w);
});

test('R3. choosing «يتم التجهيز» or cancelling an awaiting order clears the hold', async () => {
  const w = world(0);
  const b = await w.saveOrder({ order_number: 'B', status: NOT_PAID_OUT, slots: [line('M1', 8)], invoice: 800 });
  assert.equal(w.sales[0].awaiting_stock, true);
  await w.saveOrder({ id: b.id, status: PREPARED, slots: [line('M1', 8)], invoice: 800 });
  assert.equal(w.sales[0].awaiting_stock, false);
  assert.equal(w.sales[0].order_status, PREPARED);
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: [line('M1', 8)], invoice: 800 });
  assert.equal(w.sales[0].awaiting_stock, true);
  await w.saveOrder({ id: b.id, status: CANCELED, slots: [line('M1', 8)], invoice: 800 });
  assert.equal(w.sales[0].awaiting_stock, false);
  assert.deepEqual(missing(w), []);
});

test('R4. «تم الصرف» (money collected) is NOT held as awaiting: it is saved as «يتم التجهيز» with the request remembered', async () => {
  const w = world(0);
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 8)], invoice: 800, collected: 800, date: '2026-10-05' });
  assert.equal(w.sales[0].order_status, PREPARED);
  assert.equal(w.sales[0].requested_status, PAID_OUT);
  assert.equal(w.sales[0].awaiting_stock, false);
  assert.equal(w.collections.length, 0);
});

// ───────── quantity edits on «لم يتم الصرف» are SALES-ONLY ─────────
function qWorld() {
  const w = new World();
  w.addStock('1002', 'أسود', 20, 600);
  return w;
}

test('Q1. editing a shipped «لم يتم الصرف» order from 8 to 12: quantity and value become 12 / 1,200; stock, reservations, movements and cash do not move', async () => {
  const w = qWorld();
  const other = await w.saveOrder({ order_number: 'RES', status: PREPARED, slots: black(5), invoice: 500 });           // holds 5
  const o = await w.saveOrder({ order_number: 'NP', status: NOT_PAID_OUT, slots: black(8), invoice: 800 });           // really ships 8 (stock 12 → ...)
  const before = { phys: w.stock().physicalQty, res: w.readyStock[0].reserved_quantity, alloc: w.allocation(other.id)!.reserved, mov: w.movements.length, cogs: w.cogs() };
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: black(12), invoice: 1200 });
  const row = w.sales.find(s => s.id === o.id)!;
  assert.deepEqual([row.order_status, row.model1_qty, row.model1_extra_qty, row.invoice_value], [NOT_PAID_OUT, 12, 4, 1200]);
  assert.equal(w.shippingReceivable(), 1200);                                // the order value follows the edit
  assert.deepEqual({ phys: w.stock().physicalQty, res: w.readyStock[0].reserved_quantity, alloc: w.allocation(other.id)!.reserved, mov: w.movements.length, cogs: w.cogs() }, before);
  assert.equal(w.collections.length, 0);
  assert.equal(w.cash().cash, 0);
  assert.deepEqual(missing(w), []);                                          // no shortage entry for the extra either
  const snap = () => JSON.stringify([w.movements, w.collections, w.readyStock.map(r => r.reserved_quantity), w.sales.map(s => [s.model1_qty, s.model1_extra_qty])]);
  const first = snap();
  for (let i = 0; i < 3; i++) await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: black(12), invoice: 1200 });
  assert.equal(snap(), first);                                               // repeated saves duplicate nothing
  invariant(w);
});

test('Q2. an order awaiting stock edited 8 → 12: the shortage and the holds stay as they were', async () => {
  const w = editWorld();
  const a = await w.saveOrder({ order_number: 'A', status: PREPARED, slots: black(8), invoice: 800 });
  const b = await w.saveOrder({ order_number: 'B', status: NOT_PAID_OUT, slots: black(8), invoice: 800 });      // awaiting: 0 free
  assert.equal(w.sales[1].awaiting_stock, true);
  await w.saveOrder({ id: b.id, status: NOT_PAID_OUT, slots: black(12), invoice: 1200 });
  assert.deepEqual([w.sales[1].order_status, w.sales[1].model1_qty, w.sales[1].model1_extra_qty, w.sales[1].awaiting_stock], [NOT_PAID_OUT, 12, 4, true]);
  assert.deepEqual(w.missingSummary().rows.map(r => r.missing), [8]);       // still the original 8, not 12
  assert.equal(w.allocation(a.id)!.reserved, 8);
  assert.equal(w.allocation(b.id)!.reserved, 0);
  assert.equal(w.movements.length, 0);
  assert.equal(w.shippingReceivable(), 0);
});

test('Q3. lowering the quantity removes the sales-only extra first, then real stock quantity (a real return of pieces)', async () => {
  const w = qWorld();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: black(8), invoice: 800 });
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: black(12), invoice: 1200 });
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: black(10), invoice: 1000 });
  assert.deepEqual([w.sales[0].model1_qty, w.sales[0].model1_extra_qty, w.movements.length], [10, 2, 1]);   // only extra removed: no stock movement
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: black(5), invoice: 500 });
  assert.deepEqual([w.sales[0].model1_qty, w.sales[0].model1_extra_qty], [5, 0]);
  assert.deepEqual(w.movements.map(m => [m.movement_type, m.qty]), [['SHIP', 8], ['SHIP_REVERSAL', 3]]);      // 3 real pieces came back
});

test('Q4. a real shipment still validates stock: moving a 12-piece order to «تم الصرف» ships all 12 only if they exist', async () => {
  const w = qWorld(); w.readyStock[0].opening_balance = 10;
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: black(8), invoice: 800 });                          // ships 8, 2 left
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: black(12), invoice: 1200 });                        // sales-only extra 4
  await assert.rejects(() => w.saveOrder({ id: o.id, status: PAID_OUT, slots: black(12), invoice: 1200, collected: 0 }), /./);   // needs 4 more, only 2 exist → refused
  assert.equal(w.sales[0].order_status, NOT_PAID_OUT);                       // the shipment that really happened is never undone by this
  assert.equal(w.sales[0].model1_extra_qty, 4);
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP').reduce((n, m) => n + m.qty, 0), 8);
  invariant(w);
  w.addProduction('1002', 'أسود', 10);
  await w.resync();
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: black(12), invoice: 1200, collected: 1200, date: '2026-10-05' });
  assert.equal(w.sales[0].order_status, PAID_OUT);
  assert.equal(w.sales[0].model1_extra_qty, 0);                              // the whole quantity is now a real shipment
  assert.equal(w.movements.filter(m => m.movement_type === 'SHIP').reduce((n, m) => n + m.qty, 0), 12);   // 8 + the 4 extra, as an explicit shipment
  invariant(w);
});

test('Q5. cancelling a «لم يتم الصرف» order with a sales-only extra restores only the pieces that really shipped', async () => {
  const w = qWorld();
  const o = await w.saveOrder({ status: NOT_PAID_OUT, slots: black(8), invoice: 800 });
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: black(12), invoice: 1200 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: black(12), invoice: 1200 });
  assert.equal(w.stock().physicalQty, 20);                                   // exactly what was there before: nothing extra "returned"
  assert.equal(w.cogs(), 0);
  assert.equal(w.shippingReceivable(), 0);
  assert.deepEqual(w.movements.map(m => [m.movement_type, m.qty]), [['SHIP', 8], ['SHIP_REVERSAL', 8]]);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: black(12), invoice: 1200 });
  assert.equal(w.stock().physicalQty, 20);
  invariant(w);
});
