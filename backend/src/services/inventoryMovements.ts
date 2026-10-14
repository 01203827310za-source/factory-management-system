// ============================================
// Inventory-movement (cost) ledger — pure planning logic (no DB access).
//
// When an order's goods physically leave the factory (status leaves 'تم الحجز' and is not
// cancelled), one SHIP row per model slot snapshots the stock card's recorded unit cost.
// planMovements() compares what the ledger already holds for the order with what the order
// needs NOW and returns only the difference, so:
//   • re-saving an order                        → nothing is added  (no duplicate cost)
//   • 'لم يتم الصرف' → 'تم الصرف' (payout)       → nothing is added  (stock was deducted on shipping)
//   • quantity edited while shipped             → only the delta (SHIP or SHIP_REVERSAL)
//   • un-shipped (back to a reservation)        → SHIP_REVERSAL at the originally recorded cost
// Cost of goods sold = Σ SHIP cost − Σ SHIP_REVERSAL cost (− cost of returned goods, see below).
// ============================================

import type { Slot } from './readyStockPositions';

export type MovementType = 'SHIP' | 'SHIP_REVERSAL';

export type MovementRow = {
  movement_type: string;
  model_code: string;
  color: string;
  qty: number;
  unit_cost: number;
  total_cost: number;
  stock_id?: number | null;
};

export type NewMovement = {
  movement_type: MovementType;
  model_code: string;
  color: string;
  qty: number;
  unit_cost: number;
  total_cost: number;
  stock_id: number | null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Net = { qty: number; cost: number; code: string; color: string };

/** Net shipped qty / cost per model key (SHIP counts +, SHIP_REVERSAL counts −). */
export function netMovements(rows: MovementRow[], keyOf: (code: string, color: string) => string): Map<string, Net> {
  const m = new Map<string, Net>();
  rows.forEach(r => {
    const k = keyOf(r.model_code, r.color);
    const sign = r.movement_type === 'SHIP' ? 1 : -1;
    const cur = m.get(k) ?? { qty: 0, cost: 0, code: r.model_code, color: r.color };
    cur.qty += sign * r.qty;
    cur.cost += sign * r.total_cost;
    m.set(k, cur);
  });
  return m;
}

export function planMovements(args: {
  existing: MovementRow[];
  /** What the order needs shipped right now ([] when it is not in a shipped state). */
  desired: Slot[];
  keyOf: (code: string, color: string) => string;
  /** Recorded cost source for new shipments (the matching stock card), or null when none matches. */
  costOf: (key: string) => { unit_cost: number; stock_id: number } | null;
}): NewMovement[] {
  const have = netMovements(args.existing, args.keyOf);

  const want = new Map<string, { qty: number; code: string; color: string }>();
  args.desired.forEach(s => {
    const k = args.keyOf(s.code, s.color);
    const cur = want.get(k) ?? { qty: 0, code: s.code, color: s.color };
    cur.qty += s.qty;
    want.set(k, cur);
  });

  const out: NewMovement[] = [];
  const keys = new Set<string>([...have.keys(), ...want.keys()]);
  keys.forEach(k => {
    const h = have.get(k);
    const w = want.get(k);
    const diff = (w?.qty ?? 0) - (h?.qty ?? 0);
    if (diff === 0) return;
    const code = w?.code ?? h!.code;
    const color = w?.color ?? h!.color;

    if (diff > 0) {
      const src = args.costOf(k);
      const unit = src?.unit_cost ?? 0;
      out.push({ movement_type: 'SHIP', model_code: code, color, qty: diff, unit_cost: unit, total_cost: round2(diff * unit), stock_id: src?.stock_id ?? null });
    } else {
      // Reverse at the cost that was ACTUALLY recorded when it shipped, not today's card cost.
      const qty = -diff;
      const unit = h && h.qty > 0 ? h.cost / h.qty : 0;
      out.push({ movement_type: 'SHIP_REVERSAL', model_code: code, color, qty, unit_cost: round2(unit), total_cost: round2(qty * unit), stock_id: null });
    }
  });
  return out;
}

/** Σ SHIP cost − Σ SHIP_REVERSAL cost. */
export function costOfGoodsShipped(rows: Pick<MovementRow, 'movement_type' | 'total_cost'>[]): number {
  return round2(rows.reduce((s, r) => s + (r.movement_type === 'SHIP' ? r.total_cost : -r.total_cost), 0));
}

/**
 * Cost credited back for returned goods that were actually received: qty × the average unit cost
 * recorded when THAT order shipped. Returns that cannot be tied to a costed shipment get no credit
 * (and are counted) rather than being guessed.
 */
export function returnsCostCredit(args: {
  returns: { order_number: string; model_code: string; model_color: string; model_qty: number }[];
  movementsByOrder: Map<string, MovementRow[]>;
  keyOf: (code: string, color: string) => string;
}): { credit: number; unmatched: number } {
  let credit = 0;
  let unmatched = 0;
  args.returns.forEach(r => {
    if (!r.model_code || r.model_qty <= 0) return;
    const rows = args.movementsByOrder.get(r.order_number);
    const net = rows ? netMovements(rows, args.keyOf).get(args.keyOf(r.model_code, r.model_color || '')) : undefined;
    if (!net || net.qty <= 0) { unmatched += 1; return; }
    const unit = net.cost / net.qty;
    credit += Math.min(r.model_qty, net.qty) * unit;
  });
  return { credit: round2(credit), unmatched };
}
