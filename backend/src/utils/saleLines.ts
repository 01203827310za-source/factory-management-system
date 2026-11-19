// ============================================
// Order lines of a sale. A sale row carries a fixed number of model slots
// (model{i}_code / _qty / _color / _extra_qty / _unreturned_qty, i = 1..SALE_SLOT_COUNT).
// Every rule that walks an order's lines goes through SALE_SLOTS, so raising the number of
// slots is a schema migration plus this constant — nothing else hard-codes the count.
// ============================================

export const SALE_SLOT_COUNT = 10;
/** [1, 2, …, SALE_SLOT_COUNT] */
export const SALE_SLOTS: readonly number[] = Array.from({ length: SALE_SLOT_COUNT }, (_, i) => i + 1);

type AnyRow = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => Number(v) || 0;

export type SaleLine = { slot: number; code: string; color: string; qty: number; extra: number; unreturned: number | null };

/** Every slot of the row (empty ones included), in slot order. */
export function saleLinesOf(row: AnyRow): SaleLine[] {
  return SALE_SLOTS.map(i => {
    const un = row[`model${i}_unreturned_qty`];
    return {
      slot: i,
      code: str(row[`model${i}_code`]).trim(),
      color: str(row[`model${i}_color`]),
      qty: num(row[`model${i}_qty`]),
      extra: num(row[`model${i}_extra_qty`]),
      unreturned: un == null ? null : num(un),
    };
  });
}
