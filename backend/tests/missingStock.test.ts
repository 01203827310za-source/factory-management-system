// «ملخص النواقص المطلوبة للتجهيز»: consolidated shortage per model code + colour across all
// «يتم التجهيز» orders, derived from the stock allocation (never from raw requested quantities).
import { assert, test } from './harness';
import { World } from './world';

const PREPARED = 'تم الحجز';        // stored value of «يتم التجهيز»
const NOT_PAID_OUT = 'لم يتم الصرف';
const line = (code: string, color: string, qty: number) => [{ code, color, qty }];
const rowOf = (w: World, code: string, color: string, season = 1) =>
  w.missingSummary(season).rows.find(r => r.model_code === code && r.color === color);

test('1. several orders for the same model + colour are one row, quantities added up', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 0, 100);
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: line('1001', 'أسود', 10), invoice: 1 });
  await w.saveOrder({ order_number: 'B', status: PREPARED, slots: line('1001', 'أسود', 8), invoice: 1 });
  await w.saveOrder({ order_number: 'C', status: PREPARED, slots: line('1001', 'أسود', 6), invoice: 1 });
  const sum = w.missingSummary();
  assert.equal(sum.rows.length, 1);
  assert.deepEqual([sum.rows[0].required, sum.rows[0].reserved, sum.rows[0].missing], [24, 0, 24]);
  assert.deepEqual(sum.rows[0].orders.map(o => [o.order_number, o.missing]), [['A', 10], ['B', 8], ['C', 6]]);
  assert.equal(sum.total_missing_units, 24);
  assert.equal(sum.total_orders, 3);
});

test('2+3. different colours of one model, and different models of one colour, are separate rows', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 0, 100); w.addStock('1001', 'نبيتي', 0, 100); w.addStock('1002', 'أسود', 0, 100);
  await w.saveOrder({ status: PREPARED, slots: line('1001', 'أسود', 24), invoice: 1 });
  await w.saveOrder({ status: PREPARED, slots: line('1001', 'نبيتي', 18), invoice: 1 });
  await w.saveOrder({ status: PREPARED, slots: line('1002', 'أسود', 12), invoice: 1 });
  const rows = w.missingSummary().rows;
  assert.deepEqual(rows.map(r => [r.model_code, r.color, r.missing]), [['1001', 'أسود', 24], ['1001', 'نبيتي', 18], ['1002', 'أسود', 12]]); // highest first
  assert.equal(w.missingSummary().total_missing_units, 54);
});

test('multi-line orders: each line lands in its own model + colour row', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 0, 100); w.addStock('1002', 'أبيض', 0, 100);
  await w.saveOrder({ order_number: 'M', status: PREPARED, slots: [...line('1001', 'أسود', 5), ...line('1002', 'أبيض', 9), ...line('1001', 'أسود', 2)], invoice: 1 });
  const sum = w.missingSummary();
  assert.deepEqual(sum.rows.map(r => [r.model_code, r.color, r.missing]), [['1002', 'أبيض', 9], ['1001', 'أسود', 7]]);
  assert.equal(sum.total_orders, 1);
  assert.deepEqual(rowOf(w, '1001', 'أسود')!.orders.map(o => [o.requested, o.missing]), [[7, 7]]);   // one entry per order
});

test('4. existing reservations are deducted: only the unreserved part is a shortage', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 10, 100);
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: line('1001', 'أسود', 7), invoice: 1 });   // fully covered
  await w.saveOrder({ order_number: 'B', status: PREPARED, slots: line('1001', 'أسود', 7), invoice: 1 });   // 3 held, 4 missing
  const r = rowOf(w, '1001', 'أسود')!;
  assert.deepEqual([r.required, r.reserved, r.missing], [7, 3, 4]);                // never the raw 14 requested
  assert.deepEqual(r.orders.map(o => o.order_number), ['B']);                       // A has no shortage
  assert.deepEqual([r.physical_stock, r.reserved_for_covered_orders, r.free_stock], [10, 7, 0]); // "held for A" vs "free"
  assert.equal(r.required, r.reserved + r.missing);
  assert.equal(w.missingSummary().total_missing_units, 4);
});

test('a fully covered model has no row at all, and negatives never appear', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 50, 100);
  await w.saveOrder({ status: PREPARED, slots: line('1001', 'أسود', 20), invoice: 1 });
  assert.equal(w.missingSummary().rows.length, 0);
  assert.equal(w.missingSummary().total_missing_units, 0);
});

test('5. cancelled and shipped orders never inflate the shortage', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 4, 100);
  const a = await w.saveOrder({ order_number: 'A', status: PREPARED, slots: line('1001', 'أسود', 10), invoice: 1 });    // 4 held, 6 missing
  const b = await w.saveOrder({ order_number: 'B', status: PREPARED, slots: line('1001', 'أسود', 5), invoice: 1 });     // 5 missing
  assert.equal(rowOf(w, '1001', 'أسود')!.missing, 11);
  await w.saveOrder({ id: b.id, status: 'تم الإلغاء', slots: line('1001', 'أسود', 5), invoice: 1 });                      // cancelled
  assert.equal(rowOf(w, '1001', 'أسود')!.missing, 6);
  w.addProduction('1001', 'أسود', 6); await w.resync();
  await w.saveOrder({ id: a.id, status: NOT_PAID_OUT, slots: line('1001', 'أسود', 10), invoice: 1 });                     // shipped
  assert.equal(w.missingSummary().rows.length, 0);
  // an order that shipped from the start is not a shortage either
  const w2 = new World(); w2.addStock('1001', 'أسود', 20, 100);
  await w2.saveOrder({ status: NOT_PAID_OUT, slots: line('1001', 'أسود', 20), invoice: 1 });
  assert.equal(w2.missingSummary().total_missing_units, 0);
});

test('6. editing an order (quantity / colour) updates the summary', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 0, 100); w.addStock('1001', 'نبيتي', 0, 100);
  const o = await w.saveOrder({ order_number: 'E', status: PREPARED, slots: line('1001', 'أسود', 10), invoice: 1 });
  assert.equal(rowOf(w, '1001', 'أسود')!.missing, 10);
  await w.saveOrder({ id: o.id, status: PREPARED, slots: line('1001', 'أسود', 4), invoice: 1 });
  assert.equal(rowOf(w, '1001', 'أسود')!.missing, 4);
  await w.saveOrder({ id: o.id, status: PREPARED, slots: line('1001', 'نبيتي', 4), invoice: 1 });
  assert.equal(rowOf(w, '1001', 'أسود'), undefined);
  assert.equal(rowOf(w, '1001', 'نبيتي')!.missing, 4);
});

test('7. new stock reduces the shortage only through allocation (no double reservation)', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 0, 100);
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: line('1001', 'أسود', 10), invoice: 1 });
  await w.saveOrder({ order_number: 'B', status: PREPARED, slots: line('1001', 'أسود', 10), invoice: 1 });
  assert.equal(rowOf(w, '1001', 'أسود')!.missing, 20);
  w.addProduction('1001', 'أسود', 12); await w.resync();
  const r = rowOf(w, '1001', 'أسود')!;
  assert.equal(r.missing, 8);                                                      // 20 − 12, the 12 are held once
  assert.deepEqual(r.orders.map(o => [o.order_number, o.reserved, o.missing]), [['B', 2, 8]]);   // A is now fully covered
  assert.equal(w.readyStock[0].reserved_quantity, 12);
  for (let i = 0; i < 3; i++) await w.resync();
  assert.equal(rowOf(w, '1001', 'أسود')!.missing, 8);                              // idempotent
  w.addProduction('1001', 'أسود', 30); await w.resync();
  assert.equal(rowOf(w, '1001', 'أسود'), undefined);                                // all covered → row disappears
  assert.equal(w.stock().reservedQty, 20);                                         // never more than the 20 requested
  assert.equal(w.stock().availableQty, 42 - 20);
});

test('8. seasons never mix', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 0, 100, 1); w.addStock('1001', 'أسود', 0, 100, 2);
  await w.saveOrder({ season: 1, status: PREPARED, slots: line('1001', 'أسود', 9), invoice: 1 });
  await w.saveOrder({ season: 2, status: PREPARED, slots: line('1001', 'أسود', 5), invoice: 1 });
  w.addProduction('1001', 'أسود', 5, 1);                                            // summer production only
  assert.equal(rowOf(w, '1001', 'أسود', 1)!.missing, 4);
  assert.equal(rowOf(w, '1001', 'أسود', 2)!.missing, 5);                            // winter untouched
  assert.equal(w.missingSummary(1).total_missing_units + w.missingSummary(2).total_missing_units, 9);
});

test('9. repeated calls give identical results and never duplicate quantities', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 3, 100);
  await w.saveOrder({ status: PREPARED, slots: line('1001', 'أسود', 10), invoice: 1 });
  const first = JSON.stringify(w.missingSummary());
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(w.missingSummary()), first);
  const o = w.sales[0];
  for (let i = 0; i < 3; i++) await w.saveOrder({ id: o.id, status: PREPARED, slots: line('1001', 'أسود', 10), invoice: 1 });
  assert.equal(JSON.stringify(w.missingSummary()), first);
  assert.equal(w.missingSummary().total_missing_units, 7);
});

test('model name comes from the stock card; unproduced models (no card) are still listed', async () => {
  const w = new World();
  const card = w.addStock('1001', 'أسود', 0, 100); card.product_name = 'فستان سهرة';
  await w.saveOrder({ status: PREPARED, slots: line('1001', 'أسود', 3), invoice: 1 });
  await w.saveOrder({ status: PREPARED, slots: line('2222', 'أحمر', 2), invoice: 1 });
  const rows = w.missingSummary().rows;
  assert.equal(rows.find(r => r.model_code === '1001')!.model_name, 'فستان سهرة');
  const none = rows.find(r => r.model_code === '2222')!;
  assert.deepEqual([none.has_card, none.missing], [false, 2]);
});
