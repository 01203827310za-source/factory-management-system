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
  /** opening + produced + returned — what the card could supply before shipments. */
  supply: number;
  /** Pieces shipped against this card (orders that left the factory). */
  sold: number;
  actual: number;
  reserved: number;
  /** Units still needed by «يتم التجهيز» orders for this model+colour (not yet produced/purchased). */
  pending: number;
  available: number;
};

export type SlotAllocation = {
  code: string;
  color: string;
  requested: number;
  /** Units of REAL stock held for this order (never more than physically exists). */
  reserved: number;
  /** requested − reserved: still to be produced / purchased. */
  pending: number;
  /** false when no ready-stock card exists for this model+colour (nothing can be reserved yet). */
  has_card: boolean;
};

export type OrderAllocation = {
  sale_id: number;
  slots: SlotAllocation[];
  requested: number;
  reserved: number;
  pending: number;
};

export type StockContext = {
  positions: StockPosition[];
  keyOf: (code: string, color: string) => string;
  /** Σ allocated (real) reservations per key. */
  reservedByKey: Map<string, number>;
  /** Σ units still needed by «يتم التجهيز» orders per key (includes keys with no stock card). */
  pendingByKey: Map<string, number>;
  /** Per prepared order: requested / reserved / pending, by slot. */
  allocations: Map<number, OrderAllocation>;
};

/**
 * Builds positions with the same fuzzy model/colour linking the Dashboard uses.
 *
 * Reservations are ALLOCATED, not assumed: «يتم التجهيز» orders (status stored as 'تم الحجز') are
 * served first-come-first-served (by order id) from the stock that physically exists after
 * shipments. An order asking for 10 when 4 exist holds 4 and is left with 6 pending. Because the
 * allocation is derived from the orders and the stock every time, it is idempotent: re-saving an
 * order, recording production or recording a return simply re-derives it — units are never held
 * twice and reserved can never exceed physical stock.
 *
 * `excludeSaleId` leaves one order out entirely (its shipments and its reservation) — used to ask
 * "what could THIS order get / ship?" independently of itself.
 */
export function computeStockPositions(
  input: { readyStock: ReadyStock[]; modelProds: ModelProduction[]; sales: Sale[]; returns_: ReturnItem[] },
  opts: { excludeSaleId?: number } = {},
): StockContext {
  const index = new FuzzyKeyIndex(['model', 'color']);
  const keyOf = (code: string, color: string) => index.resolve([code, color || '']);
  const counted = (s: Sale) => s.id !== opts.excludeSaleId;

  const produced = new Map<string, number>();
  input.modelProds.forEach(mp => {
    const k = keyOf(mp.model_code, mp.color || '');
    produced.set(k, (produced.get(k) || 0) + mp.qty_received);
  });

  const sold = new Map<string, number>();
  input.sales.filter(s => counted(s) && isStockDeducting(s.order_status)).forEach(s => {
    saleSlots(s).forEach(m => { const k = keyOf(m.code, m.color); sold.set(k, (sold.get(k) || 0) + m.qty); });
  });

  const returned = new Map<string, number>();
  input.returns_.forEach(r => {
    if (!r.model_code) return;
    const k = keyOf(r.model_code, r.model_color || '');
    returned.set(k, (returned.get(k) || 0) + r.model_qty);
  });

  const rowKeys = input.readyStock.map(rs => keyOf(rs.model_code, rs.color || ''));

  // Physical stock per key (first card of a key is the one that holds it).
  const physical = new Map<string, number>();
  const supplyByKey = new Map<string, number>();
  const firstRowOfKey = new Map<string, number>();
  input.readyStock.forEach((rs, i) => {
    const key = rowKeys[i];
    if (firstRowOfKey.has(key)) return;
    firstRowOfKey.set(key, i);
    const supply = rs.opening_balance + (produced.get(key) || 0) + (returned.get(key) || 0);
    supplyByKey.set(key, supply);
    physical.set(key, Math.max(0, supply - (sold.get(key) || 0)));
  });

  // First-come-first-served allocation of that physical stock to the prepared orders.
  const pool = new Map(physical);
  const reservedByKey = new Map<string, number>();
  const pendingByKey = new Map<string, number>();
  const allocations = new Map<number, OrderAllocation>();
  input.sales
    .filter(s => counted(s) && s.order_status === STATUS_RESERVED)
    .sort((a, b) => a.id - b.id)
    .forEach(s => {
      const slots: SlotAllocation[] = saleSlots(s).map(m => {
        const key = keyOf(m.code, m.color);
        const hasCard = firstRowOfKey.has(key);
        const take = hasCard ? Math.min(m.qty, pool.get(key) || 0) : 0;
        if (hasCard) pool.set(key, (pool.get(key) || 0) - take);
        reservedByKey.set(key, (reservedByKey.get(key) || 0) + take);
        pendingByKey.set(key, (pendingByKey.get(key) || 0) + (m.qty - take));
        return { code: m.code, color: m.color, requested: m.qty, reserved: take, pending: m.qty - take, has_card: hasCard };
      });
      allocations.set(s.id, {
        sale_id: s.id, slots,
        requested: slots.reduce((n, x) => n + x.requested, 0),
        reserved: slots.reduce((n, x) => n + x.reserved, 0),
        pending: slots.reduce((n, x) => n + x.pending, 0),
      });
    });

  const positions: StockPosition[] = input.readyStock.map((rs, i) => {
    const key = rowKeys[i];
    const primary = firstRowOfKey.get(key) === i;
    const actual = primary ? (physical.get(key) || 0) : Math.max(0, rs.opening_balance);
    const reserved = primary ? (reservedByKey.get(key) || 0) : 0;
    return {
      row: rs, key, primary,
      supply: primary ? (supplyByKey.get(key) || 0) : 0,
      sold: primary ? (sold.get(key) || 0) : 0,
      actual: primary ? actual : 0,
      reserved,
      pending: primary ? (pendingByKey.get(key) || 0) : 0,
      available: Math.max(0, (primary ? actual : 0) - reserved),
    };
  });

  return { positions, keyOf, reservedByKey, pendingByKey, allocations };
}

/**
 * Shipping check. Goods may only leave the factory if they physically exist AND are not held for
 * other prepared orders. Partial shipment is not supported, so any shortfall rejects the shipment
 * with an Arabic explanation. Pass a context built with `excludeSaleId = this order` so the order
 * is judged against stock minus everyone ELSE's shipments and reservations.
 * `only` limits the check to model+colour keys whose shipped quantity is actually increasing, so
 * unrelated edits to an order that already shipped are never blocked.
 */
export function validateShipment(ctx: StockContext, slots: Slot[], only?: Set<string>): string | null {
  const demand = new Map<string, { qty: number; code: string; color: string }>();
  for (const m of slots) {
    const k = ctx.keyOf(m.code, m.color);
    if (only && !only.has(k)) continue;
    const cur = demand.get(k) ?? { qty: 0, code: m.code, color: m.color };
    cur.qty += m.qty;
    demand.set(k, cur);
  }
  for (const [key, need] of demand) {
    const label = `${need.code}${need.color ? ` (${need.color})` : ''}`;
    const pos = ctx.positions.find(p => p.key === key && p.primary);
    if (!pos) return `لا يمكن شحن ${label}: لا يوجد كارت مخزون بهذا الكود واللون — سجّل الإنتاج/الشراء أولًا`;
    if (need.qty > pos.available) {
      return `لا يمكن شحن ${label}: المطلوب ${need.qty} والمتاح فعليًا ${pos.available} (الفعلي ${pos.actual}، المحجوز لأوردرات أخرى ${pos.reserved}) — الناقص ${need.qty - pos.available}. سجّل الإنتاج/الشراء أولًا (الشحن الجزئي غير مدعوم)`;
    }
  }
  return null;
}

/** Model+colour keys whose shipped quantity goes UP between two versions of an order. */
export function increasingKeys(ctx: StockContext, oldShipped: Slot[], newShipped: Slot[]): Set<string> {
  const sum = (slots: Slot[]) => {
    const m = new Map<string, number>();
    slots.forEach(s => { const k = ctx.keyOf(s.code, s.color); m.set(k, (m.get(k) || 0) + s.qty); });
    return m;
  };
  const before = sum(oldShipped);
  const out = new Set<string>();
  sum(newShipped).forEach((qty, k) => { if (qty > (before.get(k) || 0)) out.add(k); });
  return out;
}

/** Stock rows whose stored reserved_quantity must change to match the reservation orders. */
export function reservedSyncUpdates(ctx: StockContext, keys: Set<string>): { id: number; from: number; to: number }[] {
  return ctx.positions
    .filter(p => p.primary && keys.has(p.key) && p.row.reserved_quantity !== p.reserved)
    .map(p => ({ id: p.row.id, from: p.row.reserved_quantity, to: p.reserved }));
}
