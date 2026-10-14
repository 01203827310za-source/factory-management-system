// ============================================
// Shipping-collection ledger — pure planning logic (no DB access).
//
// sales.shipping_collected = Σ ledger rows. Saving an order never "adds the new amount": the
// route asks planCollectionChange() what difference (if any) must be appended, so
//   • re-saving with the same amount → no rows (idempotent)
//   • 8,200 → 8,000                  → one −200 row, cash moves by 200 only
//   • leaving "تم الصرف"             → one reversing row, cash returns to 0
// Corrections are allocated against the most recent collection dates first, so a month's
// totals (monthly charity) are corrected where the money was originally recorded.
// ============================================

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type CollectionKind = 'opening' | 'collection' | 'correction' | 'reversal';

export type LedgerRow = { id?: number; amount: number; kind?: string; collected_date: string; date_estimated?: boolean };

export type NewCollectionRow = { amount: number; kind: CollectionKind; collected_date: string; date_estimated: boolean };

export function ledgerTotal(rows: Pick<LedgerRow, 'amount'>[]): number {
  return round2(rows.reduce((s, r) => s + r.amount, 0));
}

/** Net amount still standing per collection date, newest date first. */
function netByDateNewestFirst(rows: LedgerRow[]): { date: string; net: number; estimated: boolean }[] {
  const m = new Map<string, { net: number; estimated: boolean }>();
  rows.forEach(r => {
    const cur = m.get(r.collected_date) ?? { net: 0, estimated: false };
    cur.net += r.amount;
    cur.estimated = cur.estimated || !!r.date_estimated;
    m.set(r.collected_date, cur);
  });
  return [...m.entries()]
    .map(([date, v]) => ({ date, net: round2(v.net), estimated: v.estimated }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Rows to append so the ledger total becomes `desiredTotal`.
 * `previousCached` is the order's stored shipping_collected: used as an opening balance when the
 * order has no ledger rows yet (e.g. migration not back-filled), so history is never lost.
 */
export function planCollectionChange(args: {
  rows: LedgerRow[];
  previousCached: number;
  desiredTotal: number;
  /** Date for newly received money (YYYY-MM-DD). */
  date: string;
}): NewCollectionRow[] {
  const out: NewCollectionRow[] = [];
  let rows = args.rows;

  if (rows.length === 0 && round2(args.previousCached) !== 0) {
    const opening: NewCollectionRow = { amount: round2(args.previousCached), kind: 'opening', collected_date: args.date, date_estimated: true };
    out.push(opening);
    rows = [{ amount: opening.amount, collected_date: opening.collected_date, date_estimated: true }];
  }

  const current = ledgerTotal(rows);
  const delta = round2(args.desiredTotal - current);
  if (Math.abs(delta) < 0.005) return out;

  if (delta > 0) {
    out.push({ amount: delta, kind: 'collection', collected_date: args.date, date_estimated: false });
    return out;
  }

  // Negative: take it back from the newest dates that still hold money.
  let toRemove = -delta;
  const kind: CollectionKind = round2(args.desiredTotal) === 0 ? 'reversal' : 'correction';
  for (const d of netByDateNewestFirst(rows)) {
    if (toRemove <= 0.004) break;
    if (d.net <= 0) continue;
    const take = round2(Math.min(d.net, toRemove));
    out.push({ amount: -take, kind, collected_date: d.date, date_estimated: d.estimated });
    toRemove = round2(toRemove - take);
  }
  if (toRemove > 0.004) {
    // Ledger had less than the amount being removed (cannot happen if total ≥ 0) — keep it explicit.
    out.push({ amount: -toRemove, kind, collected_date: args.date, date_estimated: true });
  }
  return out;
}

/** Month (YYYY-MM) → net collected, for monthly charity. Orders counted = distinct sales with a positive net. */
export function collectionsByMonthFromLedger(
  rows: (LedgerRow & { sale_id: number })[],
): Map<string, { month: string; total: number; order_count: number; estimated_total: number; estimated_count: number }> {
  const perMonthSale = new Map<string, Map<number, { net: number; estimated: boolean }>>();
  rows.forEach(r => {
    const month = r.collected_date.slice(0, 7);
    const sales = perMonthSale.get(month) ?? new Map<number, { net: number; estimated: boolean }>();
    const cur = sales.get(r.sale_id) ?? { net: 0, estimated: false };
    cur.net += r.amount;
    cur.estimated = cur.estimated || !!r.date_estimated;
    sales.set(r.sale_id, cur);
    perMonthSale.set(month, sales);
  });

  const out = new Map<string, { month: string; total: number; order_count: number; estimated_total: number; estimated_count: number }>();
  perMonthSale.forEach((sales, month) => {
    const row = { month, total: 0, order_count: 0, estimated_total: 0, estimated_count: 0 };
    sales.forEach(v => {
      const net = round2(v.net);
      if (net <= 0) return;
      row.total += net;
      row.order_count += 1;
      if (v.estimated) { row.estimated_total += net; row.estimated_count += 1; }
    });
    row.total = round2(row.total);
    row.estimated_total = round2(row.estimated_total);
    if (row.total > 0) out.set(month, row);
  });
  return out;
}
