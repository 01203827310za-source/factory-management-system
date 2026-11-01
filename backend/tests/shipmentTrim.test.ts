// Explicit «تم الصرف» for more pieces than can really ship: ship what exists per line (never another order's reservation), remove the
// excess from the order completely, correct the invoice proportionally, and only after the user confirmed exactly that.
import { assert, test } from './harness';
import { World } from './world';
import type { TrimPlan } from '../src/services/shipmentTrim';

const PREP = 'تم الحجز';
const NP = 'لم يتم الصرف';
const PAID = 'تم الصرف';
const line = (code: string, qty: number, color = 'شانيه') => ({ code, qty, color });

function stocked(opening: number) {
  const w = new World();
  w.addStock('1001', 'شانيه', opening, 100);
  return w;
}
const missing = (w: World) => w.missingSummary().rows.map(r => [r.model_code, r.color, r.missing]);
const sold = (w: World) => w.movements.reduce((n, m) => n + (m.movement_type === 'SHIP' ? m.qty : -m.qty), 0);

test('TRIM 1. enough stock: the order ships normally, nothing is trimmed, no confirmation needed', async () => {
  const w = stocked(50);
  const out: { current?: TrimPlan | null } = {};
  await w.saveOrder({ status: PAID, slots: [line('1001', 40)], invoice: 4000, collected: 4000, date: '2026-10-05', trimmedOut: out });
  assert.deepEqual([w.sales[0].order_status, w.sales[0].model1_qty, w.sales[0].invoice_value], [PAID, 40, 4000]);
  assert.equal(out.current ?? null, null);
  assert.equal(sold(w), 40);
});

test('TRIM 2. 40 requested, 28 available: ships 28, removes 12 completely — no reservation, no shortage, no deduction, not in the invoice', async () => {
  const w = stocked(88);
  await w.saveOrder({ order_number: 'R', status: PREP, slots: [line('1001', 60)], invoice: 6000 });          // 60 held for another order
  const y = await w.saveOrder({ order_number: 'Y', status: PREP, slots: [line('1001', 40)], invoice: 4000 });   // reserved 28, pending 12
  assert.deepEqual(missing(w), [['1001', 'شانيه', 12]]);
  const out: { current?: TrimPlan | null } = {};
  await assert.rejects(() => w.saveOrder({ id: y.id, status: PAID, slots: [line('1001', 40)], invoice: 4000, collected: 0 }), /SHIPMENT_TRIM_REQUIRED/);   // never silent
  assert.equal(w.sales.find(s => s.id === y.id)!.order_status, PREP);                                      // nothing happened yet
  await w.saveOrder({ id: y.id, status: PAID, slots: [line('1001', 40)], invoice: 4000, collected: 0, confirmTrim: true, trimmedOut: out });
  const row = w.sales.find(s => s.id === y.id)!;
  assert.deepEqual([row.order_status, row.model1_qty, row.model1_extra_qty], [PAID, 28, 0]);
  assert.deepEqual(out.current && [out.current.requested_total, out.current.shippable_total, out.current.removed_total], [40, 28, 12]);
  assert.deepEqual(missing(w), []);                                                                         // the removed 12 are NOT a shortage
  assert.deepEqual(w.movements.map(m => [m.movement_type, m.qty]), [['SHIP', 28]]);                         // only what shipped is deducted
  assert.equal(w.allocation(w.sales[0].id)!.reserved, 60);                                                  // the other order keeps all 60
  assert.equal(w.stock().physicalQty, 60);
});

test('TRIM 3. stock reserved by other orders is never taken', async () => {
  const w = stocked(88);
  const r = await w.saveOrder({ order_number: 'R', status: PREP, slots: [line('1001', 60)], invoice: 6000 });
  const y = await w.saveOrder({ order_number: 'Y', status: PREP, slots: [line('1001', 100)], invoice: 10000 });   // wants more than all
  await w.saveOrder({ id: y.id, status: PAID, slots: [line('1001', 100)], invoice: 10000, collected: 0, confirmTrim: true });
  assert.equal(w.sales.find(s => s.id === y.id)!.model1_qty, 28);                                           // only the free 28
  assert.equal(w.allocation(r.id)!.reserved, 60);
  assert.equal(w.readyStock[0].reserved_quantity, 60);
});

test('TRIM 4. a multi-model order is trimmed line by line; a fully available line is untouched; an empty line disappears', async () => {
  const w = new World();
  w.addStock('1001', 'شانيه', 28, 100); w.addStock('1002', 'أسود', 50, 100); w.addStock('1003', 'أبيض', 0, 100);
  const o = await w.saveOrder({ status: PREP, slots: [line('1001', 40), line('1002', 10, 'أسود'), line('1003', 6, 'أبيض')], invoice: 5600 });   // 56 pieces
  const out: { current?: TrimPlan | null } = {};
  await w.saveOrder({ id: o.id, status: PAID, slots: [line('1001', 40), line('1002', 10, 'أسود'), line('1003', 6, 'أبيض')], invoice: 5600, collected: 0, confirmTrim: true, trimmedOut: out });
  const row = w.sales[0];
  assert.deepEqual([[row.model1_code, row.model1_qty], [row.model2_code, row.model2_qty], [row.model3_code, row.model3_qty]], [['1001', 28], ['1002', 10], ['', 0]]);
  assert.deepEqual(out.current!.lines.map(l => [l.code, l.requested, l.shippable, l.removed]), [['1001', 40, 28, 12], ['1002', 10, 10, 0], ['1003', 6, 0, 6]]);
  assert.deepEqual(missing(w), []);
  assert.equal(sold(w), 38);
});

test('TRIM 4b. two lines of the same model and colour share the available stock in order', async () => {
  const w = stocked(28);
  const o = await w.saveOrder({ status: PREP, slots: [line('1001', 20), line('1001', 20)], invoice: 4000 });
  await w.saveOrder({ id: o.id, status: PAID, slots: [line('1001', 20), line('1001', 20)], invoice: 4000, collected: 0, confirmTrim: true });
  assert.deepEqual([w.sales[0].model1_qty, w.sales[0].model2_qty], [20, 8]);
  assert.equal(sold(w), 28);
});

test('TRIM 5. zero available stock: nothing ships, nothing is saved as shipped, with a clear message', async () => {
  const w = stocked(8);
  await w.saveOrder({ order_number: 'A', status: PREP, slots: [line('1001', 8)], invoice: 800 });           // holds all 8
  const b = await w.saveOrder({ order_number: 'B', status: PREP, slots: [line('1001', 8)], invoice: 800 });
  await assert.rejects(() => w.saveOrder({ id: b.id, status: PAID, slots: [line('1001', 8)], invoice: 800, collected: 800, date: '2026-10-05', confirmTrim: true }), /لا يوجد مخزون متاح/);
  assert.deepEqual([w.sales[1].order_status, w.sales[1].model1_qty, w.sales[1].shipping_collected], [PREP, 8, 0]);
  assert.equal(w.movements.length, 0);
  assert.equal(w.collections.length, 0);
});

test('TRIM 6. invoice and remaining balance follow the shipped quantities (proportional; the deposit is kept; the received amount never exceeds the new balance)', async () => {
  const w = stocked(28);
  const o = await w.saveOrder({ status: PREP, slots: [line('1001', 40)], invoice: 4000, deposit: 500 });
  await w.saveOrder({ id: o.id, status: PAID, slots: [line('1001', 40)], invoice: 4000, deposit: 500, collected: 3500, date: '2026-10-05', confirmTrim: true });
  const row = w.sales[0];
  assert.deepEqual([row.model1_qty, row.invoice_value, row.deposit_paid, row.remaining], [28, 2800, 500, 2300]);
  assert.equal(row.shipping_collected, 2300);                                                               // 3,500 pre-filled → corrected balance
  assert.deepEqual(w.collections.map(c => c.amount), [2300]);
  assert.equal(w.cash().cash, 500 + 2300);                                                                  // deposit + the confirmed collection only
  assert.equal(w.shippingReceivable(), 0);
});

test('TRIM 7. repeated saves duplicate no inventory movement, sale or collection', async () => {
  const w = stocked(28);
  const o = await w.saveOrder({ status: PREP, slots: [line('1001', 40)], invoice: 4000 });
  await w.saveOrder({ id: o.id, status: PAID, slots: [line('1001', 40)], invoice: 4000, collected: 4000, date: '2026-10-05', confirmTrim: true });
  const snap = () => JSON.stringify([w.movements, w.collections, w.sales.length, w.sales[0].model1_qty, w.sales[0].invoice_value, w.stock().physicalQty]);
  const first = snap();
  for (let i = 0; i < 3; i++) await w.saveOrder({ id: o.id, status: PAID, slots: [line('1001', 28)], invoice: 2800, collected: 2800, date: '2026-10-05' });
  assert.equal(snap(), first);
  assert.equal(sold(w), 28);
});

test('TRIM 8. historical orders are untouched: an already shipped order is never trimmed, and other orders keep their rows', async () => {
  const w = stocked(100);
  const shipped = await w.saveOrder({ order_number: 'OLD', status: PAID, slots: [line('1001', 40)], invoice: 4000, collected: 4000, date: '2026-09-01' });
  const before = JSON.stringify(w.sales.find(s => s.id === shipped.id));
  const other = await w.saveOrder({ order_number: 'NEW', status: PREP, slots: [line('1001', 100)], invoice: 10000 });   // wants more than the 60 left
  await w.saveOrder({ id: other.id, status: PAID, slots: [line('1001', 100)], invoice: 10000, collected: 0, confirmTrim: true });
  assert.equal(w.sales.find(s => s.id === other.id)!.model1_qty, 60);
  assert.equal(JSON.stringify(w.sales.find(s => s.id === shipped.id)), before);                              // the old order is exactly as it was
  // editing the already shipped order's quantity is NOT a trim: it stays a sales-only change
  await w.saveOrder({ id: shipped.id, status: PAID, slots: [line('1001', 50)], invoice: 5000, collected: 4000, date: '2026-09-01' });
  assert.deepEqual([w.sales.find(s => s.id === shipped.id)!.model1_qty, w.sales.find(s => s.id === shipped.id)!.model1_extra_qty], [50, 10]);
});

test('TRIM 9. ordinary creation and editing never remove quantities', async () => {
  const w = stocked(10);
  const o = await w.saveOrder({ status: PREP, slots: [line('1001', 40)], invoice: 4000 });                   // «يتم التجهيز»: full quantity kept, shortage tracked
  assert.equal(w.sales[0].model1_qty, 40);
  assert.deepEqual(missing(w), [['1001', 'شانيه', 30]]);
  await w.saveOrder({ id: o.id, status: PREP, slots: [line('1001', 45)], invoice: 4500 });
  assert.equal(w.sales[0].model1_qty, 45);
  const np = await w.saveOrder({ order_number: 'NP', status: NP, slots: [line('1001', 40)], invoice: 4000 });   // «لم يتم الصرف»: kept as is (awaiting stock)
  assert.equal(np.model1_qty, 40);
});
