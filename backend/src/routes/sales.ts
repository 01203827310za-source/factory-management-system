import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';

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

// Validate that each model slot has enough available stock.
// available = actual_balance - reserved_quantity
// actual_balance = opening + production - non_reservation_sales + returns
async function validateAvailability(models: ModelSlot[]): Promise<string[]> {
  const uniqueCodes = [...new Set(models.map(m => m.code))];

  const [stockRows, modelProds, allSales, allReturns] = await Promise.all([
    prisma.readyStock.findMany({ where: { model_code: { in: uniqueCodes } } }),
    prisma.modelProduction.findMany({ where: { model_code: { in: uniqueCodes } } }),
    prisma.sale.findMany({
      where: { NOT: { order_status: { in: ['تم الحجز', 'تم الإلغاء'] } } },
    }),
    prisma.returnItem.findMany({ where: { model_code: { in: uniqueCodes } } }),
  ]);

  // Pre-aggregate by model_code (mirrors the ReadyStock computation)
  const newProd: Record<string, number> = {};
  modelProds.forEach(mp => { newProd[mp.model_code] = (newProd[mp.model_code] || 0) + mp.qty_received; });

  const totalSold: Record<string, number> = {};
  allSales.forEach(s => {
    [
      { code: s.model1_code, qty: s.model1_qty },
      { code: s.model2_code, qty: s.model2_qty },
      { code: s.model3_code, qty: s.model3_qty },
      { code: s.model4_code, qty: s.model4_qty },
      { code: s.model5_code, qty: s.model5_qty },
    ].forEach(({ code, qty }) => {
      if (code && qty > 0) totalSold[code] = (totalSold[code] || 0) + qty;
    });
  });

  const totalReturns: Record<string, number> = {};
  allReturns.forEach(r => { if (r.model_code) totalReturns[r.model_code] = (totalReturns[r.model_code] || 0) + r.model_qty; });

  const errors: string[] = [];

  for (const m of models) {
    // Prefer exact (code+color) match, fall back to code-only
    const row =
      stockRows.find(s => s.model_code === m.code && s.color === m.color) ||
      stockRows.find(s => s.model_code === m.code);

    if (!row) continue; // No stock entry at all — skip validation

    const actualBalance =
      row.opening_balance +
      (newProd[m.code] || 0) -
      (totalSold[m.code] || 0) +
      (totalReturns[m.code] || 0);

    const available = Math.max(0, actualBalance - row.reserved_quantity);

    if (m.qty > available) {
      errors.push(
        `الموديل ${m.code}${m.color ? ` (${m.color})` : ''}: المتاح ${available} — المطلوب ${m.qty}`
      );
    }
  }

  return errors;
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

    if (isReservation) {
      const models = extractModels(data);
      const errors = await validateAvailability(models);
      if (errors.length > 0) {
        return res.status(400).json({
          message: 'الكمية المطلوبة تتجاوز المتاح في المخزون',
          details: errors,
        });
      }
    }

    const sale = await prisma.sale.create({
      data: {
        ...(data as Parameters<typeof prisma.sale.create>[0]['data']),
        remaining: (Number(data.invoice_value) || 0) - (Number(data.deposit_paid) || 0),
      },
    });

    if (isReservation) {
      await adjustReserved(extractModels(data), +1);
    }

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

    if (data.invoice_value !== undefined || data.deposit_paid !== undefined) {
      const current = await prisma.sale.findUnique({ where: { id } });
      const inv = Number(data.invoice_value ?? current?.invoice_value ?? 0);
      const dep = Number(data.deposit_paid ?? current?.deposit_paid ?? 0);
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
    const id = parseInt(req.params.id as string);
    // If deleting a reservation, release reserved stock first
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (sale?.order_status === 'تم الحجز') {
      await adjustReserved(extractModels(sale as unknown as Record<string, unknown>), -1);
    }
    await prisma.sale.delete({ where: { id } });
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
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إلغاء الحجز' });
  }
});

export default router;
