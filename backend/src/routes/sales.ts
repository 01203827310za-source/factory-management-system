import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';
import { getSeasonId, seasonWhere } from '../services/seasonContext';
import { cairoToday, isValidDate } from '../services/charity';
import {
  STATUS_CANCELED, STATUS_RESERVED, isStockDeducting, reservedSyncUpdates, validateReservation,
} from '../services/readyStockPositions';
import { ledgerTotal } from '../services/shippingCollections';
import { collectionDate, loadStockContext, syncCollections, syncShipMovements } from '../services/orderLedgers';

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

type Tx = Prisma.TransactionClient;

// Raised inside a transaction to roll everything back and answer 400 with an Arabic message.
class StockError extends Error {}

// Serialises every write that can change stock availability or reservations within a season,
// so two orders can never reserve (or ship) the same units at the same time.
async function lockStock(tx: Tx, seasonId: number) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${seasonId}::int, hashtext('ready_stock'))`;
}

// Brings ready_stock.reserved_quantity in line with the reservation ORDERS for the stock rows
// the given slots map to. Recomputing (instead of +/- deltas) means a reservation is applied or
// released exactly once however many times it is edited, cancelled or retried.
async function syncReserved(tx: Tx, seasonId: number, slots: ModelSlot[]) {
  const ctx = await loadStockContext(tx, seasonId);
  const keys = new Set(slots.map(m => ctx.keyOf(m.code, m.color)));
  const updates = reservedSyncUpdates(ctx, keys);
  for (const u of updates) {
    await tx.readyStock.update({ where: { id: u.id }, data: { reserved_quantity: u.to } });
  }
}

const slotSignature = (slots: ModelSlot[]) =>
  slots.map(m => `${m.code}|${m.color}|${m.qty}`).sort().join(';');

const describeSlots = (slots: ModelSlot[]) =>
  slots.map(m => `${m.code}${m.color ? `/${m.color}` : ''}×${m.qty}`).join('، ');

// Inventory movement trail (the system has no movement table; the audit log is its ledger).
function logStockMovement(
  user: Request['user'], action: 'STOCK_RESERVED' | 'STOCK_RELEASED' | 'STOCK_SHIPPED',
  sale: { id: number; client: string; order_number: string }, slots: ModelSlot[], note: string,
) {
  if (slots.length === 0) return;
  logAudit({
    user, module: 'ReadyStock', action, record_id: sale.id,
    after_data: { order_number: sale.order_number, slots },
    description: `${note}: ${sale.client} - ${sale.order_number} — ${describeSlots(slots)}`,
  });
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

// Day the shipping company's payout belongs to (drives the monthly-charity month).
//   - not 'تم الصرف'            → null (no active receipt)
//   - caller sent a valid date   → that date (lets a payout be dated to when it was really received)
//   - already dispatched         → keep the stored date (a pure amount correction must not move
//                                  the money to another month); legacy NULL stays NULL
//   - newly dispatched           → today (Cairo)
function resolvePayoutDate(status: string, providedRaw: unknown, wasDispatched: boolean, previous: string | null): { value: string | null } | { error: string } {
  if (status !== 'تم الصرف') return { value: null };
  if (providedRaw !== undefined && providedRaw !== null && providedRaw !== '') {
    if (!isValidDate(providedRaw)) return { error: 'تاريخ استلام المبلغ من شركة الشحن غير صالح' };
    return { value: providedRaw };
  }
  if (wasDispatched) return { value: previous ?? null };
  return { value: cairoToday() };
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

    const payoutDate = resolvePayoutDate(status, data.shipping_collected_date, false, null);
    if ('error' in payoutDate) return res.status(400).json({ message: payoutDate.error });

    const { season: _season, id: _id, season_id: _seasonId, ...saleData } = data as Omit<Prisma.SaleUncheckedCreateInput, 'season_id' | 'remaining'> & Record<string, unknown>;

    const newSlots = extractModels(data);
    const explicitDate = data.shipping_collected_date;
    const sale = await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);
      if (isReservation) {
        // Reserving requires the goods to physically exist and be unallocated (model + colour).
        const problem = validateReservation(await loadStockContext(tx, seasonId), newSlots);
        if (problem) throw new StockError(problem);
      }
      const created = await tx.sale.create({
        data: {
          ...saleData,
          season_id: seasonId,
          remaining,
          shipping_collected: resolved.value,
          shipping_collected_date: payoutDate.value,
        },
      });
      if (isReservation) await syncReserved(tx, seasonId, newSlots);
      await syncCollections(tx, created, { previousCached: 0, desired: resolved.value, date: collectionDate(explicitDate, null), user: req.user?.username });
      await syncShipMovements(tx, created, newSlots, req.user?.username);
      return created;
    });

    if (isReservation) logStockMovement(req.user, 'STOCK_RESERVED', sale, newSlots, 'حجز مخزون');
    else if (isStockDeducting(status)) logStockMovement(req.user, 'STOCK_SHIPPED', sale, newSlots, 'خروج مخزون (شحن)');

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
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
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
    const explicitCollectionDate = data.shipping_collected_date;
    const payoutDate = resolvePayoutDate(newStatus, data.shipping_collected_date, wasDispatched, oldSale.shipping_collected_date);
    if ('error' in payoutDate) return res.status(400).json({ message: payoutDate.error });
    data.shipping_collected_date = payoutDate.value;

    // Goods that already left the factory are never restored by a cancellation — they come
    // back only through the returns workflow, once physically received.
    if (newStatus === STATUS_CANCELED && isStockDeducting(oldSale.order_status)) {
      return res.status(400).json({ message: 'لا يمكن إلغاء أوردر تم شحنه — استخدم المرتجعات لإرجاع البضاعة للمخزن بعد استلامها فعليًا' });
    }

    const oldSlots = extractModels(oldSale as unknown as Record<string, unknown>);
    const newSlots = extractModels({ ...oldSale, ...data } as unknown as Record<string, unknown>);
    const slotsChanged = slotSignature(oldSlots) !== slotSignature(newSlots);

    const sale = await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);

      // Re-read under the lock so a concurrent edit/cancel can't be applied twice.
      const current = await tx.sale.findFirst({ where: { id, season_id: seasonId } });
      if (!current || current.order_status !== oldSale.order_status || current.shipping_collected !== oldSale.shipping_collected) {
        throw new StockError('تم تعديل هذا الأوردر من مستخدم آخر — أعد تحميل الصفحة وحاول مرة أخرى');
      }

      // Validate the NEW reservation against stock minus every OTHER order's reservation
      // (this order's own old reservation is excluded, i.e. released first).
      if (willBeReservation && (!wasReservation || slotsChanged)) {
        const problem = validateReservation(await loadStockContext(tx, seasonId, id), newSlots);
        if (problem) throw new StockError(problem);
      }

      const updated = await tx.sale.update({ where: { id }, data: { ...data, season_id: seasonId } });
      await syncReserved(tx, seasonId, [...oldSlots, ...newSlots]);
      // Cash side: append only the change in what the shipping company actually paid.
      await syncCollections(tx, updated, {
        previousCached: current.shipping_collected, desired: resolved.value,
        date: collectionDate(explicitCollectionDate, oldSale.shipping_collected_date), user: req.user?.username,
      });
      // Inventory-cost side: append only the change in what physically left the factory.
      await syncShipMovements(tx, updated, extractModels(updated as unknown as Record<string, unknown>), req.user?.username);
      return updated;
    });

    if (willBeReservation && (!wasReservation || slotsChanged)) {
      logStockMovement(req.user, 'STOCK_RESERVED', sale, newSlots, wasReservation ? 'تعديل حجز مخزون' : 'حجز مخزون');
    } else if (wasReservation && !willBeReservation) {
      logStockMovement(req.user, newStatus === STATUS_CANCELED ? 'STOCK_RELEASED' : 'STOCK_SHIPPED', sale, oldSlots,
        newStatus === STATUS_CANCELED ? 'فك حجز مخزون (إلغاء)' : 'خروج مخزون (شحن)');
    }

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
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تحديث الطلب' });
  }
});

// GET /api/sales/:id/ledger — collection history + inventory-cost movements of one order
router.get('/:id/ledger', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findFirst({ where: { id, season_id: seasonId }, select: { id: true } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    const [collections, movements] = await Promise.all([
      prisma.shippingCollection.findMany({ where: { sale_id: id }, orderBy: { id: 'asc' } }),
      prisma.inventoryMovement.findMany({ where: { sale_id: id }, orderBy: { id: 'asc' } }),
    ]);
    return res.json({ collections, collected_total: ledgerTotal(collections), movements });
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب سجل الأوردر' });
  }
});

// DELETE /api/sales/:id
router.delete('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    // Deleting a reservation releases its reserved units, atomically with the delete.
    await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);
      await tx.sale.delete({ where: { id } });
      if (sale.order_status === STATUS_RESERVED) await syncReserved(tx, seasonId, extractModels(sale as unknown as Record<string, unknown>));
    });
    logAudit({ user: req.user, module: 'Sales', action: 'DELETE', record_id: id,
      before_data: sale, description: `حذف عملية بيع: ${sale?.client} - ${sale?.order_number}` });
    return res.json({ message: 'تم حذف الطلب' });
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
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

    const slots = extractModels(sale as unknown as Record<string, unknown>);
    const updated = await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);
      const current = await tx.sale.findFirst({ where: { id, season_id: seasonId } });
      if (!current || current.order_status !== STATUS_RESERVED) throw new StockError('هذا الطلب ليس حجزاً');
      // Physical stock drops once status leaves the reservation state; the reservation is released with it.
      const upd = await tx.sale.update({
        where: { id },
        data: { order_status: 'تم الصرف', shipping_collected: resolved.value, shipping_collected_date: cairoToday() },
      });
      await syncReserved(tx, seasonId, slots);
      await syncCollections(tx, upd, { previousCached: current.shipping_collected, desired: resolved.value, date: cairoToday(), user: req.user?.username });
      await syncShipMovements(tx, upd, slots, req.user?.username);
      return upd;
    });
    logStockMovement(req.user, 'STOCK_SHIPPED', sale, slots, 'خروج مخزون (شحن)');

    const collection_difference = Math.max(0, sale.remaining - resolved.value);
    logAudit({ user: req.user, module: 'Sales', action: 'SHIPPING_PAYOUT_CONFIRMED', record_id: id,
      before_data: sale, after_data: { ...updated, collection_difference },
      description: `تحويل حجز إلى صرف: ${sale.client} - ${sale.order_number} — المتبقي: ${sale.remaining} — المستلم فعليًا: ${resolved.value} — الفرق غير المحصل: ${collection_difference}` });
    return res.json({ ...updated, collection_difference });
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
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

    // Release the reservation; physical stock is unchanged (the goods never left).
    const slots = extractModels(sale as unknown as Record<string, unknown>);
    const updated = await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);
      const current = await tx.sale.findFirst({ where: { id, season_id: seasonId } });
      if (!current || current.order_status !== STATUS_RESERVED) throw new StockError('هذا الطلب ليس حجزاً');
      const upd = await tx.sale.update({ where: { id }, data: { order_status: STATUS_CANCELED } });
      await syncReserved(tx, seasonId, slots);
      return upd;
    });
    logStockMovement(req.user, 'STOCK_RELEASED', sale, slots, 'فك حجز مخزون (إلغاء)');
    logAudit({ user: req.user, module: 'Sales', action: 'UPDATE', record_id: id,
      before_data: sale, after_data: updated, description: `إلغاء حجز: ${sale.client} - ${sale.order_number}` });
    return res.json(updated);
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إلغاء الحجز' });
  }
});

export default router;
