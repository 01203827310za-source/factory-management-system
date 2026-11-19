// Which pieces of an order are OUTSIDE the sellable stock. Mirrors backend/src/services/readyStockPositions.ts
// (outsideSlots) so the Ready Stock page, the Dashboard and the reports always agree.
//   shipped                                   → every piece
//   cancelled after shipping, per-line rule   → only the pieces that did not come back resalable
//   cancelled after shipping, older rows      → the whole order unless it was marked returned & resalable
//   reserved / never shipped / old cancelled  → nothing
import type { Sale } from '../types';

// Kept free of runtime imports on purpose: the backend tests transpile this file on its own to compare it with the server rule.
// Must match SALE_SLOT_COUNT in utils/saleLines.ts.
const SLOT_COUNT = 10;

export type OutsideSlot = { code: string; qty: number; color: string };

export function outsideSlots(s: Sale): OutsideSlot[] {
  const r = s as unknown as Record<string, unknown>;
  const lines = Array.from({ length: SLOT_COUNT }, (_, k) => k + 1).map(i => ({
    code: String(r[`model${i}_code`] ?? ''),
    qty: (Number(r[`model${i}_qty`]) || 0) - (Number(r[`model${i}_extra_qty`]) || 0),
    color: String(r[`model${i}_color`] ?? ''),
    un: r[`model${i}_unreturned_qty`] == null ? null : Number(r[`model${i}_unreturned_qty`]) || 0,
  }));
  const all = lines.filter(l => l.code && l.qty > 0).map(l => ({ code: l.code, qty: l.qty, color: l.color }));
  if (s.order_status === 'تم الحجز' || (s.order_status === 'لم يتم الصرف' && s.awaiting_stock)) return [];   // held for missing pieces: nothing shipped
  if (s.order_status !== 'تم الإلغاء') return all;
  if (!s.cancel_disposition) return [];
  if (lines.every(l => l.un == null)) return s.cancel_disposition === 'returned_resalable' ? [] : all;
  return lines
    .map(l => ({ code: l.code, color: l.color, qty: Math.min(l.qty, Math.max(0, l.un ?? 0)) }))
    .filter(l => l.code && l.qty > 0);
}
