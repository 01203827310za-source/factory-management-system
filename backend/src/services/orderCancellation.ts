// ============================================
// Order cancellation — audit record + what the business still owes afterwards.
//
// Cancelling an order never rewrites history and never erases cash:
//   • inventory  : the cost ledger gets SHIP_REVERSAL rows at the ORIGINALLY recorded cost
//                  (syncShipMovements → planMovements, already idempotent)
//   • stock      : derived from the order — restored only if the goods are back and resalable
//                  (see holdsGoodsOutside in readyStockPositions)
//   • revenue / receivable / COGS : derived from the status, so they drop out automatically
//   • cash       : money already received STAYS in cash; it becomes an obligation until a real
//                  refund / repayment is recorded (a status change alone is never a refund)
// This module records the cancellation itself and computes those obligations.
// ============================================

import type { Prisma } from '@prisma/client';
import { ledgerTotal, round2 } from './shippingCollections';
import { costOfGoodsShipped } from './inventoryMovements';
import { saleSlots, type CancelDisposition } from './readyStockPositions';

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

export async function updateDisposition(tx: Tx, saleId: number, disposition: CancelDisposition | null) {
  const open = await openCancellation(tx, saleId);
  if (open) await tx.orderCancellation.update({ where: { id: open.id }, data: { disposition } });
}

/** Units of an order's goods (for the "outside the building" report). */
export const goodsQty = (sale: Parameters<typeof saleSlots>[0]) => saleSlots(sale).reduce((n, s) => n + s.qty, 0);

export { ledgerTotal };
