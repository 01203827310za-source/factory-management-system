// The reservation status keeps its stored value ('تم الحجز'); only its display label changed
// to «يتم التجهيز». Existing orders must keep working and every other status is untouched.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { assert, test } from './harness';
import { World } from './world';
import { STATUS_RESERVED, isStockDeducting } from '../src/services/readyStockPositions';

// The label mapper lives with the frontend (a dependency-free module under an ES-module package),
// so transpile and evaluate it here rather than importing across the package boundary.
function loadLabelModule(): { statusLabel: (s: string) => string; RESERVED_STATUS: string } {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'utils', 'orderStatus.ts'), 'utf-8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const mod = { exports: {} as { statusLabel: (s: string) => string; RESERVED_STATUS: string } };
  new Function('exports', 'module', outputText)(mod.exports, mod);
  return mod.exports;
}
const { statusLabel, RESERVED_STATUS } = loadLabelModule();

test('stored value is unchanged, so existing orders keep working', () => {
  assert.equal(STATUS_RESERVED, 'تم الحجز');
  assert.equal(RESERVED_STATUS, STATUS_RESERVED);
});

test('old stored value displays as «يتم التجهيز»; other statuses display unchanged', () => {
  assert.equal(statusLabel('تم الحجز'), 'يتم التجهيز');
  for (const s of ['تم الصرف', 'لم يتم الصرف', 'حساب عميل', 'تم الإلغاء']) assert.equal(statusLabel(s), s);
  assert.equal(statusLabel('قيمة غير معروفة'), 'قيمة غير معروفة');
});

test('behaviour keyed on the stored value is preserved (prepared stays in stock, shipping deducts once)', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 100, 600);
  const slots = [{ code: 'M1', qty: 10, color: 'أسود' }];
  const o = await w.saveOrder({ status: 'تم الحجز', slots, invoice: 8500 });
  assert.equal(w.stock().physicalQty, 100);            // prepared: still physically in stock
  assert.equal(w.stock().availableQty, 90);
  assert.equal(isStockDeducting('تم الحجز'), false);
  await w.saveOrder({ id: o.id, status: 'لم يتم الصرف', slots, invoice: 8500 });
  assert.equal(w.stock().physicalQty, 90);             // shipped: deducted
  await w.saveOrder({ id: o.id, status: 'تم الصرف', slots, invoice: 8500, collected: 8500 });
  assert.equal(w.stock().physicalQty, 90);             // paid out: not deducted again
});
