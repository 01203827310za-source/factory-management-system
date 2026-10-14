// ============================================
// Keeping the stored ready_stock.reserved_quantity cache equal to the derived allocation.
//
// Reservations are derived (see computeStockPositions): prepared orders are served first-come-
// first-served from the stock that physically exists. The stored column is only a cache for older
// readers (reports, snapshots, the stock page), so ANY change to the stock inputs — production,
// returns, stock-card edits, print orders, order saves — must refresh it. That is also how newly
// produced goods start fulfilling pending order quantities, without ever reserving a unit twice.
// ============================================

import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { loadStockContext } from './orderLedgers';
import { reservedSyncUpdates } from './readyStockPositions';

type Tx = Prisma.TransactionClient;

// Serialises every write that can change stock availability or reservations within a season,
// so two orders can never reserve (or ship) the same units at the same time.
// NOTE: $executeRaw, not $queryRaw — pg_advisory_xact_lock returns `void`, which $queryRaw cannot deserialize
// ("Failed to deserialize column of type 'void'") and would fail every write with a 500.
export async function lockStock(tx: Tx, seasonId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${seasonId}::int, hashtext('ready_stock'))`;
}

/** Brings the cache in line with the allocation for every stock card of the season. */
export async function syncAllReserved(tx: Tx, seasonId: number): Promise<number> {
  const ctx = await loadStockContext(tx, seasonId);
  const updates = reservedSyncUpdates(ctx, new Set(ctx.positions.map(p => p.key)));
  for (const u of updates) {
    await tx.readyStock.update({ where: { id: u.id }, data: { reserved_quantity: u.to } });
  }
  return updates.length;
}

/**
 * Call after any route that changes physical stock (production, returns, stock cards, print
 * orders). Never throws: the caller's own change has already succeeded, and the allocation is
 * re-derived on the next read/write anyway.
 */
export async function resyncReservations(seasonId: number): Promise<void> {
  try {
    await prisma.$transaction(async tx => {
      await lockStock(tx, seasonId);
      await syncAllReserved(tx, seasonId);
    });
  } catch (err) {
    console.error('⚠️  Reservation re-sync failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}
