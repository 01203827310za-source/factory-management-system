// ============================================
// Ready Stock page: reservation view / reconciliation and production entries, WITHOUT a second inventory system.
//   GET /api/ready-stock/:id/reservations        which orders hold this model + colour (reserved is DERIVED from orders)
//   PUT /api/ready-stock/:id/reconcile-reservations   re-run the existing reservation reconciliation, audited
//   GET /api/ready-stock/:id/production          the production entries of this model + colour
//   POST /api/ready-stock/:id/production         record a NEW production entry (same rules as /api/model-prod, idempotent per key)
//   PUT /api/ready-stock/:id/production/:prodId  CORRECT the received quantity of an existing entry (never a stock overwrite)
//
// Reserved quantity is never typed in: it is derived first-come-first-served from the «يتم التجهيز» orders, so changing it means
// changing the order. Physical stock is never typed in either: it is opening balance + production received − shipped + returns,
// so production is recorded as a production entry (and corrected as one). Permissions: the route-level rule (ready_stock.create /
// .edit) plus model_prod.create / .edit for production, because it writes production records.
// ============================================

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';
import { getSeasonId, seasonWhere } from '../services/seasonContext';
import { resyncReservations } from '../services/reservationSync';
import { computeStockPositions, effectiveSales, outsideSlots } from '../services/readyStockPositions';
import { textsMatch } from '../utils/textMatch';
import { cairoToday } from '../services/charity';
import { validateProductionParts } from './entities';

const router = Router();
router.use(authenticate);

const has = (req: Request, key: string) => !!req.user?.permissions?.includes(key);
const forbid = (res: Response, key: string) => res.status(403).json({ message: `ليس لديك صلاحية (${key})` });

async function loadRow(req: Request) {
  const seasonId = await getSeasonId(req);
  const id = parseInt(req.params.id as string);
  const row = await prisma.readyStock.findFirst({ where: { id, season_id: seasonId } });
  return { seasonId, id, row };
}

async function stockState(seasonId: number, overrides?: { prodId: number; qty_received: number }) {
  const [readyStock, modelProds, sales, returns_] = await Promise.all([
    prisma.readyStock.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }),
    prisma.modelProduction.findMany({ where: seasonWhere(seasonId) }),
    prisma.sale.findMany({ where: seasonWhere(seasonId) }),
    prisma.returnItem.findMany({ where: seasonWhere(seasonId) }),
  ]);
  const prods = overrides ? modelProds.map(m => (m.id === overrides.prodId ? { ...m, qty_received: overrides.qty_received } : m)) : modelProds;
  const ctx = computeStockPositions({ readyStock, modelProds: prods, sales, returns_ });
  return { ctx, readyStock, modelProds, sales };
}

const sameStockItem = (a: { model_code: string; color: string }, b: { model_code: string; color: string }) =>
  a.model_code.trim().toLowerCase() === b.model_code.trim().toLowerCase() && textsMatch(a.color || '', b.color || '', 'color');

// ───────── reservations ─────────
router.get('/:id/reservations', async (req: Request, res: Response) => {
  try {
    const { seasonId, row } = await loadRow(req);
    if (!row) return res.status(404).json({ message: 'الصنف غير موجود' });
    const { ctx, readyStock, sales } = await stockState(seasonId);
    const idx = readyStock.findIndex(r => r.id === row.id);
    const pos = ctx.positions[idx];
    const saleById = new Map(sales.map(s => [s.id, s]));
    const orders = [...ctx.allocations.values()].flatMap(a => a.slots
      .filter(sl => ctx.keyOf(sl.code, sl.color) === pos.key)
      .map(sl => {
        const s = saleById.get(a.sale_id);
        return { sale_id: a.sale_id, order_number: s?.order_number ?? '', client: s?.client ?? '', status: s?.order_status ?? '', requested: sl.requested, reserved: sl.reserved, pending: sl.pending };
      }));
    return res.json({
      stock_id: row.id, model_code: row.model_code, color: row.color,
      actual: pos.actual, reserved: pos.reserved, available: pos.actual - pos.reserved, pending: pos.pending,
      stored_reserved: row.reserved_quantity,                       // the cached column; differs from `reserved` only if a reconciliation is due
      orders,
    });
  } catch (err) { console.error(err); return res.status(500).json({ message: 'خطأ في جلب الحجوزات' }); }
});

router.put('/:id/reconcile-reservations', requireManager, async (req: Request, res: Response) => {
  try {
    if (!has(req, 'ready_stock.edit')) return forbid(res, 'ready_stock.edit');
    const { seasonId, row } = await loadRow(req);
    if (!row) return res.status(404).json({ message: 'الصنف غير موجود' });
    const before = row.reserved_quantity;
    await resyncReservations(seasonId);
    const after = (await prisma.readyStock.findUnique({ where: { id: row.id } }))?.reserved_quantity ?? before;
    logAudit({ user: req.user, module: 'ReadyStock', action: 'UPDATE', record_id: row.id,
      before_data: { reserved_quantity: before }, after_data: { reserved_quantity: after },
      description: `مطابقة حجز ${row.model_code} (${row.color || '—'}) مع الأوردرات: ${before} ← ${after}` });
    return res.json({ before, after, changed: before !== after });
  } catch (err) { console.error(err); return res.status(500).json({ message: 'خطأ في مطابقة الحجز' }); }
});

// ───────── production ─────────
router.get('/:id/production', async (req: Request, res: Response) => {
  try {
    const { seasonId, row } = await loadRow(req);
    if (!row) return res.status(404).json({ message: 'الصنف غير موجود' });
    const [prods, cuts] = await Promise.all([
      prisma.modelProduction.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }),
      prisma.cuttingOrder.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }),
    ]);
    const mine = prods.filter(p => sameStockItem(p, row));
    return res.json({
      stock_id: row.id, model_code: row.model_code, color: row.color, cost_per_piece: row.cost_per_piece,
      entries: mine.map(p => ({ id: p.id, date: p.date, cut_number: p.cut_number, status: p.status, qty_from_cutting: p.qty_from_cutting, qty_received: p.qty_received, wastage: p.wastage })),
      cuts: cuts.filter(c => textsMatch(c.color || '', row.color || '', 'color')).map(c => ({ cut_number: c.cut_number, color: c.color, total_pieces: c.total_pieces, description: c.cut_description })),
    });
  } catch (err) { console.error(err); return res.status(500).json({ message: 'خطأ في جلب الإنتاج' }); }
});

const intOf = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const keyOk = (k: unknown): k is string => typeof k === 'string' && k.length >= 8 && k.length <= 100;

router.post('/:id/production', requireManager, async (req: Request, res: Response) => {
  try {
    if (!has(req, 'ready_stock.create')) return forbid(res, 'ready_stock.create');
    if (!has(req, 'model_prod.create')) return forbid(res, 'model_prod.create');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const qty = intOf(body.qty);
    const cut = intOf(body.cut_number);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ message: 'كمية الإنتاج يجب أن تكون عددًا صحيحًا أكبر من صفر' });
    if (!Number.isInteger(cut) || cut <= 0) return res.status(400).json({ message: 'اختر رقم القص الذي خرج منه الإنتاج' });
    if (!keyOk(body.idempotency_key)) return res.status(400).json({ message: 'معرّف العملية (idempotency_key) مطلوب' });
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
    const { seasonId, row } = await loadRow(req);
    if (!row) return res.status(404).json({ message: 'الصنف غير موجود' });

    const existing = await prisma.modelProduction.findUnique({ where: { idempotency_key: body.idempotency_key } });
    if (existing) return res.status(200).json({ duplicate: true, entry: existing });

    // Same rule as the production page: the pieces must come from a cutting order of this colour that still has them.
    const color = row.color || '';
    let validated: { primaryCut: number; productionColor: string };
    try { validated = await validateProductionParts(seasonId, [{ part_type: '', cut_number: cut, color }], qty); }
    catch (e) {
      const m = e instanceof Error ? e.message : '';
      const msg = m === 'INSUFFICIENT_CUTTING' ? `القطع المتبقية في القصة ${cut} لا تكفي لهذه الكمية` : m === 'NO_COLORS' || m === 'INVALID_COLOR' ? 'رقم القص لا يحتوي هذا اللون' : m === 'MISSING_PARTS' ? 'رقم القص واللون مطلوبان' : 'تعذر التحقق من القص';
      return res.status(400).json({ message: msg });
    }

    const today = cairoToday();
    try {
      const created = await prisma.$transaction(async (tx) => {
        const rec = await tx.modelProduction.create({ data: {
          season_id: seasonId, date: today, cut_number: validated.primaryCut, model_code: row.model_code, qty_from_cutting: qty,
          model_description: row.product_name || row.model_code, color: validated.productionColor, sizes: '', status: 'تام', wastage: 0,
          qty_received: qty, cost_per_piece: row.cost_per_piece, warehouse_entry_date: today, idempotency_key: body.idempotency_key as string,
        } });
        await tx.modelPart.create({ data: { season_id: seasonId, model_id: rec.id, part_type: '', cut_number: validated.primaryCut, color: validated.productionColor } });
        return rec;
      });
      logAudit({ user: req.user, module: 'ModelProduction', action: 'CREATE', record_id: created.id, after_data: created,
        description: `إدخال إنتاج من صفحة المخزون: ${row.model_code} (${row.color || '—'}) × ${qty} من القصة ${cut}${reason ? ` — ${reason}` : ''}` });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return res.status(200).json({ duplicate: true, entry: await prisma.modelProduction.findUnique({ where: { idempotency_key: body.idempotency_key as string } }) });
      }
      throw e;
    }
    await resyncReservations(seasonId);
    return res.status(201).json({ duplicate: false, entry: await prisma.modelProduction.findUnique({ where: { idempotency_key: body.idempotency_key as string } }) });
  } catch (err) { console.error(err); return res.status(500).json({ message: 'خطأ في تسجيل الإنتاج' }); }
});

router.put('/:id/production/:prodId', requireManager, async (req: Request, res: Response) => {
  try {
    if (!has(req, 'ready_stock.edit')) return forbid(res, 'ready_stock.edit');
    if (!has(req, 'model_prod.edit')) return forbid(res, 'model_prod.edit');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const newQty = intOf(body.qty_received);
    if (!Number.isInteger(newQty) || newQty < 0) return res.status(400).json({ message: 'الكمية المستلمة يجب أن تكون عددًا صحيحًا صفرًا أو أكبر' });
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
    if (reason.length < 3) return res.status(400).json({ message: 'سبب التصحيح مطلوب' });
    const { seasonId, row } = await loadRow(req);
    if (!row) return res.status(404).json({ message: 'الصنف غير موجود' });
    const prodId = parseInt(req.params.prodId as string);
    const entry = await prisma.modelProduction.findFirst({ where: { id: prodId, season_id: seasonId } });
    if (!entry || !sameStockItem(entry, row)) return res.status(404).json({ message: 'سجل الإنتاج غير موجود لهذا الصنف' });
    if (newQty > entry.qty_from_cutting) return res.status(400).json({ message: `المستلم لا يمكن أن يتجاوز الكمية الخارجة من القص (${entry.qty_from_cutting})` });
    if (newQty === entry.qty_received) return res.status(200).json({ changed: false, entry });   // repeated submission: nothing to do

    // never let a correction make physical stock negative (pieces already shipped must still exist)
    // (positions clamp the physical figure at 0, so compare the raw supply with what has really left the factory)
    const after = await stockState(seasonId, { prodId, qty_received: newQty });
    const idx = after.readyStock.findIndex(r => r.id === row.id);
    const pos = after.ctx.positions[idx];
    const shippedOut = effectiveSales(after.sales).flatMap(sl => outsideSlots(sl)).filter(sl => after.ctx.keyOf(sl.code, sl.color) === pos.key).reduce((n, sl) => n + sl.qty, 0);
    const resulting = pos.supply - shippedOut;
    if (resulting < 0) {
      return res.status(400).json({ message: `لا يمكن تخفيض الإنتاج: سيصبح الرصيد الفعلي ${resulting} لأن ${shippedOut} قطعة شُحنت بالفعل` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const cur = await tx.modelProduction.findFirst({ where: { id: prodId, season_id: seasonId } });
      if (!cur || cur.qty_received !== entry.qty_received) throw new Error('CONCURRENT');
      return tx.modelProduction.update({ where: { id: prodId }, data: { qty_received: newQty } });
    });
    logAudit({ user: req.user, module: 'ModelProduction', action: 'UPDATE', record_id: prodId,
      before_data: { qty_received: entry.qty_received }, after_data: { qty_received: updated.qty_received },
      description: `تصحيح إنتاج من صفحة المخزون: ${row.model_code} (${row.color || '—'}) المستلم ${entry.qty_received} ← ${newQty} — ${reason}` });
    await resyncReservations(seasonId);
    return res.json({ changed: true, entry: updated });
  } catch (err) {
    if (err instanceof Error && err.message === 'CONCURRENT') return res.status(409).json({ message: 'تم تعديل هذا السجل من مستخدم آخر — أعد التحميل' });
    console.error(err); return res.status(500).json({ message: 'خطأ في تصحيح الإنتاج' });
  }
});

export default router;
