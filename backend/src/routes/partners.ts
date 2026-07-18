import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Compute per-partner net balances using the same formula as dashboard.ts
async function computePartnerBalances(): Promise<Record<string, number>> {
  const [expenses, sales, returns_, paymentLogs] = await Promise.all([
    prisma.expenseRevenue.findMany(),
    prisma.sale.findMany(),
    prisma.returnItem.findMany(),
    prisma.paymentLog.findMany(),
  ]);

  const hatemDepositIn  = sales.filter(s => s.deposit_receiver === 'حاتم').reduce((s, x) => s + x.deposit_paid, 0);
  const midoDepositIn   = sales.filter(s => s.deposit_receiver === 'ميدو').reduce((s, x) => s + x.deposit_paid, 0);
  const hatemRemainingIn = sales.filter(s => s.order_status === 'تم الصرف').reduce((s, x) => s + x.remaining, 0);

  const hatemPaymentIn  = paymentLogs.filter(p => p.receiver === 'حاتم' && p.type === 'client_payment').reduce((s, p) => s + p.amount, 0);
  const midoPaymentIn   = paymentLogs.filter(p => p.receiver === 'ميدو' && p.type === 'client_payment').reduce((s, p) => s + p.amount, 0);
  const hatemDebtOut    = paymentLogs.filter(p => p.type === 'debt_payment' && p.receiver === 'حاتم').reduce((s, p) => s + p.amount, 0);
  const midoDebtOut     = paymentLogs.filter(p => p.type === 'debt_payment' && p.receiver === 'ميدو').reduce((s, p) => s + p.amount, 0);

  const hatemReturnOut  = returns_.filter(r => r.paid_by === 'حاتم').reduce((s, r) => s + r.refund_amount, 0);
  const midoReturnOut   = returns_.filter(r => r.paid_by === 'ميدو').reduce((s, r) => s + r.refund_amount, 0);

  const hatemIn  = expenses.reduce((s, e) => s + e.hatem_in, 0) + hatemDepositIn + hatemRemainingIn + hatemPaymentIn;
  const hatemOut = expenses.reduce((s, e) => s + e.hatem_out, 0) + hatemDebtOut + hatemReturnOut;
  const midoIn   = expenses.reduce((s, e) => s + e.mido_in, 0) + midoDepositIn + midoPaymentIn;
  const midoOut  = expenses.reduce((s, e) => s + e.mido_out, 0) + midoDebtOut + midoReturnOut;

  return {
    'حاتم': hatemIn - hatemOut,
    'ميدو': midoIn - midoOut,
  };
}

// GET /api/partners — all partners with computed net_balance
router.get('/', async (_req: Request, res: Response) => {
  try {
    const [partners, balances] = await Promise.all([
      prisma.partner.findMany({ orderBy: { id: 'asc' } }),
      computePartnerBalances(),
    ]);
    const result = partners.map(p => ({ ...p, net_balance: balances[p.name] ?? 0 }));
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في جلب الشركاء' });
  }
});

// GET /api/partners/active — active partners only
router.get('/active', async (_req: Request, res: Response) => {
  try {
    const partners = await prisma.partner.findMany({ where: { is_active: true }, orderBy: { id: 'asc' } });
    return res.json(partners);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في جلب الشركاء النشطين' });
  }
});

// POST /api/partners/:id/deactivate
router.post('/:id/deactivate', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'معرف غير صالح' });
  try {
    const existing = await prisma.partner.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'الشريك غير موجود' });

    // Prevent deactivating the last active partner
    const activeCount = await prisma.partner.count({ where: { is_active: true } });
    if (activeCount <= 1) {
      return res.status(400).json({ message: 'لا يمكن إلغاء تفعيل الشريك الوحيد النشط' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const updated = await prisma.partner.update({
      where: { id },
      data: { is_active: false, exit_date: today },
    });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إلغاء تفعيل الشريك' });
  }
});

// POST /api/partners/:id/reactivate
router.post('/:id/reactivate', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'معرف غير صالح' });
  try {
    const existing = await prisma.partner.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'الشريك غير موجود' });

    const updated = await prisma.partner.update({
      where: { id },
      data: { is_active: true, exit_date: null },
    });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إعادة تفعيل الشريك' });
  }
});

export default router;
