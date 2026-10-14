// READ-ONLY audit of "الفلوس اللي لنا برا" (money owed to us).
//   npm run audit:receivables            → every season
//   npm run audit:receivables -- 2       → season id 2 only
// Only findMany() calls are made — nothing is created, updated or deleted.
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { buildReceivablesAudit } from '../src/services/receivablesAudit';
import { ledgerTotal } from '../src/services/shippingCollections';

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

async function auditSeason(seasonId: number, label: string) {
  const where = { season_id: seasonId };
  const [sales, readyStock, modelProds, returns_, clientAccts, clientInvoices, movements, collections] = await Promise.all([
    prisma.sale.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.readyStock.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.modelProduction.findMany({ where }),
    prisma.returnItem.findMany({ where }),
    prisma.clientAccount.findMany({ where }),
    prisma.clientAccountInvoice.findMany({ where }),
    prisma.inventoryMovement.findMany({ where }),
    prisma.shippingCollection.findMany({ where }),
  ]);
  const perSale = new Map<number, { amount: number }[]>();
  collections.forEach(c => perSale.set(c.sale_id, [...(perSale.get(c.sale_id) ?? []), c]));
  const collectedBySale = new Map([...perSale.entries()].map(([id, rows]) => [id, ledgerTotal(rows)]));

  const audit = buildReceivablesAudit({ sales, readyStock, modelProds, returns_, clientAccts, clientInvoices, movements, collectedBySale });

  console.log(`\n══════ ${label} (season ${seasonId}) ══════`);
  if (audit.orders.length === 0) console.log('No orders in status "لم يتم الصرف".');
  else {
    console.table(audit.orders.map(o => ({
      order_id: o.sale_id, order: o.order_number, invoice: o.invoice_value, shipped_qty: o.shipped_qty,
      qty_deducted: o.inventory_qty_deducted, cost_deducted_card: o.inventory_cost_deducted_card,
      cost_deducted_recorded: o.inventory_cost_deducted_recorded ?? 'n/a', collected: o.collected_amount,
      outstanding: o.outstanding_receivable, stock_status: o.stock_status, still_in_stock: o.inventory_still_in_stock ? 'YES' : 'no',
      in_client_acct: o.also_in_client_account ? o.also_in_client_account.amount : '',
    })));
    audit.orders.filter(o => o.notes.length).forEach(o => console.log(`  #${o.sale_id} ${o.order_number}: ${o.notes.join(' | ')}`));
  }
  const t = audit.totals, r = audit.reconciliation;
  console.log('\nTotals (لم يتم الصرف):', {
    orders: t.orders, invoice: fmt(t.invoice_value), shipped_qty: t.shipped_qty, qty_deducted: t.inventory_qty_deducted,
    cost_deducted_card: fmt(t.inventory_cost_deducted_card), collected: fmt(t.collected_amount), outstanding: fmt(t.outstanding_receivable),
  });
  console.log('Reconciliation of money_owed_to_us:', {
    shipping_not_paid_out: fmt(r.shipping_receivable_not_paid_out), shipping_paid_out_gap: fmt(r.shipping_receivable_paid_out_gap),
    client_accounts: fmt(r.client_accounts_receivable), money_owed_to_us: fmt(r.money_owed_to_us),
  });
  console.log(`Double-counted (same order as shipping receivable AND client-account invoice): ${r.double_counted_orders} orders, ${fmt(r.double_counted_amount)} EGP`);
  console.log(`On-account orders with no client-account invoice (receivable not counted anywhere): ${r.on_account_orders_without_client_invoice.length}`);
  console.log(`Orders with no recorded shipping cost (shipped before the cost ledger): ${r.uncosted_orders}`);
}

async function main() {
  const arg = process.argv[2] ? Number(process.argv[2]) : null;
  const seasons = await prisma.season.findMany({ where: arg ? { id: arg } : {}, orderBy: { id: 'asc' } });
  for (const s of seasons) await auditSeason(s.id, s.name);
}

main()
  .catch(err => { console.error('Audit failed:', err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
