// ============================================
// Cash ledger — every actual cash movement of a season, one line each, traceable to its source record.
//
// The system has no separate cash table: cash is DERIVED from records that already exist, and the Dashboard's
// «الصافي» (= إجمالي الوارد − إجمالي المنصرف, see financialMetrics.computeDashboardCashFlow) is the sum of exactly
// these sources. This builder lists the same sources line by line, so:
//
//   Σ ledger lines (excluding explicit adjustments) === Dashboard «الصافي»          (checked, reported as a discrepancy)
//
// Sources (nothing is invented; anything that cannot be traced is flagged `verified: false` instead):
//   sales.deposit_paid                  → «عربون مستلم»        (its date is the order's creation day — no separate deposit date is stored)
//   shipping_collections (signed rows)  → collection / correction / reversal / repayment, dated by the day the money was received
//   order_cancellations.deposit_held    → «عكس عربون بسبب الإلغاء»  (a reversal, NOT a refund that was paid)
//   expenses_revenues                   → expenses paid / other income / charity
//   payment_logs                        → customer payments received / debt payments paid
//   return_items.refund_amount          → refunds actually paid to customers
//   cash_adjustments                    → the opening balance and explicit, reasoned corrections (never silent)
//
// Closing = Opening + Σ inflows − Σ outflows.   Unpaid invoices, expected shipping collections, inventory value and
// uncollected balances are NOT cash and never appear here.
// ============================================
import type { CashAdjustment, ExpenseRevenue, OrderCancellation, PaymentLog, ReturnItem, Sale, ShippingCollection } from '@prisma/client';
import { holdsCollectedCash } from './readyStockPositions';
import { CHARITY_OPERATION_TYPE } from './charity';

export const round2 = (n: number) => Math.round(n * 100) / 100;

export type CashCategory =
  | 'deposit' | 'deposit_reversal'
  | 'shipping_collection' | 'shipping_reversal' | 'shipping_repayment' | 'shipping_unrecorded'
  | 'client_payment' | 'other_income'
  | 'expense' | 'charity' | 'debt_payment' | 'customer_refund'
  | 'opening' | 'adjustment';

export const CATEGORY_LABELS: Record<CashCategory, string> = {
  deposit: 'عربون عميل مستلم',
  deposit_reversal: 'عكس عربون بسبب إلغاء (ليس ردًّا مدفوعًا)',
  shipping_collection: 'تحصيل من شركة الشحن',
  shipping_reversal: 'عكس تحصيل بسبب إلغاء / تصحيح (ليس ردًّا مدفوعًا)',
  shipping_repayment: 'رد فعلي لشركة الشحن',
  shipping_unrecorded: 'تحصيل شحن بلا سجل تفصيلي',
  client_payment: 'دفعة عميل مستلمة',
  other_income: 'إيراد آخر مسجّل',
  expense: 'مصروف مدفوع',
  charity: 'صدقة مدفوعة',
  debt_payment: 'سداد دين',
  customer_refund: 'رد فعلي للعميل',
  opening: 'رصيد افتتاحي (مسجّل يدويًا)',
  adjustment: 'تسوية موثقة',
};

export type CashLine = {
  key: string;
  date: string;              // YYYY-MM-DD
  time: string;              // ISO timestamp of the record (ordering inside a day)
  category: CashCategory;
  label: string;
  description: string;
  order_id: number | null;
  order_number: string;
  party: string;
  in: number;
  out: number;
  balance: number;           // running balance AFTER this line (opening + everything up to here)
  source: { table: string; id: number };
  status: string;
  note: string;
  verified: boolean;         // false → the amount is real but its date / detail could not be reconstructed exactly
};

export type CashLedgerInput = {
  sales: Sale[];
  collections: ShippingCollection[];
  cancellations: OrderCancellation[];
  expenses: ExpenseRevenue[];
  paymentLogs: PaymentLog[];
  returns_: ReturnItem[];
  adjustments: CashAdjustment[];
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const norm = (s: string) => String(s ?? '').trim().toLowerCase();

type Raw = Omit<CashLine, 'balance'> & { seq: number };

/** Every cash line of the season (unfiltered, chronological), WITHOUT running balances. */
export function buildCashLines(input: CashLedgerInput): Raw[] {
  const lines: Raw[] = [];
  let seq = 0;
  const add = (l: Omit<Raw, 'seq' | 'note' | 'status' | 'verified' | 'order_id' | 'order_number' | 'party' | 'label'> & Partial<Pick<Raw, 'note' | 'status' | 'verified' | 'order_id' | 'order_number' | 'party'>>) => {
    lines.push({ order_id: null, order_number: '', party: '', note: '', status: '', verified: true, ...l, label: CATEGORY_LABELS[l.category], seq: seq++ });
  };

  const colsBySale = new Map<number, ShippingCollection[]>();
  input.collections.forEach(c => colsBySale.set(c.sale_id, [...(colsBySale.get(c.sale_id) ?? []), c]));
  const cancelsBySale = new Map<number, OrderCancellation[]>();
  input.cancellations.forEach(c => cancelsBySale.set(c.sale_id, [...(cancelsBySale.get(c.sale_id) ?? []), c]));

  for (const s of input.sales) {
    const who = { order_id: s.id, order_number: s.order_number, party: s.client, status: s.order_status };

    // ── deposit: what is still held + what a cancellation took back ──
    const held = Math.max(0, ...(cancelsBySale.get(s.id) ?? []).map(c => c.deposit_held));
    const reversed = round2(Math.max(0, held - s.deposit_paid));
    const received = round2(s.deposit_paid + reversed);
    if (received > 0) {
      add({ ...who, key: `deposit:${s.id}`, date: day(s.created_at), time: s.created_at.toISOString(), category: 'deposit', in: received, out: 0,
        description: `عربون أوردر ${s.order_number}`, source: { table: 'sales', id: s.id },
        note: 'تاريخ العربون = تاريخ إنشاء الأوردر (لا يوجد تاريخ استلام منفصل)', verified: false });
    }
    if (reversed > 0) {
      const c = (cancelsBySale.get(s.id) ?? []).slice().sort((a, b) => a.id - b.id).find(x => x.deposit_held > 0) ?? (cancelsBySale.get(s.id) ?? [])[0];
      add({ ...who, key: `deposit-rev:${s.id}`, date: day(c.created_at), time: c.created_at.toISOString(), category: 'deposit_reversal', in: 0, out: reversed,
        description: `عكس عربون أوردر ${s.order_number} عند الإلغاء`, source: { table: 'order_cancellations', id: c.id },
        note: 'قيد عكسي بسبب الإلغاء — لا يعني أن المبلغ رُدَّ فعلًا للعميل' });
    }

    // ── shipping collections: the signed ledger, by the day the money was received ──
    const rows = (colsBySale.get(s.id) ?? []).slice().sort((a, b) => a.id - b.id);
    let ledgerSum = 0;
    for (const r of rows) {
      ledgerSum += r.amount;
      const category: CashCategory = r.kind === 'repayment' ? 'shipping_repayment'
        : r.amount < 0 ? 'shipping_reversal' : 'shipping_collection';
      add({ ...who, key: `col:${r.id}`, date: r.collected_date || day(r.created_at), time: r.created_at.toISOString(), category,
        in: r.amount > 0 ? r.amount : 0, out: r.amount < 0 ? -r.amount : 0,
        description: `${r.kind === 'collection' ? 'تحصيل' : r.kind === 'repayment' ? 'رد لشركة الشحن' : r.kind === 'reversal' ? 'عكس تحصيل' : 'تصحيح تحصيل'} — أوردر ${s.order_number}`,
        source: { table: 'shipping_collections', id: r.id }, note: r.reference || '', verified: !r.date_estimated });
    }
    // Orders whose collected amount has no (or an incomplete) ledger history: the cached amount still counts as cash
    // in the Dashboard, so it is listed — flagged unverified, never silently dropped.
    const counted = holdsCollectedCash(s.order_status) ? s.shipping_collected : 0;
    const gap = round2(counted - ledgerSum);
    if (Math.abs(gap) > 0.005) {
      add({ ...who, key: `col-gap:${s.id}`, date: s.shipping_collected_date || day(s.created_at), time: s.created_at.toISOString(), category: 'shipping_unrecorded',
        in: gap > 0 ? gap : 0, out: gap < 0 ? -gap : 0, description: `تحصيل أوردر ${s.order_number} بلا سجل تحصيل تفصيلي`,
        source: { table: 'sales', id: s.id }, note: 'المبلغ محفوظ على الأوردر فقط — تاريخه تقديري', verified: false });
    }
  }

  // ── expenses / other income / charity ──
  for (const e of input.expenses) {
    const isCharity = e.operation_type === CHARITY_OPERATION_TYPE;
    if (e.amount_in > 0) add({ key: `exp-in:${e.id}`, date: e.date, time: e.created_at.toISOString(), category: 'other_income', in: e.amount_in, out: 0,
      description: `${e.operation_type} — ${e.statement}`, source: { table: 'expenses_revenues', id: e.id }, note: '' });
    if (e.amount_out > 0) add({ key: `exp-out:${e.id}`, date: e.date, time: e.created_at.toISOString(), category: isCharity ? 'charity' : 'expense', in: 0, out: e.amount_out,
      description: `${e.operation_type} — ${e.statement}`, source: { table: 'expenses_revenues', id: e.id }, note: '' });
  }
  // ── client payments / debt payments ──
  for (const p of input.paymentLogs) {
    if (p.type === 'client_payment') add({ key: `pay:${p.id}`, date: p.date, time: p.created_at.toISOString(), category: 'client_payment', in: p.amount, out: 0,
      description: p.description || 'دفعة عميل', party: p.receiver, source: { table: 'payment_logs', id: p.id } });
    else if (p.type === 'debt_payment') add({ key: `pay:${p.id}`, date: p.date, time: p.created_at.toISOString(), category: 'debt_payment', in: 0, out: p.amount,
      description: p.description || 'سداد دين', party: p.receiver, source: { table: 'payment_logs', id: p.id },
      note: 'لا يفصل النظام الأصل عن الفوائد/الرسوم — المبلغ كما سُجّل' });
  }
  // ── refunds actually paid to customers ──
  const saleByNumber = new Map(input.sales.map(s => [norm(s.order_number), s]));
  for (const r of input.returns_) {
    if (r.refund_amount <= 0) continue;
    const sale = saleByNumber.get(norm(r.order_number));
    add({ key: `refund:${r.id}`, date: r.date, time: r.created_at.toISOString(), category: 'customer_refund', in: 0, out: r.refund_amount,
      description: `رد للعميل ${r.client_name}${r.order_number ? ` — أوردر ${r.order_number}` : ''}`,
      order_id: sale?.id ?? null, order_number: r.order_number, party: r.client_name, source: { table: 'return_items', id: r.id }, note: r.notes });
  }
  // ── explicit adjustments (opening balance + reasoned corrections) ──
  for (const a of input.adjustments) {
    add({ key: `adj:${a.id}`, date: a.entry_date, time: a.created_at.toISOString(), category: a.kind === 'opening' ? 'opening' : 'adjustment',
      in: a.amount > 0 ? a.amount : 0, out: a.amount < 0 ? -a.amount : 0, description: a.reason, party: a.created_by,
      source: { table: 'cash_adjustments', id: a.id }, note: `بواسطة ${a.created_by}` });
  }

  return lines.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.seq - b.seq);
}

export type CashReportOptions = { from?: string; to?: string };

/** Full report: lines inside the period with running balances + the summary cards. */
export function buildCashReport(input: CashLedgerInput & { fabricPurchasesTotal?: number; shippingReceivable?: number; dashboardNet: number }, opts: CashReportOptions = {}) {
  // The recorded opening balance is the STARTING point (not a movement); everything else is a dated movement.
  const all = buildCashLines(input).filter(l => l.category !== 'opening');
  const openingAdj = round2(input.adjustments.filter(a => a.kind === 'opening').reduce((n, a) => n + a.amount, 0));
  let running = openingAdj;
  let opening = openingAdj;
  const periodLines: CashLine[] = [];
  for (const l of all) {
    if (opts.from && l.date < opts.from) { running += l.in - l.out; opening = round2(running); continue; }
    if (opts.to && l.date > opts.to) continue;
    running += l.in - l.out;
    periodLines.push({ ...l, balance: round2(running) });
  }
  const sum = (f: (l: CashLine) => boolean, k: 'in' | 'out') => round2(periodLines.filter(f).reduce((n, l) => n + l[k], 0));
  const totalIn = sum(() => true, 'in');
  const totalOut = sum(() => true, 'out');
  const closing = round2(opening + totalIn - totalOut);

  const operatingLines = (l: Raw) => l.category !== 'adjustment';
  const ledgerOperatingNet = round2(all.filter(operatingLines).reduce((n, l) => n + l.in - l.out, 0));
  const unverified = all.filter(l => !l.verified);
  const reversalsNotPaid = round2(all.filter(l => l.category === 'deposit_reversal' || l.category === 'shipping_reversal').reduce((n, l) => n + l.out, 0));

  return {
    lines: periodLines,
    cards: {
      opening_balance: opening,
      recorded_opening_adjustment: openingAdj,
      total_in: totalIn,
      total_out: totalOut,
      net_movement: round2(totalIn - totalOut),
      closing_balance: closing,
      shipping_receivable: round2(input.shippingReceivable ?? 0),
      deposits_received: sum(l => l.category === 'deposit', 'in'),
      deposits_reversed_on_cancel: sum(l => l.category === 'deposit_reversal', 'out'),
      customer_refunds_paid: sum(l => l.category === 'customer_refund', 'out'),
      shipping_repayments_paid: sum(l => l.category === 'shipping_repayment', 'out'),
      capital_and_loans: null as number | null,            // the system has no record type for capital / loans — not guessed
    },
    reconciliation: {
      dashboard_net: round2(input.dashboardNet),
      ledger_operating_net: ledgerOperatingNet,
      discrepancy: round2(ledgerOperatingNet - input.dashboardNet),   // must be 0: same sources as the Dashboard
      unverified_count: unverified.length,
      unverified_amount: round2(unverified.reduce((n, l) => n + l.in + l.out, 0)),
      reversals_not_paid_out: reversalsNotPaid,
      fabric_purchases_not_in_cash: round2(input.fabricPurchasesTotal ?? 0),
    },
  };
}

/** Plain-language list of what the ledger does NOT cover, so a difference against physical cash can be explained. */
export const KNOWN_GAPS = [
  'مشتريات الأقمشة والإكسسوارات لا تدخل الكاش إلا إذا سُجّلت أيضًا كمصروف.',
  'الرواتب تُحسب في كشف الرواتب فقط ولا يوجد تسجيل لصرفها الفعلي، فلا تدخل الكاش.',
  'شراء الأصول الثابتة لا يحمل تاريخ دفع ولا موسمًا، فلا يدخل الكاش.',
  'رأس المال والقروض المستلمة وتحويلات الحسابات: النظام لا يملك لها نوع سجل، ولا توجد حسابات نقدية متعددة.',
  'العربون يُؤرَّخ بيوم إنشاء الأوردر لأن تاريخ استلامه غير مخزّن.',
];
