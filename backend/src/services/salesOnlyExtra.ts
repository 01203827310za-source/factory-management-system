// ============================================
// Sales-only extra (see migration 20261022100000): pieces added to an order that stays «لم يتم الصرف» / «تم الصرف».
// They count in the order (quantity and value) but never in stock. The split is decided per STOCK KEY (model + colour, matched the
// same fuzzy way stock is), not per form line, so re-picking the colour, adding a second line of the same model or moving a line
// to another row cannot turn an ordinary quantity edit into a shipment.
// ============================================

export type OrderedLine = { code: string; color: string; qty: number };
export type ExistingLine = OrderedLine & { extra: number };

/**
 * Extra per NEW line. For each stock key: the extra follows the change in the ordered total (up → more extra, down → the extra is
 * removed first, then real stock quantity). A key that was not on the order before has no extra (it is a new item to validate/ship).
 * The extra is placed on the LAST lines of the key so the first lines keep the quantity stock already accounted for.
 */
export function planExtras(existing: ExistingLine[], next: OrderedLine[], keyOf: (code: string, color: string) => string): number[] {
  const oldTotal = new Map<string, number>();
  const oldExtra = new Map<string, number>();
  existing.filter(l => l.code && l.qty > 0).forEach(l => {
    const k = keyOf(l.code, l.color);
    oldTotal.set(k, (oldTotal.get(k) ?? 0) + l.qty);
    oldExtra.set(k, (oldExtra.get(k) ?? 0) + l.extra);
  });
  const newTotal = new Map<string, number>();
  next.forEach(l => { if (l.code && l.qty > 0) { const k = keyOf(l.code, l.color); newTotal.set(k, (newTotal.get(k) ?? 0) + l.qty); } });

  const extraLeft = new Map<string, number>();
  newTotal.forEach((total, k) => {
    if (!oldTotal.has(k)) { extraLeft.set(k, 0); return; }
    extraLeft.set(k, Math.min(total, Math.max(0, (oldExtra.get(k) ?? 0) + (total - (oldTotal.get(k) ?? 0)))));
  });

  const out = next.map(() => 0);
  for (let i = next.length - 1; i >= 0; i--) {
    const l = next[i];
    if (!l.code || l.qty <= 0) continue;
    const k = keyOf(l.code, l.color);
    const take = Math.min(l.qty, extraLeft.get(k) ?? 0);
    out[i] = take;
    extraLeft.set(k, (extraLeft.get(k) ?? 0) - take);
  }
  return out;
}
