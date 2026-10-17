// READ-ONLY report of cancelled orders that need a human look after the cancellation rework.
//   npm run audit:cancellations            → every season
//   npm run audit:cancellations -- 2       → season id 2 only
// Only findMany() calls are made — nothing is created, updated or deleted, and no history is invented.
//
// Reported cases:
//   A. shipped-and-cancelled, goods NOT back (not_returned / returned_damaged) but cancelled before per-line returns existed:
//      their cost was fully reversed under the old rule, so COGS under-states the cost of goods that are still outside.
//   B. cancelled orders that had shipped (disposition set) but have NO cost ledger rows → no recorded cost to reverse.
//   C. cancelled orders with money held (deposit / shipping collected) and no matching refund or repayment yet (informational).
//   D. cancelled orders with a collected amount but no collection ledger rows (the cached sum has no history behind it).
//   E. cancelled orders whose order number also appears on a client-account invoice that was not reversed.
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { hasLineReturns } from '../src/services/readyStockPositions';
import { refundsByOrderNumber, refundsFor } from '../src/services/orderCancellation';

async function auditSeason(seasonId: number, label: string) {
  const where = { season_id: seasonId };
  const [sales, movements, collections, returns_, invoices] = await Promise.all([
    prisma.sale.findMany({ where: { ...where, order_status: 'تم الإلغاء' }, orderBy: { id: 'asc' } }),
    prisma.inventoryMovement.findMany({ where }),
    prisma.shippingCollection.findMany({ where }),
    prisma.returnItem.findMany({ where }),
    prisma.clientAccountInvoice.findMany({ where }),
  ]);
  const refunds = refundsByOrderNumber(returns_);
  const movBySale = new Map<number, number>();
  movements.forEach(m => movBySale.set(m.sale_id, (movBySale.get(m.sale_id) ?? 0) + 1));
  const colBySale = new Map<number, number>();
  collections.forEach(c => colBySale.set(c.sale_id, (colBySale.get(c.sale_id) ?? 0) + 1));

  const rows: { case: string; order_id: number; order: string; detail: string }[] = [];
  for (const s of sales) {
    const legacy = !hasLineReturns(s);
    if (s.cancel_disposition && s.cancel_disposition !== 'returned_resalable' && legacy) {
      rows.push({ case: 'A', order_id: s.id, order: s.order_number, detail: `goods ${s.cancel_disposition} — cost was fully reversed under the old rule; review COGS` });
    }
    if (s.cancel_disposition && !(movBySale.get(s.id) ?? 0)) {
      rows.push({ case: 'B', order_id: s.id, order: s.order_number, detail: 'shipped-and-cancelled but no cost-ledger rows (no recorded cost to reverse)' });
    }
    const due = Math.max(0, s.deposit_paid - refundsFor(refunds, s.order_number));
    if (due > 0 || s.shipping_collected > 0) {
      rows.push({ case: 'C', order_id: s.id, order: s.order_number, detail: `still owed back: customer ${due}, shipping company ${s.shipping_collected}` });
    }
    if (s.shipping_collected > 0 && !(colBySale.get(s.id) ?? 0)) {
      rows.push({ case: 'D', order_id: s.id, order: s.order_number, detail: `shipping_collected ${s.shipping_collected} has no ledger history` });
    }
    const open = invoices.filter(i => i.amount > 0 && i.order_number.trim().toLowerCase() === s.order_number.trim().toLowerCase()
      && !invoices.some(r => r.notes.startsWith(`[reversal-of:${i.id}]`)));
    if (open.length) rows.push({ case: 'E', order_id: s.id, order: s.order_number, detail: `client-account invoice(s) ${open.map(i => `#${i.id}`).join(', ')} not reversed` });
  }
  console.log(`\n══════ ${label} (season ${seasonId}) — ${sales.length} cancelled orders ══════`);
  if (rows.length === 0) console.log('Nothing to reconcile.');
  else console.table(rows);
}

async function main() {
  const only = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const seasons = await prisma.season.findMany({ where: only ? { id: only } : {}, orderBy: { id: 'asc' } });
  for (const s of seasons) await auditSeason(s.id, s.name);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
