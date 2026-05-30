import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /api/sales
router.get('/', async (_req: Request, res: Response) => {
  try {
    const sales = await prisma.sale.findMany({ orderBy: { id: 'asc' } });
    return res.json(sales);
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب المبيعات' });
  }
});

// POST /api/sales
router.post('/', requireManager, async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const sale = await prisma.sale.create({
      data: {
        ...data,
        remaining: (data.invoice_value || 0) - (data.deposit_paid || 0),
      },
    });
    return res.status(201).json(sale);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إضافة الطلب' });
  }
});

// PUT /api/sales/:id
router.put('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    if (data.invoice_value !== undefined || data.deposit_paid !== undefined) {
      const current = await prisma.sale.findUnique({ where: { id } });
      const inv = data.invoice_value ?? current?.invoice_value ?? 0;
      const dep = data.deposit_paid ?? current?.deposit_paid ?? 0;
      data.remaining = inv - dep;
    }
    const sale = await prisma.sale.update({ where: { id }, data });
    return res.json(sale);
  } catch {
    return res.status(500).json({ message: 'خطأ في تحديث الطلب' });
  }
});

// DELETE /api/sales/:id
router.delete('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    await prisma.sale.delete({ where: { id: parseInt(req.params.id) } });
    return res.json({ message: 'تم حذف الطلب' });
  } catch {
    return res.status(500).json({ message: 'خطأ في حذف الطلب' });
  }
});

export default router;
