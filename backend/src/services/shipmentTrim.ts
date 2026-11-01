// ============================================
// Shipping an order for more pieces than can actually be shipped («تم الصرف» requested explicitly):
// instead of blocking, each stock line (model + colour, matched the same fuzzy way stock is) ships what exists and is NOT held for
// other orders; the excess is removed from the order completely (not reserved, not a shortage, not in sales or the invoice).
// The invoice follows the quantities proportionally — the order has one invoice value and no per-line prices, so no price is invented.
// ============================================
import type { computeStockPositions } from './readyStockPositions';

type Ctx = ReturnType<typeof computeStockPositions>;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type TrimLine = { index: number; code: string; color: string; requested: number; shippable: number; removed: number };
export type TrimPlan = {
  needs_trim: boolean;
  lines: TrimLine[];                  // only lines that have a model and a quantity
  requested_total: number; shippable_total: number; removed_total: number;
  invoice_before: number; invoice_after: number; deposit: number; remaining_after: number;
};

export function planShipmentTrim(ctx: Ctx, lines: { code: string; color: string; qty: number }[], invoice: number, deposit: number): TrimPlan {
  const left = new Map<string, number>();
  const take = (key: string) => {
    if (!left.has(key)) { const pos = ctx.positions.find(p => p.key === key && p.primary); left.set(key, Math.max(0, pos ? pos.available : 0)); }
    return left.get(key)!;
  };
  const out: TrimLine[] = [];
  lines.forEach((l, index) => {
    if (!l.code || !(l.qty > 0)) return;
    const key = ctx.keyOf(l.code, l.color);
    const shippable = Math.min(l.qty, take(key));
    left.set(key, take(key) - shippable);
    out.push({ index, code: l.code, color: l.color, requested: l.qty, shippable, removed: l.qty - shippable });
  });
  const requested_total = out.reduce((n, l) => n + l.requested, 0);
  const shippable_total = out.reduce((n, l) => n + l.shippable, 0);
  const removed_total = requested_total - shippable_total;
  const invoice_after = removed_total > 0 && requested_total > 0 ? round2(invoice * shippable_total / requested_total) : invoice;
  return {
    needs_trim: removed_total > 0, lines: out, requested_total, shippable_total, removed_total,
    invoice_before: invoice, invoice_after, deposit, remaining_after: round2(invoice_after - deposit),
  };
}

/** The user's confirmation names the shippable quantity of every line; it only counts if it still matches the current stock. */
export function confirmationMatches(confirm: unknown, plan: TrimPlan): boolean {
  const arr = (confirm as { shippable?: unknown } | null | undefined)?.shippable;
  if (!Array.isArray(arr)) return false;
  return plan.lines.every(l => Number(arr[l.index]) === l.shippable);
}

/** Writes the trimmed lines, invoice and (if needed) the pre-filled received amount back into the request data. */
export function applyTrim(data: Record<string, unknown>, plan: TrimPlan): void {
  plan.lines.forEach(l => {
    const i = l.index + 1;
    if (l.shippable > 0) data[`model${i}_qty`] = l.shippable;
    else { data[`model${i}_code`] = ''; data[`model${i}_color`] = ''; data[`model${i}_qty`] = 0; }
  });
  data.invoice_value = plan.invoice_after;
  const maxCollected = Math.max(0, plan.remaining_after);
  if (Number(data.shipping_collected) > maxCollected) data.shipping_collected = maxCollected;   // cannot receive more than the corrected balance
}
