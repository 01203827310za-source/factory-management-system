// Pure helpers behind the Ready Stock menus (كل المخزون / المتاح / قائمة لكل كود / النواقص). They only FILTER the rows the page already
// has — nothing here reads or writes the database, changes a balance or computes stock. A backend test compares them with fixed data.
import type { ComputedReadyStock } from '../types';

export type StockView = 'all' | 'available' | 'shortages' | 'model';

const norm = (s: string) => String(s ?? '').trim().toLowerCase();

/** One entry per model code (case / spacing differences are the same model), in natural order, with its number of stock rows. */
export function modelCodesOf(items: Pick<ComputedReadyStock, 'model_code'>[]): { code: string; count: number }[] {
  const seen = new Map<string, { code: string; count: number }>();
  items.forEach(i => {
    const k = norm(i.model_code);
    if (!k) return;
    const e = seen.get(k);
    if (e) e.count += 1; else seen.set(k, { code: String(i.model_code).trim(), count: 1 });
  });
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code, 'ar', { numeric: true }));
}

/** Rows of one menu. «المتاح» = available quantity (actual − reserved) strictly positive; reserved stock is never available. */
export function rowsForView(items: ComputedReadyStock[], view: StockView, model = ''): ComputedReadyStock[] {
  switch (view) {
    case 'available': return items.filter(i => i.available_quantity > 0);
    case 'shortages': return items.filter(i => (i.pending_quantity ?? 0) > 0);   // an outstanding requirement, not merely zero stock
    case 'model': return items.filter(i => norm(i.model_code) === norm(model));
    default: return items;
  }
}

export function matchesSearch(i: Pick<ComputedReadyStock, 'model_code' | 'product_name' | 'color'>, search: string): boolean {
  const q = norm(search);
  if (!q) return true;
  return norm(i.model_code).includes(q) || norm(i.product_name).includes(q) || norm(i.color).includes(q);
}
