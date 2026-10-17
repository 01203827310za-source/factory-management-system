// ============================================
// Order ledgers — the DB glue between an order write and its two append-only ledgers:
//   • shipping_collections  (cash received from the shipping company)
//   • inventory_movements   (cost of goods that physically left the factory)
// Both only ever append the DIFFERENCE between what the ledger holds and what the order says
// now, so saving an order twice cannot duplicate cash or inventory cost. They run inside the
// caller's transaction (and its stock lock).
// ============================================

import type { Prisma } from '@prisma/client';
import { cairoToday, isValidDate } from './charity';
import { seasonWhere } from './seasonContext';
import { computeStockPositions, costSlots, type Slot } from './readyStockPositions';

type CostSlotsInput = Parameters<typeof costSlots>[0];
import { ledgerTotal, planCollectionChange, round2 } from './shippingCollections';
import { planMovements } from './inventoryMovements';

type Tx = Prisma.TransactionClient;
type ModelSlot = Slot;

export async function loadStockContext(tx: Tx, seasonId: number, excludeSaleId?: number) {
  const [readyStock, modelProds, sales, returns_] = await Promise.all([
    tx.readyStock.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }),
    tx.modelProduction.findMany({ where: seasonWhere(seasonId) }),
    tx.sale.findMany({ where: seasonWhere(seasonId) }),
    tx.returnItem.findMany({ where: seasonWhere(seasonId) }),
  ]);
  return computeStockPositions({ readyStock, modelProds, sales, returns_ }, { excludeSaleId });
}

// Day newly received money belongs to: a date the user explicitly set (different from the one
// already stored on the order) wins; otherwise today (Cairo). Prevents a second collection on a
// later day from being back-dated just because the edit form was pre-filled with the old date.
export function collectionDate(explicit: unknown, storedDate: string | null | undefined): string {
  return isValidDate(explicit) && explicit !== storedDate ? explicit : cairoToday();
}

// Appends only the DIFFERENCE between what the ledger holds and what the order now says was
// received, then verifies ledger total == sales.shipping_collected. Re-saving an unchanged order
// appends nothing; editing 8,200 → 8,000 appends a single −200 row.
export async function syncCollections(
  tx: Tx,
  sale: { id: number; season_id: number; order_number: string },
  args: { previousCached: number; desired: number; date: string; user?: string },
) {
  const rows = await tx.shippingCollection.findMany({ where: { sale_id: sale.id }, orderBy: { id: 'asc' } });
  const plan = planCollectionChange({ rows, previousCached: args.previousCached, desiredTotal: args.desired, date: args.date });
  if (plan.length) {
    await tx.shippingCollection.createMany({
      data: plan.map(r => ({
        ...r, season_id: sale.season_id, sale_id: sale.id,
        reference: `أوردر ${sale.order_number}`, created_by: args.user ?? '',
      })),
    });
  }
  const total = round2(ledgerTotal(rows) + plan.reduce((n, r) => n + r.amount, 0));
  if (Math.abs(total - round2(args.desired)) > 0.005) {
    throw new Error(`Shipping-collection ledger (${total}) does not match the saved amount (${args.desired})`);
  }
}

// Records the cost of goods that physically left (or came back) as the DIFFERENCE between the
// movement ledger and the pieces whose cost the order must still carry (costSlots) — never a blind re-deduction:
//   shipped            → all shipped pieces at the card's cost at that moment
//   cancelled, returned→ SHIP_REVERSAL at the originally RECORDED cost for the pieces that came back
//   cancelled, unreturned pieces → their cost stays recognised until they return
export async function syncShipMovements(
  tx: Tx,
  sale: CostSlotsInput & { id: number; season_id: number; order_number: string },
  user?: string,
) {
  const [existing, ctx] = await Promise.all([
    tx.inventoryMovement.findMany({ where: { sale_id: sale.id }, orderBy: { id: 'asc' } }),
    loadStockContext(tx, sale.season_id),
  ]);
  const byKey = new Map(ctx.positions.filter(p => p.primary).map(p => [p.key, p]));
  const plan = planMovements({
    existing,
    desired: costSlots(sale),
    keyOf: ctx.keyOf,
    costOf: key => { const p = byKey.get(key); return p ? { unit_cost: p.row.cost_per_piece, stock_id: p.row.id } : null; },
  });
  if (plan.length) {
    await tx.inventoryMovement.createMany({
      data: plan.map(m => ({ ...m, season_id: sale.season_id, sale_id: sale.id, reference: sale.order_number, created_by: user ?? '' })),
    });
  }
}

