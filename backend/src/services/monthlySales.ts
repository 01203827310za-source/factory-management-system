// ============================================
// «المبيعات الشهرية حسب الموديل» — pieces sold per model in a month, from orders whose CURRENT status is «تم الصرف».
//
// Month of a sale = the day the shipping company's payout was recorded (sales.shipping_collected_date): it is set when the order
// reaches «تم الصرف», cleared if it leaves that status, and is the same date the monthly charity uses (collectionMonth).
// Orders from before that column existed have no date; they fall back to the creation day and are counted as `estimated`.
//
// Pieces come straight from the order lines (model1..5_qty). Money, reservations, shipped-but-unpaid, prepared and cancelled
// orders never contribute. The report is derived from the final order data on every request, so editing or cancelling an
// order changes it with no extra bookkeeping. The orders carry no size field, so there is no size breakdown.
// ============================================
import type { Sale } from '@prisma/client';
import { collectionMonth } from './charity';
import { saleSlots } from './readyStockPositions';

export const STATUS_PAID_OUT = 'تم الصرف';

export type ModelSalesRow = {
  model_code: string;
  model_name: string;
  qty: number;
  order_count: number;
  all_time_qty: number;
  colors: { color: string; qty: number }[];
};

export type MonthlyModelSales = {
  month: string;
  rows: ModelSalesRow[];
  total_qty: number;
  order_count: number;
  estimated_orders: number;
  available_months: string[];
};

const key = (s: string) => s.trim().toLowerCase();

export function monthlySalesByModel(sales: Sale[], month: string, modelNames: Map<string, string> = new Map()): MonthlyModelSales {
  const paid = sales.filter(s => s.order_status === STATUS_PAID_OUT);
  const rows = new Map<string, ModelSalesRow & { orders: Set<number>; colorMap: Map<string, number> }>();
  const months = new Set<string>();
  const monthOrders = new Set<number>();
  let estimated = 0;

  for (const s of paid) {
    const { month: m, estimated: est } = collectionMonth(s);
    months.add(m);
    const inMonth = m === month;
    if (inMonth) { monthOrders.add(s.id); if (est) estimated += 1; }
    for (const slot of saleSlots(s)) {
      const k = key(slot.code);
      const row = rows.get(k) ?? { model_code: slot.code.trim(), model_name: modelNames.get(k) ?? '', qty: 0, order_count: 0, all_time_qty: 0, colors: [], orders: new Set<number>(), colorMap: new Map<string, number>() };
      row.all_time_qty += slot.qty;
      if (inMonth) {
        row.qty += slot.qty;
        row.orders.add(s.id);
        const c = slot.color.trim();
        row.colorMap.set(c, (row.colorMap.get(c) ?? 0) + slot.qty);
      }
      rows.set(k, row);
    }
  }

  const out: ModelSalesRow[] = [...rows.values()]
    .filter(r => r.qty > 0)
    .map(({ orders, colorMap, ...r }) => ({
      ...r, order_count: orders.size,
      colors: [...colorMap.entries()].map(([color, qty]) => ({ color, qty })).sort((a, b) => b.qty - a.qty),
    }))
    .sort((a, b) => b.qty - a.qty || a.model_code.localeCompare(b.model_code));

  return {
    month, rows: out,
    total_qty: out.reduce((n, r) => n + r.qty, 0),
    order_count: monthOrders.size,
    estimated_orders: estimated,
    available_months: [...months].sort().reverse(),
  };
}
