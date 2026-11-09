// ============================================
// Physical inventory reconciliation («تسوية المخزون»): the user counts the pieces on the shelf and the system records the difference.
//   adjustment = counted − current physical balance
// The physical balance is derived (opening + production + returns − shipped), so the adjustment is applied to the stock card's base
// balance and written to an append-only ledger (stock_adjustments) that keeps previous / counted / difference / reason / user.
// Reserved quantity is NEVER written: it is derived from the orders. If the count cannot cover the current reservations the
// reconciliation needs an explicit, authorized decision, and the affected orders are listed — no order is changed.
// ============================================

export type ReconciliationPlan = {
  previous_physical: number;
  counted: number;
  difference: number;
  direction: 'increase' | 'decrease' | 'none';
  reserved: number;
  available_before: number;
  available_after: number;
  /** reserved pieces the count cannot cover (the derived reservations of the newest orders shrink and those orders become pending) */
  uncovered_reservations: number;
  reservation_conflict: boolean;
};

export function planReconciliation(input: { previousPhysical: number; reserved: number; counted: number }): ReconciliationPlan {
  const difference = input.counted - input.previousPhysical;
  const uncovered = Math.max(0, input.reserved - input.counted);
  return {
    previous_physical: input.previousPhysical,
    counted: input.counted,
    difference,
    direction: difference > 0 ? 'increase' : difference < 0 ? 'decrease' : 'none',
    reserved: input.reserved,
    available_before: Math.max(0, input.previousPhysical - input.reserved),
    available_after: Math.max(0, input.counted - input.reserved),
    uncovered_reservations: uncovered,
    reservation_conflict: uncovered > 0,
  };
}

/** Whole pieces only; zero is a valid count (an empty shelf). */
export const isValidCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000;
