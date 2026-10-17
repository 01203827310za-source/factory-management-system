// ============================================
// Cash reconciliation report behind the Dashboard's «الصافي»
//   GET  /api/cash-report?from=&to=       ledger of every actual cash movement + summary cards + counts/adjustments
//   GET  /api/cash-report/order/:id       one order's complete money history
//   POST /api/cash-report/counts          record a physical cash count (compared with the calculated balance)
//   POST /api/cash-report/adjustments     record the opening balance / an explicit, reasoned correction
//
// Permissions (rbacService): reading = dashboard.view; recording a count / adjustment = expenses.create.
// Nothing here edits an existing financial record: counts and adjustments are NEW rows, with a reason and the user.
// ============================================

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';
import { getSeasonId, seasonWhere } from '../services/seasonContext';
import { cairoToday, isValidDate } from '../services/charity';
import { computeDashboardCashFlow, computeMoneyOwedToUs } from '../services/financialMetrics';
import { CATEGORY_LABELS, KNOWN_GAPS, buildCashReport, round2, type CashLedgerInput } from '../services/cashLedger';
import { ledgerTotal } from '../services/shippingCollections';

const router = Router();
router.use(authenticate);

async function loadInput(seasonId: number) {
  const where = seasonWhere(seasonId);
  const [sales, collections, cancellations, expenses, paymentLogs, returns_, adjustments, fabricPurchases] = await Promise.all([
    prisma.sale.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.shippingCollection.findMany({ where }),
    prisma.orderCancellation.findMany({ where }),
    prisma.expenseRevenue.findMany({ where }),
    prisma.paymentLog.findMany({ where }),
    prisma.returnItem.findMany({ where }),
    prisma.cashAdjustment.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.fabricPurchase.findMany({ where }),
  ]);
  const ledgerInput: CashLedgerInput = { sales, collections, cancellations, expenses, paymentLogs, returns_, adjustments };
  const dashboardNet = computeDashboardCashFlow({ sales, expenses, returns_, paymentLogs }).netProfit;
  return {
    ledgerInput, sales, collections, cancellations, returns_,
    extra: {
      dashboardNet,
      shippingReceivable: computeMoneyOwedToUs({ sales, clientAccts: [] }),
      fabricPurchasesTotal: fabricPurchases.reduce((n, p) => n + p.total_cost, 0),
    },
  };
}

const validRange = (q: Request['query']) => {
  const from = q.from ? String(q.from) : undefined;
  const to = q.to ? String(q.to) : undefined;
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) return null;
  if (from && to && from > to) return null;
  return { from, to };
};

router.get('/', async (req: Request, res: Response) => {
  try {
    const range = validRange(req.query);
    if (!range) return res.status(400).json({ message: 'نطاق التاريخ غير صالح' });
    const seasonId = await getSeasonId(req);
    const { ledgerInput, extra } = await loadInput(seasonId);
    const report = buildCashReport({ ...ledgerInput, ...extra }, range);
    const [counts, adjustments] = await Promise.all([
      prisma.cashCount.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'desc' }, take: 20 }),
      prisma.cashAdjustment.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'desc' } }),
    ]);
    return res.json({
      season_id: seasonId, from: range.from ?? null, to: range.to ?? null, today: cairoToday(),
      ...report,
      categories: CATEGORY_LABELS,
      known_gaps: KNOWN_GAPS,
      counts, adjustments,
      multi_account: false,   // one cash account: transfers between accounts do not exist in this system
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تحميل تقرير الكاش' });
  }
});

router.get('/order/:id', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const { ledgerInput, sales, collections, cancellations, returns_ } = await loadInput(seasonId);
    const sale = sales.find(s => s.id === id);
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    const report = buildCashReport({ ...ledgerInput, dashboardNet: 0 });
    const mine = report.lines.filter(l => l.order_id === id);
    const cols = collections.filter(c => c.sale_id === id);
    const cancels = cancellations.filter(c => c.sale_id === id);
    const refunds = returns_.filter(r => r.order_number.trim().toLowerCase() === sale.order_number.trim().toLowerCase() && r.refund_amount > 0);
    const cancelled = sale.order_status === 'تم الإلغاء';
    const collectedNet = ledgerTotal(cols);
    return res.json({
      order: { id: sale.id, order_number: sale.order_number, client: sale.client, status: sale.order_status, created_at: sale.created_at },
      invoice_amount: sale.invoice_value,
      deposit_received: round2(mine.filter(l => l.category === 'deposit').reduce((n, l) => n + l.in, 0)),
      deposit_reversed_on_cancel: round2(mine.filter(l => l.category === 'deposit_reversal').reduce((n, l) => n + l.out, 0)),
      additional_customer_payments: null,   // payments are not linked to an order in this system
      shipping_collected_gross: round2(cols.filter(c => c.amount > 0).reduce((n, c) => n + c.amount, 0)),
      shipping_collected_net: round2(collectedNet),
      shipping_deductions_or_fees: null,    // the system does not record shipping-company fees
      customer_refunded: round2(refunds.reduce((n, r) => n + r.refund_amount, 0)),
      shipping_repaid: round2(cols.filter(c => c.kind === 'repayment').reduce((n, c) => n - c.amount, 0)),
      remaining_due: cancelled ? 0 : round2(Math.max(0, sale.remaining - sale.shipping_collected)),
      lines: mine,
      cancellations: cancels.map(c => ({
        id: c.id, at: c.created_at, by: c.created_by, reason: c.reason, status_before: c.status_before, reopened_at: c.reopened_at,
        deposit_reversed: c.deposit_held, collected_reversed: c.collected_held, goods_qty: c.goods_qty, goods_cost: c.goods_cost,
      })),
      note: 'عودة البضاعة للمخزون حركة مخزون وليست حركة نقدية — لا تظهر في الكاش.',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تحميل سجل الأوردر المالي' });
  }
});

const keyOk = (k: unknown): k is string => typeof k === 'string' && k.length >= 8 && k.length <= 100;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

router.post('/counts', requireManager, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const counted = num(body.counted_amount);
    if (!Number.isFinite(counted) || counted < 0) return res.status(400).json({ message: 'المبلغ المعدود غير صالح' });
    const date = body.count_date === undefined || body.count_date === '' ? cairoToday() : body.count_date;
    if (!isValidDate(date)) return res.status(400).json({ message: 'تاريخ الجرد غير صالح' });
    if (!keyOk(body.idempotency_key)) return res.status(400).json({ message: 'معرّف العملية (idempotency_key) مطلوب' });
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
    const seasonId = await getSeasonId(req);

    const dup = await prisma.cashCount.findUnique({ where: { idempotency_key: body.idempotency_key } });
    if (dup) return res.status(200).json({ duplicate: true, count: dup });

    const { ledgerInput, extra } = await loadInput(seasonId);
    const calculated = buildCashReport({ ...ledgerInput, ...extra }, { to: date }).cards.closing_balance;
    try {
      const count = await prisma.cashCount.create({ data: {
        season_id: seasonId, count_date: date, counted_amount: round2(counted), calculated_amount: calculated,
        difference: round2(counted - calculated), note, idempotency_key: body.idempotency_key, created_by: req.user?.username ?? '',
      } });
      logAudit({ user: req.user, module: 'CashReconciliation', action: 'CASH_COUNT', record_id: count.id, after_data: count,
        description: `جرد الكاش بتاريخ ${date}: المعدود ${count.counted_amount} — المحسوب ${count.calculated_amount} — الفرق ${count.difference}` });
      return res.status(201).json({ duplicate: false, count });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return res.status(200).json({ duplicate: true, count: await prisma.cashCount.findUnique({ where: { idempotency_key: body.idempotency_key } }) });
      }
      throw e;
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تسجيل الجرد' });
  }
});

router.post('/adjustments', requireManager, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = body.kind;
    if (kind !== 'opening' && kind !== 'adjustment') return res.status(400).json({ message: 'نوع التسوية غير صالح' });
    const amount = num(body.amount);
    if (!Number.isFinite(amount) || (kind === 'adjustment' && amount === 0) || (kind === 'opening' && amount < 0)) {
      return res.status(400).json({ message: kind === 'opening' ? 'الرصيد الافتتاحي يجب أن يكون صفرًا أو أكبر' : 'مبلغ التسوية يجب ألا يكون صفرًا' });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
    if (reason.length < 3) return res.status(400).json({ message: 'سبب التسوية مطلوب' });
    const date = body.entry_date === undefined || body.entry_date === '' ? cairoToday() : body.entry_date;
    if (!isValidDate(date)) return res.status(400).json({ message: 'التاريخ غير صالح' });
    if (!keyOk(body.idempotency_key)) return res.status(400).json({ message: 'معرّف العملية (idempotency_key) مطلوب' });
    const seasonId = await getSeasonId(req);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${seasonId}::int, hashtext('cash-adjustment'))`;
      const dup = await tx.cashAdjustment.findUnique({ where: { idempotency_key: body.idempotency_key as string } });
      if (dup) return { duplicate: true as const, adjustment: dup };
      if (kind === 'opening' && await tx.cashAdjustment.findFirst({ where: { season_id: seasonId, kind: 'opening' } })) {
        throw new Error('OPENING_EXISTS');
      }
      const adjustment = await tx.cashAdjustment.create({ data: {
        season_id: seasonId, kind, amount: round2(amount), entry_date: date, reason, idempotency_key: body.idempotency_key as string, created_by: req.user?.username ?? '',
      } });
      return { duplicate: false as const, adjustment };
    });
    if (!result.duplicate) {
      logAudit({ user: req.user, module: 'CashReconciliation', action: kind === 'opening' ? 'CASH_OPENING_SET' : 'CASH_ADJUSTMENT', record_id: result.adjustment.id,
        after_data: result.adjustment, description: `${kind === 'opening' ? 'رصيد افتتاحي' : 'تسوية كاش'} ${result.adjustment.amount} ج — ${reason}` });
    }
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'OPENING_EXISTS') return res.status(400).json({ message: 'الرصيد الافتتاحي مسجّل بالفعل لهذا الموسم — سجّل تسوية موثقة بدلًا من تعديله' });
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تسجيل التسوية' });
  }
});

export default router;
