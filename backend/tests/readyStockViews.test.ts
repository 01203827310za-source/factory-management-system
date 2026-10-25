// Ready Stock menus (كل المخزون / المتاح / قائمة لكل كود / النواقص): the pure filters behind them, checked on rows built exactly like
// GET /api/ready-stock builds them (stock positions: actual, reserved, pending).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { assert, test } from './harness';
import { World } from './world';
import { computeStockPositions } from '../src/services/readyStockPositions';

type Row = { id: number; model_code: string; product_name: string; color: string; actual_balance: number; reserved_quantity: number; available_quantity: number; pending_quantity: number };
const mod = (() => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/utils/readyStockViews.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} as { modelCodesOf: (i: Pick<Row, 'model_code'>[]) => { code: string; count: number }[]; rowsForView: (i: Row[], v: string, m?: string) => Row[]; matchesSearch: (i: Row, q: string) => boolean } };
  new Function('module', 'exports', js)(m, m.exports);
  return m.exports;
})();

const NP = 'لم يتم الصرف', PREP = 'تم الحجز';
const line = (code: string, qty: number, color = 'أسود') => ({ code, qty, color });

/** The same rows the Ready Stock endpoint returns. */
function rowsOf(w: World): Row[] {
  const { positions } = computeStockPositions({ readyStock: w.readyStock, modelProds: w.modelProds, sales: w.sales, returns_: w.returns });
  return w.readyStock.map((r, i) => ({ id: r.id, model_code: r.model_code, product_name: r.product_name, color: r.color, actual_balance: positions[i].actual, reserved_quantity: positions[i].reserved, available_quantity: positions[i].actual - positions[i].reserved, pending_quantity: positions[i].pending }));
}
function build() {
  const w = new World();
  w.addStock('1001', 'أسود', 10, 100); w.addStock('1001', 'أبيض', 0, 100); w.addStock('1002', 'أسود', 5, 100); w.addStock('1002', 'شانيه', 3, 100); w.addStock('1003', 'أسود', 0, 100);
  return w;
}

test('menus: «كل المخزون» shows every row; the model menus are generated from the data, one per code', () => {
  const rows = rowsOf(build());
  assert.equal(mod.rowsForView(rows, 'all').length, 5);
  assert.deepEqual(mod.modelCodesOf(rows), [{ code: '1001', count: 2 }, { code: '1002', count: 2 }, { code: '1003', count: 1 }]);
  // duplicates by case / spacing collapse into one menu
  const dup = [...rows, { ...rows[0], id: 99, model_code: ' 1001 ' }];
  assert.deepEqual(mod.modelCodesOf(dup).map(m => m.code), ['1001', '1002', '1003']);
});

test('menus: a new model code appears in the menus without any code change', () => {
  const w = build();
  assert.equal(mod.modelCodesOf(rowsOf(w)).length, 3);
  w.addStock('2005', 'أحمر', 4, 100);
  assert.deepEqual(mod.modelCodesOf(rowsOf(w)).map(m => m.code), ['1001', '1002', '1003', '2005']);
});

test('menus: each model menu holds only its own model and all of its colours', () => {
  const rows = rowsOf(build());
  const m1002 = mod.rowsForView(rows, 'model', '1002');
  assert.deepEqual(m1002.map(r => [r.model_code, r.color]), [['1002', 'أسود'], ['1002', 'شانيه']]);
  assert.equal(mod.rowsForView(rows, 'model', ' 1001 ').length, 2);                // spacing / case do not matter
  assert.deepEqual(mod.rowsForView(rows, 'model', 'nope'), []);
});

test('menus: «المتاح» keeps only rows with positive AVAILABLE quantity (reserved stock is not available)', async () => {
  const w = build();
  await w.saveOrder({ order_number: 'R', status: PREP, slots: [line('1002', 5)], invoice: 500 });          // reserves all 5 of 1002 أسود
  const rows = rowsOf(w);
  const av = mod.rowsForView(rows, 'available');
  assert.deepEqual(av.map(r => [r.model_code, r.color]).sort(), [['1001', 'أسود'], ['1002', 'شانيه']].sort());   // 1002 أسود: actual 5, available 0
  assert.equal(av.every(r => r.available_quantity > 0), true);
  const neg = [{ ...rows[0], available_quantity: -3 }, { ...rows[0], id: 7, available_quantity: 0 }];
  assert.equal(mod.rowsForView(neg, 'available').length, 0);
});

test('menus: «النواقص» are real outstanding requirements — zero stock alone is not a shortage', async () => {
  const w = build();                                                          // 1001 أبيض and 1003 أسود have ZERO stock but no order needs them
  assert.deepEqual(mod.rowsForView(rowsOf(w), 'shortages'), []);
  await w.saveOrder({ order_number: 'S', status: PREP, slots: [line('1003', 6)], invoice: 600 });         // an order needs 6 that do not exist
  const sh = mod.rowsForView(rowsOf(w), 'shortages');
  assert.deepEqual(sh.map(r => [r.model_code, r.pending_quantity]), [['1003', 6]]);
});

test('menus: a sales-only extra quantity never appears as a shortage', async () => {
  const w = build();
  const o = await w.saveOrder({ order_number: 'NP', status: NP, slots: [line('1001', 8)], invoice: 800 });   // really ships 8
  await w.saveOrder({ id: o.id, status: NP, slots: [line('1001', 20)], invoice: 2000 });                    // +12 is sales-only
  assert.deepEqual(mod.rowsForView(rowsOf(w), 'shortages'), []);
});

test('menus: search works on top of the selected menu', () => {
  const rows = rowsOf(build());
  const inModel = mod.rowsForView(rows, 'model', '1002').filter(r => mod.matchesSearch(r, 'شانيه'));
  assert.deepEqual(inModel.map(r => r.color), ['شانيه']);
  assert.equal(rows.filter(r => mod.matchesSearch(r, '1001')).length, 2);
  assert.equal(mod.rowsForView(rows, 'available').filter(r => mod.matchesSearch(r, 'zzz')).length, 0);
});

test('menus: switching menus only filters — the rows (balances, reservations) are never modified', async () => {
  const w = build();
  await w.saveOrder({ order_number: 'R', status: PREP, slots: [line('1002', 2)], invoice: 200 });
  const rows = rowsOf(w);
  const frozen = JSON.stringify(rows);
  const stockBefore = JSON.stringify([w.readyStock, w.sales, w.movements]);
  for (const v of ['all', 'available', 'shortages', 'model']) mod.rowsForView(rows, v, '1001');
  mod.modelCodesOf(rows);
  assert.equal(JSON.stringify(rows), frozen);
  assert.equal(JSON.stringify([w.readyStock, w.sales, w.movements]), stockBefore);
});
