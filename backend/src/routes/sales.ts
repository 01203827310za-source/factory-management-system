import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';
import { getSeasonId, seasonWhere } from '../services/seasonContext';

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

// Prisma client or interactive-transaction client — helpers below accept either
// so they can participate in an atomic transaction when needed.
type Db = typeof prisma | Prisma.TransactionClient;

// Find the ReadyStock row that best matches (code+color), falling back to code-only
async function findStockRow(code: string, color: string, seasonId: number, db: Db = prisma) {
  if (color) {
    const exact = await db.readyStock.findFirst({ where: { ...seasonWhere(seasonId), model_code: code, color } });
    if (exact) return exact;
  }
  return db.readyStock.findFirst({ where: { ...seasonWhere(seasonId), model_code: code } });
}

// Adjust reserved_quantity on all model slots of a sale by `delta` (+qty or -qty)
async function adjustReserved(models: ModelSlot[], delta: 1 | -1, seasonId: number, db: Db = prisma) {
  for (const m of models) {
    const row = await findStockRow(m.code, m.color, seasonId, db);
    if (!row) continue;
    const next = Math.max(0, row.reserved_quantity + delta * m.qty);
    await db.readyStock.update({
      where: { id: row.id },
      data: { reserved_quantity: next },
    });
  }
}

// Validate a shipping-payout "received amount" against the real remaining balance.
function parseReceivedAmount(raw: unknown, remaining: number): { value: number } | { error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'المبلغ المستلم من شركة الشحن مطلوب' };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { error: 'المبلغ المستلم غير صالح' };
  }
  if (value < 0) {
    return { error: 'المبلغ المستلم لا يمكن أن يكون أقل من صفر' };
  }
  // Guard against floating point noise (e.g. remaining=5000, received=5000.0000000001)
  if (value > remaining + 0.005) {
    return { error: 'المبلغ المستلم لا يمكن أن يكون أكبر من المبلغ المتبقي' };
  }
  return { value: Math.min(value, remaining) };
}

// Resolves what "shipping_collected" must be saved as for a given (about-to-be-saved)
// order_status, folding in the "تم الصرف" business rule everywhere a sale is written:
//   - status !== 'تم الصرف'  → always 0. The order isn't dispatched (or was un-dispatched),
//     so no shipping-company receipt can be an active cash transaction (point: "do not
//     leave the previous received amount as an active cash transaction").
//   - status === 'تم الصرف' → the caller-supplied amount, validated against the real
//     remaining balance server-side (never trusted blindly). If the caller didn't resend
//     it (e.g. an edit that only touches other fields on an already-dispatched order),
//     the previously saved amount carries over — re-validated against the current
//     remaining balance so it can never end up saved above it.
function resolveShippingCollected(
  status: string,
  providedRaw: unknown,
  remaining: number,
  wasDispatched: boolean,
  previouslyReceived: number,
): { value: number; isCorrection: boolean } | { error: string } {
  if (status !== 'تم الصرف') {
    return { value: 0, isCorrection: false };
  }
  const candidate = providedRaw !== undefined ? providedRaw : (wasDispatched ? previouslyReceived : undefined);
  const parsed = parseReceivedAmount(candidate, Math.max(remaining, 0));
  if ('error' in parsed) return parsed;
  return { value: parsed.value, isCorrection: wasDispatched };
}

// ─── routes ─────────────────────────────────────────────────────────────────

// GET /api/sales
router.get('/', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    return res.json(await prisma.sale.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب المبيعات' });
  }
});

// POST /api/sales
router.post('/', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const data = req.body as Record<string, unknown>;
    const status = (data.order_status as string) || '';
    const isReservation = status === 'تم الحجز';
    const remaining = (Number(data.invoice_value) || 0) - (Number(data.deposit_paid) || 0);

    // A brand-new order can be entered directly as "تم الصرف" (e.g. a counter sale) —
    // the same received-amount rule applies: only the amount actually confirmed as
    // received from the shipping company is ever recorded, never the full remaining
    // balance, and it's re-validated here regardless of what the frontend sent.
    const resolved = resolveShippingCollected(status, data.shipping_collected, remaining, false, 0);
    if ('error' in resolved) {
      return res.status(400).json({ message: resolved.error });
    }

    const { season: _season, id: _id, season_id: _seasonId, ...saleData } = data as Omit<Prisma.SaleUncheckedCreateInput, 'season_id' | 'remaining'> & Record<string, unknown>;

    const sale = await prisma.sale.create({
      data: {
        ...saleData,
        season_id: seasonId,
        remaining,
        shipping_collected: resolved.value,
      },
    });

    if (isReservation) {
      await adjustReserved(extractModels(data), +1, seasonId);
    }

    const isDispatched = status === 'تم الصرف';
    const collection_difference = isDispatched ? Math.max(0, remaining - resolved.value) : 0;
    logAudit({
      user: req.user, module: 'Sales', action: isDispatched ? 'SHIPPING_PAYOUT_CONFIRMED' : 'CREATE', record_id: sale.id,
      after_data: isDispatched ? { ...sale, collection_difference } : sale,
      description: isDispatched
        ? `إضافة عملية بيع (تم الصرف مباشرة): ${sale.client} - ${sale.order_number} — المتبقي: ${remaining} — المستلم فعليًا: ${resolved.value} — الفرق غير المحصل: ${collection_difference}`
        : `إضافة عملية بيع: ${sale.client} - ${sale.order_number}`,
    });
    return res.status(201).json({ ...sale, collection_difference });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إضافة الطلب' });
  }
});

// PUT /api/sales/:id
router.put('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const data = req.body as Record<string, unknown>;

    const oldSale = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!oldSale) return res.status(404).json({ message: 'الطلب غير موجود' });

    const wasReservation = oldSale.order_status === 'تم الحجز';
    const newStatus = (data.order_status as string | undefined) ?? oldSale.order_status;
    const willBeReservation = newStatus === 'تم الحجز';

    const inv = Number(data.invoice_value ?? oldSale.invoice_value ?? 0);
    const dep = Number(data.deposit_paid ?? oldSale.deposit_paid ?? 0);
    const remaining = inv - dep;
    if (data.invoice_value !== undefined || data.deposit_paid !== undefined) {
      data.remaining = remaining;
    }

    // The "تم الصرف" rule, enforced on every write, not just a dedicated endpoint:
    // only the amount actually confirmed as received from the shipping company is ever
    // saved as shipping_collected (re-validated against the real remaining balance —
    // never trusted blindly), and it is reset to 0 the moment the order is anything
    // other than "تم الصرف" (no stale received amount is left as an active cash
    // transaction once an order is un-dispatched).
    const wasDispatched = oldSale.order_status === 'تم الصرف';
    const willBeDispatched = newStatus === 'تم الصرف';
    const resolved = resolveShippingCollected(newStatus, data.shipping_collected, remaining, wasDispatched, oldSale.shipping_collected);
    if ('error' in resolved) {
      return res.status(400).json({ message: resolved.error });
    }
    data.shipping_collected = resolved.value;

    const sale = await prisma.$transaction(async (tx) => {
      // Reverse old reservation quantities before saving
      if (wasReservation) {
        await adjustReserved(extractModels(oldSale as unknown as Record<string, unknown>), -1, seasonId, tx);
      }

      const updated = await tx.sale.update({ where: { id }, data: { ...data, season_id: seasonId } });

      // Apply new reservation quantities after saving
      if (willBeReservation) {
        await adjustReserved(extractModels(data), +1, seasonId, tx);
      }

      return updated;
    });

    const collection_difference = willBeDispatched ? Math.max(0, remaining - resolved.value) : 0;
    const action = willBeDispatched
      ? (resolved.isCorrection ? 'SHIPPING_PAYOUT_CORRECTED' : 'SHIPPING_PAYOUT_CONFIRMED')
      : (wasDispatched ? 'SHIPPING_PAYOUT_REVERSED' : 'UPDATE');
    const description = willBeDispatched
      ? `تعديل عملية بيع (تم الصرف): ${sale.client} - ${sale.order_number} — المتبقي: ${remaining} — المستلم فعليًا: ${resolved.value} — الفرق غير المحصل: ${collection_difference}`
      : (wasDispatched
        ? `تعديل عملية بيع — إلغاء حالة الصرف وعكس المبلغ المستلم سابقًا (${oldSale.shipping_collected}): ${sale.client} - ${sale.order_number}`
        : `تعديل عملية بيع: ${sale.client} - ${sale.order_number}`);

    logAudit({ user: req.user, module: 'Sales', action, record_id: id,
      before_data: oldSale, after_data: { ...sale, collection_difference }, description });
    return res.json({ ...sale, collection_difference });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تحديث الطلب' });
  }
});

// DELETE /api/sales/:id
router.delete('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    // If deleting a reservation, release reserved stock first
    const sale = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (sale?.order_status === 'تم الحجز') {
      await adjustReserved(extractModels(sale as unknown as Record<string, unknown>), -1, seasonId);
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
//
// The frontend now drives this transition through the regular Edit Order modal (status
// dropdown + PUT /api/sales/:id), which shows/validates the received-amount field inline.
// This endpoint is kept for any other caller, but applies the exact same "تم الصرف" rule:
// received_amount is required, validated against the real remaining balance, and only
// that amount — never the full remaining balance — is recorded as collected.
router.post('/:id/convert-reservation', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (sale.order_status !== 'تم الحجز') {
      return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
    }

    const resolved = resolveShippingCollected('تم الصرف', (req.body as Record<string, unknown>)?.received_amount, sale.remaining, false, 0);
    if ('error' in resolved) {
      return res.status(400).json({ message: resolved.error });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Release reserved qty; actual_balance automatically drops once status → 'تم الصرف'
      await adjustReserved(extractModels(sale as unknown as Record<string, unknown>), -1, seasonId, tx);
      return tx.sale.update({
        where: { id },
        data: { order_status: 'تم الصرف', shipping_collected: resolved.value },
      });
    });

    const collection_difference = Math.max(0, sale.remaining - resolved.value);
    logAudit({ user: req.user, module: 'Sales', action: 'SHIPPING_PAYOUT_CONFIRMED', record_id: id,
      before_data: sale, after_data: { ...updated, collection_difference },
      description: `تحويل حجز إلى صرف: ${sale.client} - ${sale.order_number} — المتبقي: ${sale.remaining} — المستلم فعليًا: ${resolved.value} — الفرق غير المحصل: ${collection_difference}` });
    return res.json({ ...updated, collection_difference });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تحويل الحجز' });
  }
});

// POST /api/sales/:id/cancel-reservation — تم الحجز → تم الإلغاء
router.post('/:id/cancel-reservation', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (sale.order_status !== 'تم الحجز') {
      return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
    }

    // Release reserved qty; actual_balance is unchanged (cancelled sales excluded from totalSales)
    await adjustReserved(extractModels(sale as unknown as Record<string, unknown>), -1, seasonId);

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
