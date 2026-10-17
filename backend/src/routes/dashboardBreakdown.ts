// ============================================
// Dashboard card breakdowns (read-only)
// GET /api/dashboard/breakdown/net-profit
// GET /api/dashboard/breakdown/expenses            (+ /records?category=)
// GET /api/dashboard/breakdown/sales               (+ /records?group=&value=)
//
// Every figure comes from computeDashboardCashFlow(), the same function that
// feeds GET /api/dashboard, so totals reconcile with the cards by construction.
// ============================================

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { getSeasonId, seasonWhere } from '../services/seasonContext';
import { computeDashboardCashFlow } from '../services/financialMetrics';
import { buildReceivablesAudit } from '../services/receivablesAudit';
import { holdsCollectedCash } from '../services/readyStockPositions';
import { ledgerTotal } from '../services/shippingCollections';

const router = Router();
router.use(authenticate);

const STATUS_DISPATCHED = 'تم الصرف';
const STATUS_NOT_DISPATCHED = 'لم يتم الصرف';
const STATUS_CANCELED = 'تم الإلغاء';

const CAT_DEBT = 'debt_payments';
const CAT_REFUND = 'refunds';
const CAT_OP_PREFIX = 'op:';

const round2 = (n: number) => Math.round(n * 100) / 100;
const dateOf = (d: Date) => d.toISOString().slice(0, 10);

const can = (req: Request, permission: string) => !!req.user?.permissions?.includes(permission);
const forbid = (res: Response, permission: string) => res.status(403).json({ message: 'Forbidden', permission });

async function loadSeasonData(req: Request) {
  const seasonId = await getSeasonId(req);
  const [sales, expenses, returns_, paymentLogs] = await Promise.all([
    prisma.sale.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }),
    prisma.expenseRevenue.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }),
    prisma.returnItem.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }),
    prisma.paymentLog.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }),
  ]);
  return { seasonId, sales, expenses, returns_, paymentLogs };
}

// ---------- Net profit ----------
router.get('/net-profit', async (req: Request, res: Response) => {
  try {
    const { seasonId, ...data } = await loadSeasonData(req);
    const cf = computeDashboardCashFlow(data);

    // Inflows from the expenses sheet, grouped by operation type (راس مالى / ايراد مبيعات / ...).
    const inByType = new Map<string, number>();
    data.expenses.forEach(e => {
      if (e.amount_in !== 0) inByType.set(e.operation_type, (inByType.get(e.operation_type) || 0) + e.amount_in);
    });

    const inflows = [
      ...[...inByType.entries()].map(([label, amount]) => ({ key: `${CAT_OP_PREFIX}${label}`, label: `وارد — ${label}`, amount })),
      { key: 'deposits', label: 'عربون / مدفوع مقدماً من الأوردرات', amount: cf.depositIn },
      { key: 'shipping_collected', label: 'محصّل من شركة الشحن (أوردرات تم صرفها)', amount: cf.remainingIn },
      { key: 'client_payments', label: 'دفعات حسابات العملاء', amount: cf.clientPayIn },
    ];
    const outflows = [
      { key: 'expenses_out', label: 'منصرفات (المصروفات والإيرادات)', amount: cf.expenseOut },
      { key: 'debt_payments', label: 'سداد ديون', amount: cf.debtOut },
      { key: 'refunds', label: 'مرتجعات (مبالغ مستردة)', amount: cf.refundOut },
    ];

    return res.json({
      season_id: seasonId,
      method: 'صافي الربح = إجمالي الوارد − إجمالي الصادر (حساب نقدي).',
      cogs_included: false,
      cogs_note: 'تكلفة البضاعة المباعة غير داخلة في معادلة صافي الربح الحالية في لوحة التحكم.',
      total_revenue: round2(cf.totalIn),
      total_expenses: round2(cf.totalOut),
      net_profit: round2(cf.netProfit),
      inflows: inflows.map(i => ({ ...i, amount: round2(i.amount) })),
      outflows: outflows.map(o => ({ ...o, amount: round2(o.amount) })),
      raw: { total_in: cf.totalIn, total_out: cf.totalOut, net_profit: cf.netProfit },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حساب تفاصيل صافي الربح' });
  }
});

// ---------- Expenses ----------
type ExpenseCategory = { key: string; label: string; kind: 'expense' | 'debt_payment' | 'refund'; total: number; count: number };

router.get('/expenses', async (req: Request, res: Response) => {
  try {
    const { seasonId, ...data } = await loadSeasonData(req);
    const cf = computeDashboardCashFlow(data);

    const byOp = new Map<string, ExpenseCategory>();
    data.expenses.forEach(e => {
      if (e.amount_out === 0) return;
      const key = `${CAT_OP_PREFIX}${e.operation_type}`;
      const cur = byOp.get(key) ?? { key, label: e.operation_type, kind: 'expense' as const, total: 0, count: 0 };
      cur.total += e.amount_out;
      cur.count += 1;
      byOp.set(key, cur);
    });
    const debtLogs = data.paymentLogs.filter(p => p.type === 'debt_payment');

    const categories: ExpenseCategory[] = [...byOp.values()];
    if (debtLogs.length) categories.push({ key: CAT_DEBT, label: 'سداد ديون', kind: 'debt_payment', total: cf.debtOut, count: debtLogs.length });
    if (data.returns_.length) categories.push({ key: CAT_REFUND, label: 'مرتجعات (مبالغ مستردة)', kind: 'refund', total: cf.refundOut, count: data.returns_.length });
    categories.sort((a, b) => b.total - a.total);

    const categoriesSum = categories.reduce((s, c) => s + c.total, 0);
    const difference = round2(categoriesSum - cf.totalOut);

    return res.json({
      season_id: seasonId,
      total_expenses: round2(cf.totalOut),
      categories_total: round2(categoriesSum),
      reconciled: Math.abs(difference) < 0.005,
      difference,
      categories: categories.map(c => ({ ...c, total: round2(c.total) })),
      record_access: {
        expense: can(req, 'expenses.view'),
        debt_payment: can(req, 'payment_log.view'),
        refund: can(req, 'returns.view'),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حساب تفاصيل المصاريف' });
  }
});

router.get('/expenses/records', async (req: Request, res: Response) => {
  try {
    const category = String(req.query.category || '');
    if (!category) return res.status(400).json({ message: 'التصنيف مطلوب' });
    const seasonId = await getSeasonId(req);

    type Row = { id: number; date: string; description: string; category: string; amount: number; reference: string };
    let rows: Row[] = [];

    if (category === CAT_DEBT) {
      if (!can(req, 'payment_log.view')) return forbid(res, 'payment_log.view');
      const logs = await prisma.paymentLog.findMany({ where: { ...seasonWhere(seasonId), type: 'debt_payment' }, orderBy: { id: 'asc' } });
      rows = logs.map(l => ({ id: l.id, date: l.date, description: l.description, category: 'سداد ديون', amount: l.amount, reference: l.receiver ? `المستلم: ${l.receiver}` : `سجل دفع #${l.id}` }));
    } else if (category === CAT_REFUND) {
      if (!can(req, 'returns.view')) return forbid(res, 'returns.view');
      const items = await prisma.returnItem.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } });
      rows = items.map(r => ({
        id: r.id, date: r.date, description: [r.client_name, r.model_code].filter(Boolean).join(' - ') + (r.notes ? ` (${r.notes})` : ''),
        category: 'مرتجعات', amount: r.refund_amount, reference: r.order_number || `مرتجع #${r.id}`,
      }));
    } else if (category.startsWith(CAT_OP_PREFIX)) {
      if (!can(req, 'expenses.view')) return forbid(res, 'expenses.view');
      const op = category.slice(CAT_OP_PREFIX.length);
      const items = await prisma.expenseRevenue.findMany({
        where: { ...seasonWhere(seasonId), operation_type: op, amount_out: { not: 0 } }, orderBy: { id: 'asc' },
      });
      rows = items.map(e => ({ id: e.id, date: e.date, description: e.statement, category: e.operation_type, amount: e.amount_out, reference: `قيد #${e.id}` }));
    } else {
      return res.status(400).json({ message: 'تصنيف غير معروف' });
    }

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
    return res.json({ category, count: rows.length, total: round2(rows.reduce((s, r) => s + r.amount, 0)), records: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في جلب سجلات المصاريف' });
  }
});

// ---------- Sales ----------
const GROUPS = ['status', 'marketer', 'delivery_method'] as const;
type Group = typeof GROUPS[number];

router.get('/sales', async (req: Request, res: Response) => {
  try {
    const { seasonId, sales } = await loadSeasonData(req);

    // Mirrors the dashboard: the "total sales" card sums EVERY sale in the season,
    // canceled ones included — so the canceled slice is exposed, not hidden.
    const totalInvoice = sales.reduce((s, x) => s + x.invoice_value, 0);
    const deposits = sales.reduce((s, x) => s + x.deposit_paid, 0);
    const shippingCollected = sales.filter(s => holdsCollectedCash(s.order_status)).reduce((s, x) => s + x.shipping_collected, 0);
    // Sales part of "الفلوس اللي لنا برا" (same rule as the dashboard).
    const outstanding =
      sales.filter(s => s.order_status === STATUS_NOT_DISPATCHED).reduce((s, x) => s + Math.max(0, x.remaining), 0) +
      sales.filter(s => s.order_status === STATUS_DISPATCHED).reduce((s, x) => s + Math.max(0, x.remaining - x.shipping_collected), 0);

    const build = (pick: (s: typeof sales[number]) => string) => {
      const m = new Map<string, { value: string; count: number; invoice_value: number; deposit_paid: number; collected: number }>();
      sales.forEach(s => {
        const v = pick(s) || 'غير محدد';
        const cur = m.get(v) ?? { value: v, count: 0, invoice_value: 0, deposit_paid: 0, collected: 0 };
        cur.count += 1;
        cur.invoice_value += s.invoice_value;
        cur.deposit_paid += s.deposit_paid;
        cur.collected += holdsCollectedCash(s.order_status) ? s.shipping_collected : 0;
        m.set(v, cur);
      });
      return [...m.values()].sort((a, b) => b.invoice_value - a.invoice_value)
        .map(g => ({ ...g, invoice_value: round2(g.invoice_value), deposit_paid: round2(g.deposit_paid), collected: round2(g.collected) }));
    };

    const canceled = sales.filter(s => s.order_status === STATUS_CANCELED);

    return res.json({
      season_id: seasonId,
      total_sales: round2(totalInvoice),
      order_count: sales.length,
      total_deposits: round2(deposits),
      total_shipping_collected: round2(shippingCollected),
      total_cash_collected: round2(deposits + shippingCollected),
      total_outstanding: round2(outstanding),
      canceled_count: canceled.length,
      canceled_value: round2(canceled.reduce((s, x) => s + x.invoice_value, 0)),
      by_status: build(s => s.order_status),
      by_marketer: build(s => s.marketer),
      by_delivery_method: build(s => s.delivery_method),
      can_view_records: can(req, 'sales.view'),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حساب تفاصيل المبيعات' });
  }
});

router.get('/sales/records', async (req: Request, res: Response) => {
  try {
    if (!can(req, 'sales.view')) return forbid(res, 'sales.view');
    const group = String(req.query.group || 'all');
    const value = String(req.query.value ?? '');
    if (group !== 'all' && !(GROUPS as readonly string[]).includes(group)) return res.status(400).json({ message: 'مجموعة غير معروفة' });

    const seasonId = await getSeasonId(req);
    let sales = await prisma.sale.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'desc' } });
    if (group !== 'all') {
      const field = ({ status: 'order_status', marketer: 'marketer', delivery_method: 'delivery_method' } as const)[group as Group];
      sales = sales.filter(s => (s[field] || 'غير محدد') === value);
    }

    const records = sales.map(s => ({
      id: s.id, order_number: s.order_number, date: dateOf(s.created_at), client: s.client, marketer: s.marketer,
      order_status: s.order_status, delivery_method: s.delivery_method,
      invoice_value: s.invoice_value, deposit_paid: s.deposit_paid,
      shipping_collected: holdsCollectedCash(s.order_status) ? s.shipping_collected : 0,
      remaining: s.remaining,
    }));
    return res.json({
      group, value, count: records.length,
      total_invoice_value: round2(records.reduce((s, r) => s + r.invoice_value, 0)),
      records,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في جلب سجلات المبيعات' });
  }
});

// ---------- Receivables audit (read-only) ----------
// Per-order proof behind "الفلوس اللي لنا برا": what shipped, what left stock, what was collected,
// what is still owed, and whether the same debt is counted twice. Needs order-level access.
router.get('/receivables-audit', async (req: Request, res: Response) => {
  try {
    if (!can(req, 'sales.view')) return forbid(res, 'sales.view');
    const seasonId = await getSeasonId(req);
    const where = seasonWhere(seasonId);
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
    const bySale = new Map<number, { amount: number }[]>();
    collections.forEach(c => bySale.set(c.sale_id, [...(bySale.get(c.sale_id) ?? []), c]));
    const collectedBySale = new Map([...bySale.entries()].map(([id, rows]) => [id, ledgerTotal(rows)]));
    return res.json({
      season_id: seasonId,
      ...buildReceivablesAudit({ sales, readyStock, modelProds, returns_, clientAccts, clientInvoices, movements, collectedBySale }),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تدقيق المستحقات' });
  }
});

export default router;
