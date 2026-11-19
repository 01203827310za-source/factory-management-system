// An order holds up to SALE_SLOT_COUNT (10) model lines: lines 6..10 count everywhere lines 1..5 do.
import { assert, test } from './harness';
import { SALE_SLOT_COUNT, SALE_SLOTS, saleLinesOf } from '../src/utils/saleLines';
import { saleSlots, outsideSlots, hasLineReturns } from '../src/services/readyStockPositions';

function order(lines: [string, number, string][], extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = { order_status: 'تم الصرف', cancel_disposition: null, awaiting_stock: false, ...extra };
  SALE_SLOTS.forEach(i => {
    const l = lines[i - 1];
    row[`model${i}_code`] = l?.[0] ?? ''; row[`model${i}_qty`] = l?.[1] ?? 0; row[`model${i}_color`] = l?.[2] ?? '';
  });
  return row;
}
const seven: [string, number, string][] = [
  ['1001', 4, 'اسود'], ['1001', 4, 'ابيض'], ['1001', 4, 'شانيه'], ['1002', 4, 'اسود'], ['1002', 4, 'ابيض'], ['1003', 4, 'اسود'], ['1003', 4, 'شانيه'],
];

test('slots: an order has 10 model lines', () => {
  assert.equal(SALE_SLOT_COUNT, 10);
  assert.deepEqual([...SALE_SLOTS], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('slots: a 7-line shipped order deducts all 7 lines (28 pieces), lines 6 and 7 included', () => {
  const s = saleSlots(order(seven));
  assert.equal(s.length, 7);
  assert.equal(s.reduce((n, l) => n + l.qty, 0), 28);
  assert.deepEqual(s[6], { code: '1003', qty: 4, color: 'شانيه' });
});

test('slots: the sales-only extra of line 8 is excluded from stock like any other line', () => {
  const lines: [string, number, string][] = [...seven, ['1001', 6, 'لبني']];
  const s = saleSlots(order(lines, { model8_extra_qty: 2 }));
  assert.equal(s[7].qty, 4);
});

test('slots: a cancelled shipped order keeps only the unreturned pieces of line 9 outside the stock', () => {
  const lines: [string, number, string][] = [...seven, ['1001', 4, 'لبني'], ['1004', 4, 'اسود']];
  const un: Record<string, unknown> = {}; SALE_SLOTS.forEach(i => { un[`model${i}_unreturned_qty`] = i === 9 ? 3 : 0; });
  const row = order(lines, { order_status: 'تم الإلغاء', cancel_disposition: 'returned_resalable', ...un });
  assert.equal(hasLineReturns(row as never), true);
  assert.deepEqual(outsideSlots(row as never), [{ code: '1004', color: 'اسود', qty: 3 }]);
});

test('slots: an old row that only has columns 1..5 still reads, with lines 6..10 empty', () => {
  const old: Record<string, unknown> = { model1_code: '1001', model1_qty: 4, model1_color: 'اسود' };
  const lines = saleLinesOf(old);
  assert.equal(lines.length, 10);
  assert.equal(lines.filter(l => l.code).length, 1);
});
