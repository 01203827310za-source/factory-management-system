// Order lines of a sale — mirrors backend/src/utils/saleLines.ts. A sale carries SALE_SLOT_COUNT model slots
// (model{i}_code / _qty / _color / _extra_qty / _unreturned_qty); every screen walks them through SALE_SLOTS.
export const SALE_SLOT_COUNT = 10;
/** Slots shown on a new order before «إضافة موديل» is pressed. */
export const SALE_SLOTS_SHOWN = 5;
export const SALE_SLOTS: readonly number[] = Array.from({ length: SALE_SLOT_COUNT }, (_, i) => i + 1);

export type SaleLine = { slot: number; code: string; qty: number; color: string; extra: number; unreturned: number | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rec = (s: unknown) => s as Record<string, any>;

/** Every slot of the order (empty ones included), in slot order. */
export function saleLinesOf(s: unknown): SaleLine[] {
  const r = rec(s);
  return SALE_SLOTS.map(i => ({
    slot: i,
    code: String(r[`model${i}_code`] ?? ''),
    qty: Number(r[`model${i}_qty`]) || 0,
    color: String(r[`model${i}_color`] ?? ''),
    extra: Number(r[`model${i}_extra_qty`]) || 0,
    unreturned: r[`model${i}_unreturned_qty`] == null ? null : Number(r[`model${i}_unreturned_qty`]) || 0,
  }));
}

/** Only the filled lines (a code and a positive quantity). */
export const filledLines = (s: unknown) => saleLinesOf(s).filter(l => l.code && l.qty > 0);

/** code / qty / color of the first `upTo` slots (all by default), ready to put in a form or a request body. */
export function slotFields(s?: unknown, upTo: number = SALE_SLOT_COUNT): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  saleLinesOf(s ?? {}).filter(l => l.slot <= upTo).forEach(l => { out[`model${l.slot}_code`] = l.code; out[`model${l.slot}_qty`] = l.qty; out[`model${l.slot}_color`] = l.color; });
  return out;
}

/** Highest slot number that holds anything (0 when the order is empty). */
export const lastUsedSlot = (s: unknown) => saleLinesOf(s).reduce((m, l) => (l.code || l.qty ? l.slot : m), 0);
