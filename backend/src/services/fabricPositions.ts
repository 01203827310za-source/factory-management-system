// ============================================
// Fabric warehouse positions — one rule for every screen and report.
//
// One colour of fabric can live on several warehouse rows: the same colour typed with two spellings
// («ملتون» / «ميلتون», «برجاندي» / «بيرجاندى») or a new purchase that opened its own row. Cutting orders
// consume a colour, not a row. The consumption of a colour is therefore drawn ONCE across all of its rows,
// oldest row first — it is never subtracted in full from every row (which used to swallow every new purchase).
// Any consumption beyond what was ever received stays on the colour's newest row, so a real shortage is
// still visible there as a negative balance; valuation never counts a negative balance.
// ============================================

import { FuzzyKeyIndex } from '../utils/textMatch';

type FabricRow = { id: number; material_type: string; color: string; qty_in: number; cost_per_kg: number; avg_cost_per_kg?: number | null };
type CutRow = { material_type: string; color: string; kg_consumed: number };

export type FabricPosition<T extends FabricRow> = {
  row: T;
  /** kg of this row used by cutting orders. */
  consumed: number;
  /** qty_in − consumed (negative only on a colour's newest row when more was cut than ever received). */
  available: number;
  /** weighted average cost, falling back to the entry cost. */
  unitCost: number;
  /** max(0, available) × unitCost. */
  value: number;
};

export function computeFabricPositions<T extends FabricRow>(fabric: T[], cutting: CutRow[]): FabricPosition<T>[] {
  // Same key rule (and the same resolve order: cutting first, then fabric) the screens have always used.
  const index = new FuzzyKeyIndex(['color', 'color']); // [material_type, color]
  const left = new Map<string, number>();
  cutting.forEach(c => {
    const k = index.resolve([c.material_type, c.color]);
    left.set(k, (left.get(k) || 0) + (Number(c.kg_consumed) || 0));
  });

  const keyOf = new Map<T, string>();
  fabric.forEach(f => keyOf.set(f, index.resolve([f.material_type, f.color])));

  const ordered = [...fabric].sort((a, b) => a.id - b.id);   // oldest row first
  const newestOfKey = new Map<string, T>();
  ordered.forEach(f => newestOfKey.set(keyOf.get(f)!, f));

  const byRow = new Map<T, FabricPosition<T>>();
  ordered.forEach(f => {
    const k = keyOf.get(f)!;
    const remaining = left.get(k) || 0;
    const take = newestOfKey.get(k) === f ? remaining : Math.min(Math.max(0, f.qty_in), remaining);
    left.set(k, remaining - take);
    const available = f.qty_in - take;
    const unitCost = (f.avg_cost_per_kg ?? 0) > 0 ? Number(f.avg_cost_per_kg) : f.cost_per_kg;
    byRow.set(f, { row: f, consumed: take, available, unitCost, value: Math.max(0, available) * unitCost });
  });
  return fabric.map(f => byRow.get(f)!);
}
