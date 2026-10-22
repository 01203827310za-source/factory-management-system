// «المبيعات الشهرية حسب الموديل»: pieces per model from orders currently «تم الصرف», by the payout month.
import { assert, test } from './harness';
import { World } from './world';
import { monthlySalesByModel } from '../src/services/monthlySales';

const PREPARED = 'تم الحجز';
const NOT_PAID_OUT = 'لم يتم الصرف';
const PAID_OUT = 'تم الصرف';
const CANCELED = 'تم الإلغاء';
const line = (code: string, qty: number, color = 'أسود') => ({ code, qty, color });

function world() {
  const w = new World();
  for (const [code, color] of [['M1', 'أسود'], ['M1', 'أبيض'], ['M2', 'أسود'], ['M2', 'أبيض'], ['M3', 'أسود']]) w.addStock(code, color, 500, 100);
  return w;
}
const report = (w: World, month: string, season = 1) => monthlySalesByModel(w.sales.filter(s => s.season_id === season), month, new Map([['m1', 'هودي']]));
const qtyOf = (r: ReturnType<typeof report>, code: string) => r.rows.find(x => x.model_code === code)?.qty ?? 0;

test('monthly sales: several paid-out orders of the same model are combined into one row', async () => {
  const w = world();
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 10)], invoice: 1000, collected: 1000, date: '2026-10-05' });
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 7)], invoice: 700, collected: 700, date: '2026-10-20' });
  const r = report(w, '2026-10');
  assert.deepEqual(r.rows.map(x => [x.model_code, x.model_name, x.qty, x.order_count]), [['M1', 'هودي', 17, 2]]);
  assert.equal(r.total_qty, 17);
});

test('monthly sales: an order with several models counts each model separately; colours are broken down', async () => {
  const w = world();
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 4, 'أسود'), line('M1', 6, 'أبيض'), line('M2', 5)], invoice: 3000, collected: 3000, date: '2026-10-05' });
  const r = report(w, '2026-10');
  assert.equal(qtyOf(r, 'M1'), 10);
  assert.equal(qtyOf(r, 'M2'), 5);
  assert.deepEqual(r.rows.find(x => x.model_code === 'M1')!.colors, [{ color: 'أبيض', qty: 6 }, { color: 'أسود', qty: 4 }]);
  assert.equal(r.total_qty, 15);
  assert.equal(r.order_count, 1);
});

test('monthly sales: reserved, prepared, shipped-but-unpaid and cancelled orders are excluded', async () => {
  const w = world();
  await w.saveOrder({ status: PREPARED, slots: [line('M1', 3)], invoice: 300 });
  await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M1', 4)], invoice: 400 });
  const gone = await w.saveOrder({ status: NOT_PAID_OUT, slots: [line('M2', 9)], invoice: 900 });
  await w.saveOrder({ id: gone.id, status: CANCELED, slots: [line('M2', 9)], invoice: 900 });
  await w.saveOrder({ status: PAID_OUT, slots: [line('M3', 2)], invoice: 200, collected: 200, date: '2026-10-05' });
  const r = report(w, '2026-10');
  assert.deepEqual(r.rows.map(x => [x.model_code, x.qty]), [['M3', 2]]);
  assert.equal(r.total_qty, 2);
});

test('monthly sales: month boundaries and year changes follow the payout date, not the creation date', async () => {
  const w = world();
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 1)], invoice: 100, collected: 100, date: '2026-09-30' });
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 2)], invoice: 100, collected: 100, date: '2026-10-01' });
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 4)], invoice: 100, collected: 100, date: '2026-10-31' });
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 8)], invoice: 100, collected: 100, date: '2026-11-01' });
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 16)], invoice: 100, collected: 100, date: '2025-12-31' });
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 32)], invoice: 100, collected: 100, date: '2026-01-01' });
  assert.deepEqual(['2026-09', '2026-10', '2026-11', '2025-12', '2026-01'].map(m => report(w, m).total_qty), [1, 6, 8, 16, 32]);
  assert.equal(report(w, '2026-02').rows.length, 0);                       // empty month → empty state
  assert.deepEqual(report(w, '2026-10').available_months, ['2026-11', '2026-10', '2026-09', '2026-01', '2025-12']);
  assert.equal(qtyOf(report(w, '2026-10'), 'M1'), 6);
  assert.equal(report(w, '2026-10').rows[0].all_time_qty, 63);             // all months, same model
});

test('monthly sales: an order created in one month and paid out in another counts in the payout month only', async () => {
  const w = world();                                                         // created_at is 2026-10-01
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 5)], invoice: 500, collected: 500, date: '2026-12-15' });
  assert.equal(report(w, '2026-10').total_qty, 0);
  assert.equal(report(w, '2026-12').total_qty, 5);
});

test('monthly sales: seasons never mix', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 500, 100, 1); w.addStock('M1', 'أسود', 500, 100, 2);
  await w.saveOrder({ season: 1, status: PAID_OUT, slots: [line('M1', 5)], invoice: 500, collected: 500, date: '2026-10-05' });
  await w.saveOrder({ season: 2, status: PAID_OUT, slots: [line('M1', 9)], invoice: 900, collected: 900, date: '2026-10-05' });
  assert.deepEqual([report(w, '2026-10', 1).total_qty, report(w, '2026-10', 2).total_qty], [5, 9]);
});

test('monthly sales: editing a paid-out order re-derives the report; saving it again never doubles it', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 10)], invoice: 1000, collected: 1000, date: '2026-10-05' });
  for (let i = 0; i < 3; i++) await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [line('M1', 10)], invoice: 1000, collected: 1000, date: '2026-10-05' });
  assert.equal(report(w, '2026-10').total_qty, 10);
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [line('M1', 6), line('M2', 2)], invoice: 800, collected: 800, date: '2026-10-05' });
  const r = report(w, '2026-10');
  assert.deepEqual(r.rows.map(x => [x.model_code, x.qty]).sort(), [['M1', 6], ['M2', 2]]);
  assert.equal(r.total_qty, 8);
});

test('monthly sales: cancelling a paid-out order removes it; reopening to «تم الصرف» brings it back once', async () => {
  const w = world();
  const o = await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 10)], invoice: 1000, collected: 1000, date: '2026-10-05' });
  await w.saveOrder({ order_number: 'other', status: PAID_OUT, slots: [line('M1', 3)], invoice: 300, collected: 300, date: '2026-10-06' });
  assert.equal(report(w, '2026-10').total_qty, 13);
  await w.saveOrder({ id: o.id, status: CANCELED, slots: [line('M1', 10)], invoice: 1000 });
  await w.saveOrder({ id: o.id, status: CANCELED, slots: [line('M1', 10)], invoice: 1000 });
  assert.equal(report(w, '2026-10').total_qty, 3);
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [line('M1', 10)], invoice: 1000, collected: 1000, date: '2026-11-02' });
  assert.deepEqual([report(w, '2026-10').total_qty, report(w, '2026-11').total_qty], [3, 10]);
});

test('monthly sales: the grand total equals the sum of the model rows; invoice amounts are never counted as pieces', async () => {
  const w = world();
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 3), line('M2', 4), line('M3', 5)], invoice: 987654, collected: 987654, date: '2026-10-05' });
  await w.saveOrder({ status: PAID_OUT, slots: [line('M2', 6, 'أبيض')], invoice: 123456, collected: 123456, date: '2026-10-09' });
  const r = report(w, '2026-10');
  assert.equal(r.total_qty, r.rows.reduce((n, x) => n + x.qty, 0));
  assert.equal(r.total_qty, 18);
  assert.equal(r.rows.every(x => x.colors.reduce((n, c) => n + c.qty, 0) === x.qty), true);
});

test('monthly sales: a paid-out order with no recorded payout date falls back to its creation month and is flagged estimated', async () => {
  const w = world();
  await w.saveOrder({ status: PAID_OUT, slots: [line('M1', 5)], invoice: 500, collected: 500, date: '2026-10-05' });
  w.sales[0].shipping_collected_date = null;                                 // an order confirmed before the date column existed
  const r = report(w, '2026-10');                                           // created 2026-10-01
  assert.deepEqual([r.total_qty, r.estimated_orders], [5, 1]);
});
