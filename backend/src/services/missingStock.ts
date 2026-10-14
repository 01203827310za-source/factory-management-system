// ============================================
// Consolidated missing-stock summary («ملخص النواقص المطلوبة للتجهيز»).
//
// Source of truth = the stock allocation (computeStockPositions): «يتم التجهيز» orders are served
// first-come-first-served from stock that physically exists. Each order line therefore already has
//   requested, reserved (really held), pending = requested − reserved   (never negative)
// This module only GROUPS those per-line shortages by model code + colour — it never re-derives a
// shortage from raw requested quantities, so reserved units are never counted for two orders.
//
// Only prepared orders are eligible (the allocation never contains shipped or cancelled orders), and
// only lines that still have a shortage contribute to a row, so a row's figures add up exactly:
//   required = reserved + missing   (summed over the contributing order lines)
// ============================================

import type { ModelProduction, Sale } from '@prisma/client';
import type { StockContext } from './readyStockPositions';

export type MissingStockOrder = {
  sale_id: number;
  order_number: string;
  client: string;
  requested: number;
  reserved: number;
  missing: number;
};

export type MissingStockRow = {
  model_code: string;
  model_name: string;
  color: string;
  /** Σ requested, over the order lines that still have a shortage. */
  required: number;
  /** Σ really held for those same lines (from stock that exists). */
  reserved: number;
  /** Σ remaining shortage — the pieces still to be produced / purchased. */
  missing: number;
  /** Stock card exists for this model+colour (false → the model has never been produced / purchased). */
  has_card: boolean;
  /** Pieces physically in stock for this model+colour. */
  physical_stock: number;
  /** Of that stock, pieces held for OTHER prepared orders that are already fully covered. */
  reserved_for_covered_orders: number;
  /** Free stock not held by any order (always 0 while a shortage exists — shown for clarity). */
  free_stock: number;
  orders: MissingStockOrder[];
};

export type MissingStockSummary = {
  rows: MissingStockRow[];
  total_missing_units: number;
  total_rows: number;
  total_orders: number;
};

export function summarizeMissingStock(args: {
  ctx: StockContext;
  sales: Pick<Sale, 'id' | 'order_number' | 'client'>[];
  modelProds?: Pick<ModelProduction, 'model_code' | 'color' | 'model_description'>[];
}): MissingStockSummary {
  const { ctx } = args;
  const saleById = new Map(args.sales.map(s => [s.id, s]));
  const positionByKey = new Map(ctx.positions.filter(p => p.primary).map(p => [p.key, p]));

  // key → {identity, per-order totals}. One entry per (order, model+colour) so an order with two lines
  // of the same model+colour appears once, with summed quantities.
  type Acc = { code: string; color: string; byOrder: Map<number, MissingStockOrder>; coveredReserved: number };
  const groups = new Map<string, Acc>();

  for (const alloc of ctx.allocations.values()) {
    const sale = saleById.get(alloc.sale_id);
    // Reserved units on lines of this order that are fully covered still belong to a prepared order.
    for (const line of alloc.slots) {
      const key = ctx.keyOf(line.code, line.color);
      const acc = groups.get(key) ?? { code: line.code, color: line.color, byOrder: new Map(), coveredReserved: 0 };
      groups.set(key, acc);
      if (line.pending <= 0) { acc.coveredReserved += line.reserved; continue; }
      const cur = acc.byOrder.get(alloc.sale_id) ?? {
        sale_id: alloc.sale_id, order_number: sale?.order_number ?? '', client: sale?.client ?? '', requested: 0, reserved: 0, missing: 0,
      };
      cur.requested += line.requested;
      cur.reserved += line.reserved;
      cur.missing += line.pending;
      acc.byOrder.set(alloc.sale_id, cur);
    }
  }

  const rows: MissingStockRow[] = [];
  for (const [key, acc] of groups) {
    const orders = [...acc.byOrder.values()].sort((a, b) => a.sale_id - b.sale_id);
    const missing = orders.reduce((n, o) => n + o.missing, 0);
    if (missing <= 0) continue;                                   // nothing missing → not a shortage row
    const pos = positionByKey.get(key);
    const name = pos?.row.product_name
      || args.modelProds?.find(mp => ctx.keyOf(mp.model_code, mp.color || '') === key)?.model_description
      || '';
    rows.push({
      model_code: pos?.row.model_code ?? acc.code,
      model_name: name && name !== (pos?.row.model_code ?? acc.code) ? name : '',
      color: pos?.row.color ?? acc.color,
      required: orders.reduce((n, o) => n + o.requested, 0),
      reserved: orders.reduce((n, o) => n + o.reserved, 0),
      missing,
      has_card: !!pos,
      physical_stock: pos?.actual ?? 0,
      reserved_for_covered_orders: acc.coveredReserved,
      free_stock: pos?.available ?? 0,
      orders,
    });
  }

  rows.sort((a, b) => b.missing - a.missing || a.model_code.localeCompare(b.model_code) || a.color.localeCompare(b.color));
  return {
    rows,
    total_missing_units: rows.reduce((n, r) => n + r.missing, 0),
    total_rows: rows.length,
    total_orders: new Set(rows.flatMap(r => r.orders.map(o => o.sale_id))).size,
  };
}
