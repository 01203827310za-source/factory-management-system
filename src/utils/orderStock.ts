// Which pieces of an order are OUTSIDE the sellable stock. Mirrors backend/src/services/readyStockPositions.ts
// (outsideSlots) so the Ready Stock page, the Dashboard and the reports always agree.
//   shipped                                   → every piece
//   cancelled after shipping, per-line rule   → only the pieces that did not come back resalable
//   cancelled after shipping, older rows      → the whole order unless it was marked returned & resalable
//   reserved / never shipped / old cancelled  → nothing
import type { Sale } from '../types';

export type OutsideSlot = { code: string; qty: number; color: string };

export function outsideSlots(s: Sale): OutsideSlot[] {
  const lines = [
    { code: s.model1_code, qty: s.model1_qty, color: s.model1_color, un: s.model1_unreturned_qty },
    { code: s.model2_code, qty: s.model2_qty, color: s.model2_color, un: s.model2_unreturned_qty },
    { code: s.model3_code, qty: s.model3_qty, color: s.model3_color, un: s.model3_unreturned_qty },
    { code: s.model4_code, qty: s.model4_qty, color: s.model4_color, un: s.model4_unreturned_qty },
    { code: s.model5_code, qty: s.model5_qty, color: s.model5_color, un: s.model5_unreturned_qty },
  ];
  const all = lines.filter(l => l.code && l.qty > 0).map(l => ({ code: l.code, qty: l.qty, color: l.color }));
  if (s.order_status === 'تم الحجز' || (s.order_status === 'لم يتم الصرف' && s.awaiting_stock)) return [];   // held for missing pieces: nothing shipped
  if (s.order_status !== 'تم الإلغاء') return all;
  if (!s.cancel_disposition) return [];
  if (lines.every(l => l.un == null)) return s.cancel_disposition === 'returned_resalable' ? [] : all;
  return lines
    .map(l => ({ code: l.code, color: l.color, qty: Math.min(l.qty, Math.max(0, l.un ?? 0)) }))
    .filter(l => l.code && l.qty > 0);
}
