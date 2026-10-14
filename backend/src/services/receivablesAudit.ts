// ============================================
// Receivables audit (read-only, pure).
//
// For every order in 'لم يتم الصرف' (shipped, shipping company has not paid yet) it answers:
//   • how much was shipped, and how much of that was actually removed from ready-stock value
//   • what inventory cost left stock (card cost now, and the cost recorded when it shipped)
//   • what was collected, and what outstanding receivable the Dashboard counts
//   • is the same debt ALSO counted in a client account (double counting)?
//   • is the shipped inventory still being valued in stock?
// Inventory and receivables are different assets: nothing here nets one against the other.
// ============================================

import type { ClientAccount, ClientAccountInvoice, InventoryMovement, ModelProduction, ReadyStock, ReturnItem, Sale } from '@prisma/client';
import { computeStockPositions, saleSlots, isStockDeducting, type Slot } from './readyStockPositions';
import { normalizeModelCode } from '../utils/textMatch';

export const STATUS_NOT_PAID_OUT = 'لم يتم الصرف';
export const STATUS_PAID_OUT = 'تم الصرف';
export const STATUS_ON_ACCOUNT = 'حساب عميل';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = (s: string) => String(s ?? '').trim().toLowerCase();

/** The single definition of a VALID outstanding shipping-company receivable for one order. */
export function outstandingShippingReceivable(sale: Pick<Sale, 'order_status' | 'remaining' | 'shipping_collected'>): number {
  if (sale.order_status === STATUS_NOT_PAID_OUT) return Math.max(0, sale.remaining);
  if (sale.order_status === STATUS_PAID_OUT) return Math.max(0, sale.remaining - sale.shipping_collected);
  return 0;
}

/**
 * Orders whose outstanding receivable is ALSO entered as a client-account invoice (same order number).
 * Both are summed into "money owed to us", so that debt is counted twice. Detection only: which side
 * is the real one is a business decision, so nothing is netted or dropped automatically.
 */
export function findReceivableOverlap(
  sales: Pick<Sale, 'order_number' | 'order_status' | 'remaining' | 'shipping_collected'>[],
  invoices: Pick<ClientAccountInvoice, 'order_number' | 'amount'>[],
): { orders: number; amount: number } {
  const byOrder = new Map<string, number>();
  invoices.forEach(i => { const k = norm(i.order_number); if (k) byOrder.set(k, (byOrder.get(k) ?? 0) + i.amount); });
  let orders = 0, amount = 0;
  sales.forEach(s => {
    const out = outstandingShippingReceivable(s);
    const inv = byOrder.get(norm(s.order_number));
    if (out > 0 && inv !== undefined) { orders += 1; amount += Math.min(out, inv); }
  });
  return { orders, amount: round2(amount) };
}

export type StockStatus =
  | 'removed'            // fully deducted from a matching stock card
  | 'partly_removed'     // stock card had fewer pieces than were shipped (value clamped at 0)
  | 'no_stock_card'      // no stock card for the model: never part of stock value, nothing to remove
  | 'possible_mismatch'; // a stock card exists for the model code but not this colour → value may still be in stock

export type OrderAudit = {
  sale_id: number;
  order_number: string;
  client: string;
  invoice_value: number;
  deposit_paid: number;
  shipped_qty: number;
  inventory_qty_deducted: number;
  inventory_cost_deducted_card: number;
  inventory_cost_deducted_recorded: number | null; // from the movement ledger, null for pre-ledger orders
  collected_amount: number;
  outstanding_receivable: number;
  stock_status: StockStatus;
  inventory_still_in_stock: boolean;
  also_in_client_account: { account_id: number; client_name: string; amount: number } | null;
  stale_remaining: boolean;             // stored remaining ≠ invoice − deposit
  stale_collected_on_unpaid: boolean;   // informational shipping_collected on an unpaid order (ignored by cash)
  negative_remaining: boolean;          // customer paid more than the invoice (a credit, not a receivable)
  notes: string[];
};

export type ReceivablesAudit = {
  orders: OrderAudit[];
  totals: {
    orders: number;
    invoice_value: number;
    shipped_qty: number;
    inventory_qty_deducted: number;
    inventory_cost_deducted_card: number;
    collected_amount: number;
    outstanding_receivable: number;
  };
  reconciliation: {
    shipping_receivable_not_paid_out: number;
    shipping_receivable_paid_out_gap: number;
    client_accounts_receivable: number;
    money_owed_to_us: number;
    /** Receivable counted in BOTH a shipping order and a client-account invoice with the same order number. */
    double_counted_amount: number;
    double_counted_orders: number;
    on_account_orders_without_client_invoice: { sale_id: number; order_number: string; remaining: number }[];
    uncosted_orders: number;
  };
};

export type ShipmentAnalysis = { removedQty: number; removedCard: number; status: StockStatus; notes: string[]; slotsQty: number };

/**
 * For EVERY order whose goods left the factory: how much of it was really removed from ready-stock
 * value, and whether it is still (partly) valued in stock. Shared by the audit screen and by the
 * Dashboard's receivable rows so both always show the same verdict.
 */
export function analyseShipments(input: {
  sales: Sale[];
  readyStock: ReadyStock[];
  modelProds: ModelProduction[];
  returns_: ReturnItem[];
}): { perOrder: Map<number, ShipmentAnalysis> } {
  const ctx = computeStockPositions({ readyStock: input.readyStock, modelProds: input.modelProds, sales: input.sales, returns_: input.returns_ });
  const primaryByKey = new Map(ctx.positions.filter(p => p.primary).map(p => [p.key, p]));

  const consumed = new Map<string, number>();
  // Walk ALL shipped orders in id order so consumption of a card is attributed correctly.
  const shipped = input.sales.filter(s => isStockDeducting(s.order_status)).sort((a, b) => a.id - b.id);
  const perOrder = new Map<number, ShipmentAnalysis>();

  for (const s of shipped) {
    const slots: Slot[] = saleSlots(s);
    let removedQty = 0, removedCard = 0, slotsQty = 0;
    let status: StockStatus = 'removed';
    const notes: string[] = [];
    const rank: Record<StockStatus, number> = { removed: 0, no_stock_card: 1, partly_removed: 2, possible_mismatch: 3 };
    const worsen = (next: StockStatus) => { if (rank[next] > rank[status]) status = next; };

    for (const m of slots) {
      slotsQty += m.qty;
      const key = ctx.keyOf(m.code, m.color);
      const pos = primaryByKey.get(key);
      if (!pos) {
        const sameModel = ctx.positions.filter(p => p.primary && normalizeModelCode(p.row.model_code) === normalizeModelCode(m.code));
        if (sameModel.length > 0) {
          worsen('possible_mismatch');
          notes.push(`${m.code} (${m.color || 'بدون لون'}) لا يطابق أي كارت مخزون بنفس اللون — الموجود: ${sameModel.map(p => p.row.color || 'بدون لون').join('، ')}`);
        } else {
          worsen('no_stock_card');
          notes.push(`${m.code} لا يوجد له كارت في المخزن الجاهز`);
        }
        continue;
      }
      const used = consumed.get(key) || 0;
      // Shipments consume the card's supply in order-id order, so a card that ran short shows
      // exactly which orders were only partly removed from stock value.
      const room = Math.max(0, pos.supply - used);
      const take = Math.min(m.qty, room);
      consumed.set(key, used + m.qty);
      removedQty += take;
      removedCard += take * pos.row.cost_per_piece;
      if (take < m.qty) {
        worsen('partly_removed');
        notes.push(`${m.code}: المشحون ${m.qty} أكبر من رصيد الكارت (خُصم ${take}) — قيمة المخزون مقطوعة عند صفر`);
      }
    }
    perOrder.set(s.id, { removedQty, removedCard, status, notes, slotsQty });
  }

  return { perOrder };
}

export function buildReceivablesAudit(input: {
  sales: Sale[];
  readyStock: ReadyStock[];
  modelProds: ModelProduction[];
  returns_: ReturnItem[];
  clientAccts: ClientAccount[];
  clientInvoices: ClientAccountInvoice[];
  movements: InventoryMovement[];
  collectedBySale?: Map<number, number>; // ledger totals; falls back to sales.shipping_collected
}): ReceivablesAudit {
  const movementsBySale = new Map<number, InventoryMovement[]>();
  input.movements.forEach(m => movementsBySale.set(m.sale_id, [...(movementsBySale.get(m.sale_id) ?? []), m]));

  const invoicesByOrder = new Map<string, { account_id: number; client_name: string; amount: number }>();
  const acctName = new Map(input.clientAccts.map(a => [a.id, a.client_name]));
  input.clientInvoices.forEach(i => {
    const k = norm(i.order_number);
    if (!k) return;
    const cur = invoicesByOrder.get(k);
    invoicesByOrder.set(k, { account_id: i.account_id, client_name: acctName.get(i.account_id) ?? '', amount: (cur?.amount ?? 0) + i.amount });
  });

  const { perOrder } = analyseShipments(input);

  const orders: OrderAudit[] = input.sales
    .filter(s => s.order_status === STATUS_NOT_PAID_OUT)
    .sort((a, b) => a.id - b.id)
    .map(s => {
      const p = perOrder.get(s.id)!;
      const recorded = movementsBySale.get(s.id);
      const recordedCost = recorded && recorded.length
        ? round2(recorded.reduce((n, m) => n + (m.movement_type === 'SHIP' ? m.total_cost : -m.total_cost), 0))
        : null;
      const outstanding = outstandingShippingReceivable(s);
      const dup = invoicesByOrder.get(norm(s.order_number)) ?? null;
      const notes = [...p.notes];
      const stale = round2(s.remaining) !== round2(s.invoice_value - s.deposit_paid);
      if (stale) notes.push('المتبقي المخزّن لا يساوي (الفاتورة − العربون)');
      if (s.remaining < 0) notes.push('العميل دفع أكثر من الفاتورة — رصيد دائن وليس مستحقًا');
      if (dup && outstanding > 0) notes.push(`نفس رقم الأوردر مسجّل كفاتورة في حساب العميل «${dup.client_name}» (${dup.amount}) — خطر عدّ المستحق مرتين`);
      return {
        sale_id: s.id,
        order_number: s.order_number,
        client: s.client,
        invoice_value: s.invoice_value,
        deposit_paid: s.deposit_paid,
        shipped_qty: p.slotsQty,
        inventory_qty_deducted: p.removedQty,
        inventory_cost_deducted_card: round2(p.removedCard),
        inventory_cost_deducted_recorded: recordedCost,
        collected_amount: round2(input.collectedBySale?.get(s.id) ?? (s.order_status === STATUS_PAID_OUT ? s.shipping_collected : 0)),
        outstanding_receivable: outstanding,
        stock_status: p.status,
        inventory_still_in_stock: p.status === 'possible_mismatch' || p.status === 'partly_removed',
        also_in_client_account: dup && outstanding > 0 ? dup : null,
        stale_remaining: stale,
        stale_collected_on_unpaid: s.shipping_collected !== 0,
        negative_remaining: s.remaining < 0,
        notes,
      };
    });

  const notPaidOut = input.sales.filter(s => s.order_status === STATUS_NOT_PAID_OUT).reduce((n, s) => n + outstandingShippingReceivable(s), 0);
  const gap = input.sales.filter(s => s.order_status === STATUS_PAID_OUT).reduce((n, s) => n + outstandingShippingReceivable(s), 0);
  const clientTotal = input.clientAccts.reduce((n, a) => n + Math.max(0, a.remaining), 0);

  const overlap = findReceivableOverlap(input.sales, input.clientInvoices);

  const onAccountMissing = input.sales
    .filter(s => s.order_status === STATUS_ON_ACCOUNT && !invoicesByOrder.has(norm(s.order_number)))
    .map(s => ({ sale_id: s.id, order_number: s.order_number, remaining: s.remaining }));

  const sum = (f: (o: OrderAudit) => number) => round2(orders.reduce((n, o) => n + f(o), 0));
  return {
    orders,
    totals: {
      orders: orders.length,
      invoice_value: sum(o => o.invoice_value),
      shipped_qty: sum(o => o.shipped_qty),
      inventory_qty_deducted: sum(o => o.inventory_qty_deducted),
      inventory_cost_deducted_card: sum(o => o.inventory_cost_deducted_card),
      collected_amount: sum(o => o.collected_amount),
      outstanding_receivable: sum(o => o.outstanding_receivable),
    },
    reconciliation: {
      shipping_receivable_not_paid_out: round2(notPaidOut),
      shipping_receivable_paid_out_gap: round2(gap),
      client_accounts_receivable: round2(clientTotal),
      money_owed_to_us: round2(notPaidOut + gap + clientTotal),
      double_counted_amount: overlap.amount,
      double_counted_orders: overlap.orders,
      on_account_orders_without_client_invoice: onAccountMissing,
      uncosted_orders: orders.filter(o => o.inventory_cost_deducted_recorded === null).length,
    },
  };
}
