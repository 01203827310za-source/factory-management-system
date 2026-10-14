// ============================================
// Monthly charity (صدقة الشهر)
//   GET    /api/charity/summary?month=YYYY-MM   one month (defaults to the current Cairo month)
//   GET    /api/charity/history                 every month of the season
//   POST   /api/charity/payments                record a (partial) payment  → creates the expense
//   DELETE /api/charity/payments/:id            reverse a payment           → deletes the expense
//
// Permissions: /api/charity is mapped to the `expenses` module in rbacService
// (view / create / delete), because a payment IS an expense.
//
// Accounting: a payment writes ONE expenses_revenues row (operation_type 'صدقة',
// amount_out = amount) in the same DB transaction as its charity_payments row. Every
// financial formula already reads expenses_revenues, so cash / total expenses / net profit
// move by the paid amount exactly once. charity_payments is never read by those formulas.
// ============================================

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';
import { getSeasonId, seasonWhere } from '../services/seasonContext';
import {
  CHARITY_OPERATION_TYPE, STATUS_DISPATCHED, STATUS_LABELS, cairoToday, charityDue, charityStatus,
  collectionsByMonth, isValidDate, isValidMonth, monthLabel, round2,
} from '../services/charity';

const router = Router();
router.use(authenticate);

type PaymentWithExpense = Prisma.CharityPaymentGetPayload<{ include: { expense: true } }>;

const paymentView = (p: PaymentWithExpense) => ({
  id: p.id,
  amount: round2(p.amount),
  payment_date: p.payment_date,
  payment_method: p.payment_method,
  notes: p.notes,
  created_by: p.created_by,
  created_at: p.created_at,
  expense: p.expense
    ? { id: p.expense.id, date: p.expense.date, operation_type: p.expense.operation_type, statement: p.expense.statement, amount_out: p.expense.amount_out }
    : null,
});

function monthSummary(
  month: string,
  seasonId: number,
  collections: ReturnType<typeof collectionsByMonth>,
  payments: PaymentWithExpense[],
) {
  const c = collections.get(month);
  const total = round2(c?.total ?? 0);
  const { rate, due } = charityDue(total);
  const mine = payments.filter(p => p.charity_month === month);
  const paid = round2(mine.reduce((s, p) => s + p.amount, 0));
  const status = charityStatus(due, paid);
  return {
    month,
    label: monthLabel(month),
    season_id: seasonId,
    collections_total: total,
    order_count: c?.order_count ?? 0,
    // Orders confirmed before payout dates were recorded are dated by creation day — surfaced, not hidden.
    estimated_count: c?.estimated_count ?? 0,
    estimated_total: round2(c?.estimated_total ?? 0),
    rate,
    rate_percent: round2(rate * 100),
    due,
    paid,
    remaining: round2(Math.max(0, due - paid)),
    overpaid: round2(Math.max(0, paid - due)),
    status,
    status_label: STATUS_LABELS[status],
    payment_count: mine.length,
    payments: mine.sort((a, b) => b.id - a.id).map(paymentView),
  };
}

async function loadSeason(seasonId: number) {
  const [sales, payments] = await Promise.all([
    prisma.sale.findMany({ where: { ...seasonWhere(seasonId), order_status: STATUS_DISPATCHED } }),
    prisma.charityPayment.findMany({ where: seasonWhere(seasonId), include: { expense: true }, orderBy: { id: 'asc' } }),
  ]);
  return { collections: collectionsByMonth(sales), payments };
}

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const month = req.query.month ? String(req.query.month) : cairoToday().slice(0, 7);
    if (!isValidMonth(month)) return res.status(400).json({ message: 'الشهر غير صالح (YYYY-MM)' });
    const seasonId = await getSeasonId(req);
    const { collections, payments } = await loadSeason(seasonId);
    return res.json(monthSummary(month, seasonId, collections, payments));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حساب صدقة الشهر' });
  }
});

router.get('/history', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const { collections, payments } = await loadSeason(seasonId);
    const months = new Set<string>([...collections.keys(), ...payments.map(p => p.charity_month), cairoToday().slice(0, 7)]);
    const rows = [...months].sort().reverse().map(m => {
      const { payments: _p, ...row } = monthSummary(m, seasonId, collections, payments);
      return row;
    });
    return res.json({ season_id: seasonId, months: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في جلب سجل الصدقات' });
  }
});

router.post('/payments', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const month = body.charity_month;
    if (!isValidMonth(month)) return res.status(400).json({ message: 'شهر الصدقة غير صالح' });

    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: 'مبلغ الصدقة يجب أن يكون أكبر من صفر' });
    const amt = round2(amount);

    const paymentDate = body.payment_date === undefined || body.payment_date === '' ? cairoToday() : body.payment_date;
    if (!isValidDate(paymentDate)) return res.status(400).json({ message: 'تاريخ الصرف غير صالح' });

    const key = body.idempotency_key;
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) {
      return res.status(400).json({ message: 'معرّف العملية (idempotency_key) مطلوب' });
    }
    const method = typeof body.payment_method === 'string' ? body.payment_method.trim().slice(0, 100) : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : '';

    // A retried request (same key) must not create a second payment/expense.
    const replay = async () => {
      const existing = await prisma.charityPayment.findUnique({ where: { idempotency_key: key }, include: { expense: true } });
      if (!existing) return null;
      if (existing.season_id !== seasonId || existing.charity_month !== month || round2(existing.amount) !== amt) {
        return res.status(409).json({ message: 'معرّف العملية مستخدم لدفعة مختلفة' });
      }
      const { collections, payments } = await loadSeason(seasonId);
      return res.status(200).json({ duplicate: true, payment: paymentView(existing), summary: monthSummary(month, seasonId, collections, payments) });
    };
    const replayed = await replay();
    if (replayed) return replayed;

    const user = req.user;
    let result: { payment: PaymentWithExpense; before: { paid: number; status: string }; };
    try {
      result = await prisma.$transaction(async (tx) => {
        // Serialise concurrent payments for the same season+month so the outstanding check can't race.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${seasonId}::int, hashtext(${month}))`;

        const [sales, existing] = await Promise.all([
          tx.sale.findMany({ where: { ...seasonWhere(seasonId), order_status: STATUS_DISPATCHED } }),
          tx.charityPayment.findMany({ where: { season_id: seasonId, charity_month: month } }),
        ]);
        const total = round2(collectionsByMonth(sales).get(month)?.total ?? 0);
        const { due } = charityDue(total);
        const paidBefore = round2(existing.reduce((s, p) => s + p.amount, 0));
        const outstanding = round2(due - paidBefore);
        if (due <= 0) throw new CharityError('لا توجد صدقة مستحقة لهذا الشهر');
        if (amt > outstanding + 0.005) {
          throw new CharityError(`المبلغ أكبر من المتبقي من الصدقة (${outstanding.toLocaleString('ar-EG')} ج.م)`);
        }

        const baseStatement = `صدقة شهر ${monthLabel(month)}`;
        const expense = await tx.expenseRevenue.create({
          data: {
            season_id: seasonId, date: paymentDate, operation_type: CHARITY_OPERATION_TYPE,
            statement: method ? `${baseStatement} — ${method}` : baseStatement, amount_in: 0, amount_out: amt,
          },
        });
        const charity = await tx.charityPayment.create({
          data: {
            season_id: seasonId, charity_month: month, amount: amt, payment_date: paymentDate,
            payment_method: method, notes, expense_id: expense.id, idempotency_key: key,
            created_by: user?.username ?? '',
          },
        });
        // Put the charity payment ID on the expense so the two are traceable from either side.
        const linked = await tx.expenseRevenue.update({
          where: { id: expense.id },
          data: { statement: `${expense.statement} [دفعة صدقة #${charity.id}]` },
        });
        return {
          payment: { ...charity, expense: linked },
          before: { paid: paidBefore, status: charityStatus(due, paidBefore) },
        };
      });
    } catch (err) {
      if (err instanceof CharityError) return res.status(400).json({ message: err.message });
      // Lost an idempotency race with an identical concurrent request → treat as a replay.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const r = await replay();
        if (r) return r;
      }
      throw err;
    }

    const { collections, payments } = await loadSeason(seasonId);
    const summary = monthSummary(month, seasonId, collections, payments);

    logAudit({
      user, module: 'Charity', action: 'CREATE', record_id: result.payment.id,
      before_data: { charity_month: month, paid: result.before.paid, status: result.before.status },
      after_data: {
        charity_month: month, amount: amt, payment_date: paymentDate, payment_method: method, notes,
        expense_id: result.payment.expense_id, paid: summary.paid, remaining: summary.remaining, status: summary.status,
      },
      description: `صرف صدقة شهر ${monthLabel(month)}: ${amt} ج.م (مصروف #${result.payment.expense_id}) — الحالة: ${STATUS_LABELS[result.before.status as keyof typeof STATUS_LABELS]} ← ${summary.status_label}`,
    });
    if (result.payment.expense) {
      logAudit({
        user, module: 'Expenses', action: 'CREATE', record_id: result.payment.expense.id, after_data: result.payment.expense,
        description: `إضافة ${CHARITY_OPERATION_TYPE}: ${result.payment.expense.statement}`,
      });
    }

    return res.status(201).json({ duplicate: false, payment: paymentView(result.payment), summary });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تسجيل صرف الصدقة' });
  }
});

router.delete('/payments/:id', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'معرّف غير صالح' });

    const existing = await prisma.charityPayment.findFirst({ where: { id, season_id: seasonId }, include: { expense: true } });
    if (!existing) return res.status(404).json({ message: 'دفعة الصدقة غير موجودة' });

    // Reverse both halves of the single payment atomically.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${seasonId}::int, hashtext(${existing.charity_month}))`;
      await tx.charityPayment.delete({ where: { id } });
      if (existing.expense_id) await tx.expenseRevenue.delete({ where: { id: existing.expense_id } });
    });

    logAudit({
      user: req.user, module: 'Charity', action: 'DELETE', record_id: id, before_data: existing,
      description: `إلغاء دفعة صدقة شهر ${monthLabel(existing.charity_month)}: ${existing.amount} ج.م (حذف المصروف #${existing.expense_id})`,
    });
    if (existing.expense) {
      logAudit({
        user: req.user, module: 'Expenses', action: 'DELETE', record_id: existing.expense.id, before_data: existing.expense,
        description: `حذف ${existing.expense.operation_type}: ${existing.expense.statement}`,
      });
    }

    const { collections, payments } = await loadSeason(seasonId);
    return res.json({ message: 'تم إلغاء دفعة الصدقة', summary: monthSummary(existing.charity_month, seasonId, collections, payments) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إلغاء دفعة الصدقة' });
  }
});

class CharityError extends Error {}

export default router;
