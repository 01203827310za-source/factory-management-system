// What the shipping company still owes us for an order. Mirrors backend/src/services/receivablesAudit.ts
// (outstandingShippingReceivable) — a parity test in backend/tests compares the two.
export const outstandingCollection = (s: { order_status: string; remaining: number; shipping_collected: number }): number =>
  s.order_status === 'لم يتم الصرف' ? Math.max(0, s.remaining)
  : s.order_status === 'تم الصرف' ? Math.max(0, s.remaining - s.shipping_collected)
  : 0;

/** Whole days from a calendar day (YYYY-MM-DD or ISO timestamp) to `today` (YYYY-MM-DD); never negative. */
export const daysBetween = (iso: string, today: string): number =>
  Math.max(0, Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getTime()) / 86400000));
