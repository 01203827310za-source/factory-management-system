// ============================================
// Ready-stock positions: physical / reserved / available + asset valuation.
//
// Existing model (unchanged):
//   physical (actual) = opening_balance + produced − sold + returned
//   • "sold" = sales whose status is neither 'تم الحجز' (reservation) nor 'تم الإلغاء'
//     (i.e. the goods have left the factory — 'لم يتم الصرف' / 'تم الصرف' / 'حساب عميل';
//     shipping-company payout is a separate, later event tracked by shipping_collected)
//   • a reservation ('تم الحجز') keeps the goods physically in the factory
//   reserved  = Σ qty of reservation orders matched to the stock row
//   available = physical − reserved   (never negative)
//
// Asset rule: stock is valued at PHYSICAL quantity × recorded unit cost. Reservation only
// moves value between "available" and "reserved"; their sum is always the physical value,
// so reserving can never change total assets and nothing is counted twice.
// ============================================

import type { ModelProduction, ReadyStock, ReturnItem, Sale } from '@prisma/client';
import { FuzzyKeyIndex } from '../utils/textMatch';

export const STATUS_RESERVED = 'تم الحجز';
export const STATUS_CANCELED = 'تم الإلغاء';

/** True when the order's goods have physically left the factory (stock is deducted). */
export const isStockDeducting = (status: string) => status !== STATUS_RESERVED && status !== STATUS_CANCELED;

export type Slot = { code: string; qty: number; color: string };

export function saleSlots(s: Pick<Sale,
  'model1_code' | 'model1_qty' | 'model1_color' | 'model2_code' | 'model2_qty' | 'model2_color' |
  'model3_code' | 'model3_qty' | 'model3_color' | 'model4_code' | 'model4_qty' | 'model4_color' |
  'model5_code' | 'model5_qty' | 'model5_color'>): Slot[] {
  return [
    { code: s.model1_code, qty: s.model1_qty, color: s.model1_color },
    { code: s.model2_code, qty: s.model2_qty, color: s.model2_color },
    { code: s.model3_code, qty: s.model3_qty, color: s.model3_color },
    { code: s.model4_code, qty: s.model4_qty, color: s.model4_color },
    { code: s.model5_code, qty: s.model5_qty, color: s.model5_color },
  ].filter(m => m.code && m.qty > 0);
}

export type StockValuation = {
  physicalQty: number; reservedQty: number; availableQty: number;
  physicalValue: number; reservedValue: number; availableValue: number;
};

/**
 * Single valuation rule used by the Dashboard, reports, snapshots and the AI assistant.
 * physical = available + reserved by construction, so reserved goods are never added on top.
 */
export function valueStockRow(actual: number, storedReserved: number, unitCost: number): StockValuation {
  const physicalQty = Math.max(0, actual);
  const reservedQty = Math.min(Math.max(0, storedReserved), physicalQty);
  const availableQty = physicalQty - reservedQty;
  return {
    physicalQty, reservedQty, availableQty,
    physicalValue: physicalQty * unitCost,
    reservedValue: reservedQty * unitCost,
    availableValue: availableQty * unitCost,
  };
}

export type StockPosition = {
  row: ReadyStock;
  key: string;
  /** First stock row for its model+color key — the one reservations are written to. */
  primary: boolean;
  actual: number;
  reserved: number;
  available: number;
};

export type StockContext = {
  positions: StockPosition[];
  keyOf: (code: string, color: string) => string;
  reservedByKey: Map<string, number>;
};

/**
 * Builds positions with the same fuzzy model/colour linking the Dashboard uses. Reservations
 * are derived from the reservation ORDERS themselves (not from the stored counter), so every
 * reserved unit is tied to a specific order. `excludeSaleId` leaves one order out — used when
 * validating that order's own edit.
 */
export function computeStockPositions(
  input: { readyStock: ReadyStock[]; modelProds: ModelProduction[]; sales: Sale[]; returns_: ReturnItem[] },
  opts: { excludeSaleId?: number } = {},
): StockContext {
  const index = new FuzzyKeyIndex(['model', 'color']);
  const keyOf = (code: string, color: string) => index.resolve([code, color || '']);

  const produced = new Map<string, number>();
  input.modelProds.forEach(mp => {
    const k = keyOf(mp.model_code, mp.color || '');
    produced.set(k, (produced.get(k) || 0) + mp.qty_received);
  });

  const sold = new Map<string, number>();
  input.sales.filter(s => isStockDeducting(s.order_status)).forEach(s => {
    saleSlots(s).forEach(m => { const k = keyOf(m.code, m.color); sold.set(k, (sold.get(k) || 0) + m.qty); });
  });

  const returned = new Map<string, number>();
  input.returns_.forEach(r => {
    if (!r.model_code) return;
    const k = keyOf(r.model_code, r.model_color || '');
    returned.set(k, (returned.get(k) || 0) + r.model_qty);
  });

  const rowKeys = input.readyStock.map(rs => keyOf(rs.model_code, rs.color || ''));

  // Reservations are resolved last so they link to existing stock buckets without altering them.
  const reservedByKey = new Map<string, number>();
  input.sales
    .filter(s => s.order_status === STATUS_RESERVED && s.id !== opts.excludeSaleId)
    .forEach(s => saleSlots(s).forEach(m => { const k = keyOf(m.code, m.color); reservedByKey.set(k, (reservedByKey.get(k) || 0) + m.qty); }));

  const seen = new Set<string>();
  const positions: StockPosition[] = input.readyStock.map((rs, i) => {
    const key = rowKeys[i];
    const primary = !seen.has(key);
    seen.add(key);
    const actual = Math.max(0, rs.opening_balance + (produced.get(key) || 0) - (sold.get(key) || 0) + (returned.get(key) || 0));
    const reserved = primary ? (reservedByKey.get(key) || 0) : 0;
    return { row: rs, key, primary, actual, reserved, available: Math.max(0, actual - reserved) };
  });

  return { positions, keyOf, reservedByKey };
}

/** Arabic error for the first slot that cannot be reserved, or null when everything fits. */
export function validateReservation(ctx: StockContext, slots: Slot[]): string | null {
  const demand = new Map<string, { qty: number; code: string; color: string }>();
  for (const m of slots) {
    const k = ctx.keyOf(m.code, m.color);
    const cur = demand.get(k) ?? { qty: 0, code: m.code, color: m.color };
    cur.qty += m.qty;
    demand.set(k, cur);
  }
  for (const [key, need] of demand) {
    const label = `${need.code}${need.color ? ` (${need.color})` : ''}`;
    const pos = ctx.positions.find(p => p.key === key && p.primary);
    if (!pos) return `الموديل ${label} غير موجود في المخزن الجاهز بنفس الكود واللون`;
    if (need.qty > pos.available) {
      return `الكمية المطلوبة من ${label} (${need.qty}) أكبر من المتاح للبيع (${pos.available}) — الفعلي ${pos.actual} والمحجوز لأوردرات أخرى ${pos.reserved}`;
    }
  }
  return null;
}

/** Stock rows whose stored reserved_quantity must change to match the reservation orders. */
export function reservedSyncUpdates(ctx: StockContext, keys: Set<string>): { id: number; from: number; to: number }[] {
  return ctx.positions
    .filter(p => p.primary && keys.has(p.key) && p.row.reserved_quantity !== p.reserved)
    .map(p => ({ id: p.row.id, from: p.row.reserved_quantity, to: p.reserved }));
}
