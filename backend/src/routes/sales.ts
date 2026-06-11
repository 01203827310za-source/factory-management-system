import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';

const router = Router();
router.use(authenticate);

// ─── helpers ────────────────────────────────────────────────────────────────

type ModelSlot = { code: string; qty: number; color: string };

function extractModels(data: Record<string, unknown>): ModelSlot[] {
  return [1, 2, 3, 4, 5]
    .map(i => ({
      code: (data[`model${i}_code`] as string) || '',
      qty: Number(data[`model${i}_qty`]) || 0,
      color: (data[`model${i}_color`] as string) || '',
    }))
    .filter(m => m.code && m.qty > 0);
}

// Find the ReadyStock row that best matches (code+color), falling back to code-only
async function findStockRow(code: string, color: string) {
  if (color) {
    const exact = await prisma.readyStock.findFirst({ where: { model_code: code, color } });
    if (exact) return exact;
  }
  return prisma.readyStock.findFirst({ where: { model_code: code } });
}

// Adjust reserved_quantity on all model slots of a sale by `delta` (+qty or -qty)
async function adjustReserved(models: ModelSlot[], delta: 1 | -1) {
  for (const m of models) {
    const row = await findStockRow(m.code, m.color);
    if (!row) continue;
    const next = Math.max(0, row.reserved_quantity + delta * m.qty);
    await prisma.readyStock.update({
      where: { id: row.id },
      data: { reserved_quantity: next },
    });
  }
}

// ─── routes ─────────────────────────────────────────────────────────────────

// GET /api/sales
router.get('/', async (_req: Request, res: Response) => {
  try {
    return res.json(await prisma.sale.findMany({ orderBy: { id: 'asc' } }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب المبيعات' });
  }
});

// POST /api/sales
router.post('/', requireManager, async (req: Request, res: Response) => {
  try {
    const data = req.body as Record<string, unknown>;
    const isReservation = data.order_status === 'تم الحجز';

    const sale = await prisma.sale.create({
      data: {
        ...(data as Parameters<typeof prisma.sale.create>[0]['data']),
        remaining: (Number(data.invoice_value) || 0) - (Number(data.deposit_paid) || 0),
      },
    });

    if (isReservation) {
      await adjustReserved(extractModels(data), +1);
    }

    logAudit({ user: req.user, module: 'Sales', action: 'CREATE', record_id: sale.id,
      after_data: sale, description: `إضافة عملية بيع: ${sale.client} - ${sale.order_number}` });
    return res.status(201).json(sale);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إضافة الطلب' });
  }
});

// PUT /api/sales/:id
router.put('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const data = req.body as Record<string, unknown>;

    const oldSale = await prisma.sale.findUnique({ where: { id } });
    if (!oldSale) return res.status(404).json({ message: 'الطلب غير موجود' });

    const wasReservation = oldSale.order_status === 'تم الحجز';
    const newStatus = (data.order_status as string | undefined) ?? oldSale.order_status;
    const willBeReservation = newStatus === 'تم الحجز';

    if (data.invoice_value !== undefined || data.deposit_paid !== undefined) {
      const inv = Number(data.invoice_value ?? oldSale.invoice_value ?? 0);
      const dep = Number(data.deposit_paid ?? oldSale.deposit_paid ?? 0);
      data.remaining = inv - dep;
    }

    // Reverse old reservation quantities before saving
    if (wasReservation) {
      await adjustReserved(extractModels(oldSale as unknown as Record<string, unknown>), -1);
    }

    const sale = await prisma.sale.update({ where: { id }, data });

    // Apply new reservation quantities after saving
    if (willBeReservation) {
      await adjustReserved(extractModels(data), +1);
    }

    logAudit({ user: req.user, module: 'Sales', action: 'UPDATE', record_id: id,
      before_data: oldSale, after_data: sale, description: `تعديل عملية بيع: ${sale.client} - ${sale.order_number}` });
    return res.json(sale);
  } catch {
    return res.status(500).json({ message: 'خطأ في تحديث الطلب' });
  }
});

// DELETE /api/sales/:id
router.delete('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    // If deleting a reservation, release reserved stock first
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (sale?.order_status === 'تم الحجز') {
      await adjustReserved(extractModels(sale as unknown as Record<string, unknown>), -1);
    }
    await prisma.sale.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Sales', action: 'DELETE', record_id: id,
      before_data: sale, description: `حذف عملية بيع: ${sale?.client} - ${sale?.order_number}` });
    return res.json({ message: 'تم حذف الطلب' });
  } catch {
    return res.status(500).json({ message: 'خطأ في حذف الطلب' });
  }
});

// POST /api/sales/:id/convert-reservation — تم الحجز → تم الصرف
router.post('/:id/convert-reservation', requireManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (sale.order_status !== 'تم الحجز') {
      return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
    }

    // Release reserved qty; actual_balance automatically drops once status → 'تم الصرف'
    await adjustReserved(extractModels(sale as unknown as Record<string, unknown>), -1);

    const updated = await prisma.sale.update({
      where: { id },
      data: { order_status: 'تم الصرف' },
    });
    logAudit({ user: req.user, module: 'Sales', action: 'UPDATE', record_id: id,
      before_data: sale, after_data: updated, description: `تحويل حجز إلى صرف: ${sale.client} - ${sale.order_number}` });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تحويل الحجز' });
  }
});

// POST /api/sales/:id/cancel-reservation — تم الحجز → تم الإلغاء
router.post('/:id/cancel-reservation', requireManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (sale.order_status !== 'تم الحجز') {
      return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
    }

    // Release reserved qty; actual_balance is unchanged (cancelled sales excluded from totalSales)
    await adjustReserved(extractModels(sale as unknown as Record<string, unknown>), -1);

    const updated = await prisma.sale.update({
      where: { id },
      data: { order_status: 'تم الإلغاء' },
    });
    logAudit({ user: req.user, module: 'Sales', action: 'UPDATE', record_id: id,
      before_data: sale, after_data: updated, description: `إلغاء حجز: ${sale.client} - ${sale.order_number}` });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إلغاء الحجز' });
  }
});

export default router;
