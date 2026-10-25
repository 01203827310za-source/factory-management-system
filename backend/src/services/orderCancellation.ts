// ============================================
// Order cancellation — audit record, what the business still owes afterwards, and the helpers
// that are shared by "cancel the order" and "record the refund".
//
// Cancelling an order never rewrites history and never erases cash:
//   • inventory  : stock is derived from the order — pieces come back ONLY if they were returned resalable
//                  (per line, see outsideSlots in readyStockPositions); the rest stays outside the sellable stock
//   • cost       : the cost ledger gets SHIP_REVERSAL rows at the ORIGINALLY recorded cost for the pieces that came back;
//                  the cost of pieces that did not come back stays recognised (syncShipMovements → costSlots)
//   • revenue / receivable : derived from the status, so they drop out automatically
//   • cash       : money already received STAYS in cash; it is an obligation until a real refund / repayment is
//                  recorded (a status change alone is never a refund). Refunds append ledger rows, never edit history.
//   • client-account invoice for the same order number: reversed by an explicit negative row (once)
// ============================================

import type { Prisma } from '@prisma/client';
import { ledgerTotal, planCollectionChange, round2 } from './shippingCollections';
import { costOfGoodsShipped, netMovements } from './inventoryMovements';
import { effectiveStatus, holdsGoodsOutside, isStockDeducting, outsideSlots, saleSlots, type CancelDisposition } from './readyStockPositions';
import { outstandingShippingReceivable } from './receivablesAudit';

type Tx = Prisma.TransactionClient;

export const REFUND_KINDS = ['customer_refund', 'shipping_repayment'] as const;
export type RefundKind = typeof REFUND_KINDS[number];

const norm = (s: string) => String(s ?? '').trim().toLowerCase();

/** What a cancelled order still owes: both amounts are REAL cash that has not been given back yet. */
export function cancelledObligations(
  sale: { deposit_paid: number; shipping_collected: number },
  refundsToCustomer: number,
): { customer_credit_due: number; customer_refunded: number; shipping_repayment_due: number } {
  return {
    customer_credit_due: round2(Math.max(0, sale.deposit_paid - refundsToCustomer)),
    customer_refunded: round2(refundsToCustomer),
    shipping_repayment_due: round2(Math.max(0, sale.shipping_collected)),
  };
}

/** Customer refunds recorded against an order (the Returns page records them as return rows with a refund amount). */
export function refundsByOrderNumber(returns_: { order_number: string; refund_amount: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  returns_.forEach(r => { const k = norm(r.order_number); if (k) m.set(k, (m.get(k) || 0) + r.refund_amount); });
  return m;
}
export const refundsFor = (m: Map<string, number>, orderNumber: string) => m.get(norm(orderNumber)) || 0;

// ───────────────────────── per-line returned quantities ─────────────────────────

/**
 * Splits each order line into "came back resalable" and "still outside the sellable stock".
 *   returned_resalable → the user may enter how many pieces of each line really came back (default: all of them);
 *                        the rest is treated as not returned
 *   not_returned / returned_damaged → nothing is added back to sellable stock
 * Quantities are validated here, on the server, against what actually shipped.
 */
export function computeUnreturned(
  disposition: CancelDisposition,
  lineQty: number[],
  returnedRaw: unknown,
): { unreturned: number[]; returned: number[] } | { error: string } {
  const returned = lineQty.map(() => 0);
  if (disposition === 'returned_resalable') {
    if (returnedRaw !== undefined && returnedRaw !== null && !Array.isArray(returnedRaw)) {
      return { error: 'كميات المرتجع يجب أن تكون قائمة بكمية لكل صنف' };
    }
    for (let i = 0; i < lineQty.length; i++) {
      const raw = Array.isArray(returnedRaw) ? returnedRaw[i] : undefined;
      const v = raw === undefined || raw === null || raw === '' ? lineQty[i] : Number(raw);
      if (!Number.isInteger(v) || v < 0 || v > lineQty[i]) {
        return { error: `كمية المرتجع للصنف رقم ${i + 1} غير صالحة (من 0 إلى ${lineQty[i]})` };
      }
      returned[i] = v;
    }
  }
  return { returned, unreturned: lineQty.map((q, i) => q - returned[i]) };
}

// ───────────────────────── audit record ─────────────────────────

/** Pieces / historical cost currently out of the building for an order, from the cost ledger (before any reversal). */
export async function shippedSnapshot(tx: Tx, saleId: number): Promise<{ qty: number; cost: number }> {
  const rows = await tx.inventoryMovement.findMany({ where: { sale_id: saleId } });
  const qty = rows.reduce((n, r) => n + (r.movement_type === 'SHIP' ? r.qty : -r.qty), 0);
  return { qty: Math.max(0, qty), cost: Math.max(0, costOfGoodsShipped(rows)) };
}

/**
 * Writes the audit row for a cancel event, linking the ledger rows of the order (originals + reversals).
 * Call AFTER the ledgers were synced, with the snapshot taken BEFORE them.
 */
export async function recordCancellation(tx: Tx, args: {
  seasonId: number;
  sale: { id: number; deposit_paid: number; shipping_collected: number };
  statusBefore: string;
  wasShipped: boolean;
  disposition: CancelDisposition | null;
  reason: string;
  snapshot: { qty: number; cost: number };
  user?: string;
  restoredQty?: number;
  refundCustomerPaid?: number;
  repaidShipping?: number;
  revenueReversed?: number;
  receivableReversed?: number;
  invoiceIds?: number[];
}) {
  const [collections, movements] = await Promise.all([
    tx.shippingCollection.findMany({ where: { sale_id: args.sale.id }, select: { id: true } }),
    tx.inventoryMovement.findMany({ where: { sale_id: args.sale.id }, select: { id: true } }),
  ]);
  return tx.orderCancellation.create({
    data: {
      season_id: args.seasonId, sale_id: args.sale.id, status_before: args.statusBefore, was_shipped: args.wasShipped,
      disposition: args.disposition, reason: args.reason,
      goods_qty: args.wasShipped ? args.snapshot.qty : 0, goods_cost: args.wasShipped ? round2(args.snapshot.cost) : 0,
      deposit_held: round2(args.sale.deposit_paid), collected_held: round2(args.sale.shipping_collected),
      linked_collection_ids: JSON.stringify(collections.map(c => c.id)),
      linked_movement_ids: JSON.stringify(movements.map(m => m.id)),
      restored_qty: args.restoredQty ?? 0,
      refund_customer_paid: round2(args.refundCustomerPaid ?? 0),
      repaid_shipping: round2(args.repaidShipping ?? 0),
      revenue_reversed: round2(args.revenueReversed ?? 0),
      receivable_reversed: round2(args.receivableReversed ?? 0),
      linked_invoice_ids: JSON.stringify(args.invoiceIds ?? []),
      created_by: args.user ?? '',
    },
  });
}

/** Latest cancel event of an order that has not been reopened. */
export async function openCancellation(tx: Tx, saleId: number) {
  return tx.orderCancellation.findFirst({ where: { sale_id: saleId, reopened_at: null }, orderBy: { id: 'desc' } });
}

export async function markReopened(tx: Tx, saleId: number) {
  const open = await openCancellation(tx, saleId);
  if (open) await tx.orderCancellation.update({ where: { id: open.id }, data: { reopened_at: new Date() } });
}

export async function updateDisposition(tx: Tx, saleId: number, disposition: CancelDisposition | null, restoredQty?: number) {
  const open = await openCancellation(tx, saleId);
  if (open) {
    await tx.orderCancellation.update({
      where: { id: open.id },
      data: { disposition, ...(restoredQty !== undefined ? { restored_qty: restoredQty } : {}) },
    });
  }
}

/** Adds money refunded / repaid in a later step to the cancellation's audit row. */
export async function addRefundToAudit(tx: Tx, saleId: number, kind: RefundKind, amount: number) {
  const open = await openCancellation(tx, saleId);
  if (!open) return;
  await tx.orderCancellation.update({
    where: { id: open.id },
    data: kind === 'customer_refund'
      ? { refund_customer_paid: round2(open.refund_customer_paid + amount) }
      : { repaid_shipping: round2(open.repaid_shipping + amount) },
  });
}

// ───────────────────────── real refunds (shared) ─────────────────────────

class RefundError extends Error {}
export const isRefundError = (e: unknown): e is RefundError => e instanceof RefundError;

/**
 * Records a REAL refund / repayment for a cancelled order, inside the caller's transaction.
 *   customer_refund    → a refund row on the Returns ledger (cash out), capped at the deposit still owed
 *   shipping_repayment → negative rows on the collection ledger (cash out), allocated to the months the money was
 *                        originally received, capped at what the shipping company paid and is still held
 * Idempotent per `key`: a repeated request returns { duplicate: true } and changes nothing.
 */
export async function applyRefund(tx: Tx, args: {
  seasonId: number;
  saleId: number;
  kind: RefundKind;
  amount: number;
  date: string;
  note?: string;
  key: string;
  user?: string;
}): Promise<{ duplicate: boolean }> {
  const amt = round2(args.amount);
  const sale = await tx.sale.findFirst({ where: { id: args.saleId, season_id: args.seasonId } });
  if (!sale) throw new RefundError('الطلب غير موجود');
  if (sale.order_status !== 'تم الإلغاء') throw new RefundError('تسجيل الرد متاح للأوردرات الملغاة فقط');
  const tag = `[ref:${args.key}]`;

  if (args.kind === 'customer_refund') {
    const dup = await tx.returnItem.findFirst({ where: { season_id: args.seasonId, notes: { contains: tag } } });
    if (dup) return { duplicate: true };
    const refunded = refundsFor(refundsByOrderNumber(await tx.returnItem.findMany({ where: { season_id: args.seasonId, order_number: sale.order_number } })), sale.order_number);
    const due = cancelledObligations(sale, refunded).customer_credit_due;
    if (amt > due + 0.005) throw new RefundError(`المبلغ أكبر من العربون المتبقي للرد (${due} ج)`);
    await tx.returnItem.create({ data: {
      season_id: args.seasonId, date: args.date, order_number: sale.order_number, client_name: sale.client, returned_by: '', paid_by: args.user ?? '',
      model_code: '', model_qty: 0, model_color: '', refund_amount: amt, notes: `رد عربون أوردر ملغى${args.note ? ` — ${args.note}` : ''} ${tag}`,
    } });
    await addRefundToAudit(tx, sale.id, 'customer_refund', amt);
    return { duplicate: false };
  }

  const reference = `repayment:${args.key}`;
  const dup = await tx.shippingCollection.findFirst({ where: { sale_id: sale.id, reference: { startsWith: reference } } });
  if (dup) return { duplicate: true };
  if (amt > sale.shipping_collected + 0.005) throw new RefundError(`المبلغ أكبر من المحصّل المحتجز من شركة الشحن (${sale.shipping_collected} ج)`);
  const rows = await tx.shippingCollection.findMany({ where: { sale_id: sale.id }, orderBy: { id: 'asc' } });
  const current = ledgerTotal(rows);
  // Allocate the repayment to the dates the money was received (newest first), so a month's actual collections
  // (monthly charity) fall by exactly what was paid back; the real repayment date is kept in the reference.
  const plan = planCollectionChange({ rows, previousCached: sale.shipping_collected, desiredTotal: round2(current - amt), date: args.date });
  await tx.shippingCollection.createMany({
    data: plan.map(r => ({
      season_id: args.seasonId, sale_id: sale.id, amount: r.amount, kind: 'repayment', collected_date: r.collected_date,
      date_estimated: r.date_estimated, reference: `${reference}:${args.date}`, created_by: args.user ?? '',
    })),
  });
  const after = await tx.shippingCollection.findMany({ where: { sale_id: sale.id } });
  await tx.sale.update({ where: { id: sale.id }, data: { shipping_collected: ledgerTotal(after) } });
  await addRefundToAudit(tx, sale.id, 'shipping_repayment', amt);
  return { duplicate: false };
}

// ───────────────────────── client-account invoices ─────────────────────────

const REVERSAL_TAG = '[reversal-of:';

/**
 * A cancelled order must not stay a receivable in a client account. Each invoice of that order number gets ONE
 * explicit negative row (the original is kept) and the account balance is reduced by the same amount. Idempotent.
 */
export async function reverseClientInvoices(tx: Tx, args: { seasonId: number; orderNumber: string; user?: string }): Promise<{ ids: number[]; amount: number }> {
  if (!args.orderNumber.trim()) return { ids: [], amount: 0 };
  const invs = await tx.clientAccountInvoice.findMany({
    where: { season_id: args.seasonId, order_number: { equals: args.orderNumber.trim(), mode: 'insensitive' } },
    orderBy: { id: 'asc' },
  });
  const alreadyReversed = new Set(invs.filter(i => i.notes.startsWith(REVERSAL_TAG)).map(i => Number(i.notes.slice(REVERSAL_TAG.length).split(']')[0])));
  const ids: number[] = [];
  let amount = 0;
  for (const inv of invs) {
    if (inv.amount <= 0 || inv.notes.startsWith(REVERSAL_TAG) || alreadyReversed.has(inv.id)) continue;
    await tx.clientAccountInvoice.create({ data: {
      account_id: inv.account_id, season_id: args.seasonId, date: inv.date, order_number: inv.order_number, amount: -inv.amount,
      notes: `${REVERSAL_TAG}${inv.id}] إلغاء الأوردر ${args.orderNumber}`, created_by: args.user ?? '',
    } });
    const account = await tx.clientAccount.findUnique({ where: { id: inv.account_id } });
    if (account) {
      const total = round2(account.total_amount - inv.amount);
      await tx.clientAccount.update({ where: { id: account.id }, data: { total_amount: total, remaining: round2(total - account.amount_paid) } });
    }
    ids.push(inv.id);
    amount += inv.amount;
  }
  return { ids, amount: round2(amount) };
}

// ───────────────────────── preview (computed on the server) ─────────────────────────

type Db = Pick<Tx, 'sale' | 'inventoryMovement' | 'returnItem' | 'clientAccountInvoice'>;

/** Everything the cancellation form shows, computed from the database (never from values sent by the browser). */
export async function buildCancellationPreview(db: Db, seasonId: number, saleId: number) {
  const rawSale = await db.sale.findFirst({ where: { id: saleId, season_id: seasonId } });
  if (!rawSale) return null;
  const sale = effectiveStatus(rawSale);   // an order still awaiting pieces has not shipped
  const [movements, returns_, invoices] = await Promise.all([
    db.inventoryMovement.findMany({ where: { sale_id: saleId }, orderBy: { id: 'asc' } }),
    db.returnItem.findMany({ where: { season_id: seasonId, order_number: sale.order_number } }),
    db.clientAccountInvoice.findMany({ where: { season_id: seasonId, order_number: { equals: sale.order_number.trim(), mode: 'insensitive' } }, orderBy: { id: 'asc' } }),
  ]);
  const alreadyCancelled = sale.order_status === 'تم الإلغاء';
  const shipped = isStockDeducting(sale.order_status) || holdsGoodsOutside(sale);
  const refunded = refundsFor(refundsByOrderNumber(returns_), sale.order_number);
  const obligations = cancelledObligations(sale, refunded);

  // pieces and recorded cost per order line (the cost RECORDED when the line shipped, not the stock card's current cost)
  const net = netMovements(movements, (c, col) => `${c}|${col}`);
  const slots = saleSlots(sale);
  const outside = outsideSlots(sale);
  const lines = slots.map(l => {
    const n = net.get(`${l.code}|${l.color}`);
    const unit = n && n.qty > 0 ? n.cost / n.qty : 0;
    const out = outside.find(o => o.code === l.code && o.color === l.color)?.qty ?? 0;
    return {
      code: l.code, color: l.color, shipped_qty: l.qty,
      outside_qty: alreadyCancelled ? out : l.qty,
      returned_qty: alreadyCancelled ? l.qty - out : 0,
      recorded_unit_cost: round2(unit),
    };
  });
  return {
    sale_id: sale.id, order_number: sale.order_number, client: sale.client, status: sale.order_status,
    already_cancelled: alreadyCancelled, shipped, cancel_disposition: sale.cancel_disposition ?? null,
    lines,
    money: {
      invoice_value: sale.invoice_value,
      deposit_received: sale.deposit_paid,
      customer_refunded: obligations.customer_refunded,
      customer_credit_due: obligations.customer_credit_due,
      shipping_collected: sale.shipping_collected,
      shipping_repayment_due: obligations.shipping_repayment_due,
      outstanding_shipping_receivable: outstandingShippingReceivable(sale),
      revenue_to_reverse: isStockDeducting(sale.order_status) ? sale.invoice_value : 0,
    },
    cost: {
      recorded_cost_total: round2(costOfGoodsShipped(movements)),
      has_cost_record: movements.some(m => m.movement_type === 'SHIP'),
    },
    client_invoices: invoices
      .filter(i => i.amount > 0 && !i.notes.startsWith(REVERSAL_TAG))
      .map(i => ({ id: i.id, account_id: i.account_id, amount: i.amount, reversed: invoices.some(r => r.notes.startsWith(`${REVERSAL_TAG}${i.id}]`)) })),
  };
}

/** Units of an order's goods (for the "outside the building" report). */
export const goodsQty = (sale: Parameters<typeof saleSlots>[0]) => saleSlots(sale).reduce((n, s) => n + s.qty, 0);

export { ledgerTotal };
