"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const auditHelper_1 = require("../services/auditHelper");
const seasonContext_1 = require("../services/seasonContext");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
function extractModels(data) {
    return [1, 2, 3, 4, 5]
        .map(i => ({
        code: data[`model${i}_code`] || '',
        qty: Number(data[`model${i}_qty`]) || 0,
        color: data[`model${i}_color`] || '',
    }))
        .filter(m => m.code && m.qty > 0);
}
// Find the ReadyStock row that best matches (code+color), falling back to code-only
async function findStockRow(code, color, seasonId, db = prisma_1.default) {
    if (color) {
        const exact = await db.readyStock.findFirst({ where: { ...(0, seasonContext_1.seasonWhere)(seasonId), model_code: code, color } });
        if (exact)
            return exact;
    }
    return db.readyStock.findFirst({ where: { ...(0, seasonContext_1.seasonWhere)(seasonId), model_code: code } });
}
// Adjust reserved_quantity on all model slots of a sale by `delta` (+qty or -qty)
async function adjustReserved(models, delta, seasonId, db = prisma_1.default) {
    for (const m of models) {
        const row = await findStockRow(m.code, m.color, seasonId, db);
        if (!row)
            continue;
        const next = Math.max(0, row.reserved_quantity + delta * m.qty);
        await db.readyStock.update({
            where: { id: row.id },
            data: { reserved_quantity: next },
        });
    }
}
// Validate a shipping-payout "received amount" against the real remaining balance.
// Returns a parsed number, or null if invalid (caller responds 400 with `reason`).
function parseReceivedAmount(raw, remaining) {
    if (raw === undefined || raw === null || raw === '') {
        return { error: 'المبلغ المستلم فعليًا مطلوب' };
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        return { error: 'المبلغ المستلم فعليًا غير صالح' };
    }
    if (value < 0) {
        return { error: 'المبلغ المستلم فعليًا لا يمكن أن يكون أقل من صفر' };
    }
    // Guard against floating point noise (e.g. remaining=5000, received=5000.0000000001)
    if (value > remaining + 0.005) {
        return { error: 'المبلغ المستلم فعليًا لا يمكن أن يتجاوز المبلغ المتبقي' };
    }
    return { value: Math.min(value, remaining) };
}
// ─── routes ─────────────────────────────────────────────────────────────────
// GET /api/sales
router.get('/', async (req, res) => {
    try {
        const seasonId = await (0, seasonContext_1.getSeasonId)(req);
        return res.json(await prisma_1.default.sale.findMany({ where: (0, seasonContext_1.seasonWhere)(seasonId), orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في جلب المبيعات' });
    }
});
// POST /api/sales
router.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const seasonId = await (0, seasonContext_1.getSeasonId)(req);
        const data = req.body;
        const isReservation = data.order_status === 'تم الحجز';
        const { season: _season, id: _id, season_id: _seasonId, ...saleData } = data;
        const sale = await prisma_1.default.sale.create({
            data: {
                ...saleData,
                season_id: seasonId,
                remaining: (Number(data.invoice_value) || 0) - (Number(data.deposit_paid) || 0),
            },
        });
        if (isReservation) {
            await adjustReserved(extractModels(data), +1, seasonId);
        }
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Sales', action: 'CREATE', record_id: sale.id,
            after_data: sale, description: `إضافة عملية بيع: ${sale.client} - ${sale.order_number}` });
        return res.status(201).json(sale);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في إضافة الطلب' });
    }
});
// PUT /api/sales/:id
router.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const seasonId = await (0, seasonContext_1.getSeasonId)(req);
        const id = parseInt(req.params.id);
        const data = req.body;
        const oldSale = await prisma_1.default.sale.findFirst({ where: { id, season_id: seasonId } });
        if (!oldSale)
            return res.status(404).json({ message: 'الطلب غير موجود' });
        const wasReservation = oldSale.order_status === 'تم الحجز';
        const newStatus = data.order_status ?? oldSale.order_status;
        const willBeReservation = newStatus === 'تم الحجز';
        if (data.invoice_value !== undefined || data.deposit_paid !== undefined) {
            const inv = Number(data.invoice_value ?? oldSale.invoice_value ?? 0);
            const dep = Number(data.deposit_paid ?? oldSale.deposit_paid ?? 0);
            data.remaining = inv - dep;
        }
        // Reverse old reservation quantities before saving
        if (wasReservation) {
            await adjustReserved(extractModels(oldSale), -1, seasonId);
        }
        const sale = await prisma_1.default.sale.update({ where: { id }, data: { ...data, season_id: seasonId } });
        // Apply new reservation quantities after saving
        if (willBeReservation) {
            await adjustReserved(extractModels(data), +1, seasonId);
        }
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Sales', action: 'UPDATE', record_id: id,
            before_data: oldSale, after_data: sale, description: `تعديل عملية بيع: ${sale.client} - ${sale.order_number}` });
        return res.json(sale);
    }
    catch {
        return res.status(500).json({ message: 'خطأ في تحديث الطلب' });
    }
});
// DELETE /api/sales/:id
router.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const seasonId = await (0, seasonContext_1.getSeasonId)(req);
        const id = parseInt(req.params.id);
        // If deleting a reservation, release reserved stock first
        const sale = await prisma_1.default.sale.findFirst({ where: { id, season_id: seasonId } });
        if (sale?.order_status === 'تم الحجز') {
            await adjustReserved(extractModels(sale), -1, seasonId);
        }
        await prisma_1.default.sale.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Sales', action: 'DELETE', record_id: id,
            before_data: sale, description: `حذف عملية بيع: ${sale?.client} - ${sale?.order_number}` });
        return res.json({ message: 'تم حذف الطلب' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ في حذف الطلب' });
    }
});
// POST /api/sales/:id/confirm-payout — confirms the ACTUAL amount received from the
// shipping company and marks the order "تم الصرف". This is the "تم الصرف" click flow:
// the shipping company may pay less than the invoice's remaining balance, so the
// caller-supplied amount is validated against the real remaining balance server-side
// and only that amount is ever recorded as collected — never the full remaining balance.
//
// Also doubles as the correction flow (point 11): calling it again on an already
// "تم الصرف" order overwrites shipping_collected with the corrected amount — since every
// financial total reads shipping_collected live, this reverses the old effect and
// applies the new one without any duplicate entry.
router.post('/:id/confirm-payout', auth_1.requireManager, async (req, res) => {
    try {
        const seasonId = await (0, seasonContext_1.getSeasonId)(req);
        const id = parseInt(req.params.id);
        const sale = await prisma_1.default.sale.findFirst({ where: { id, season_id: seasonId } });
        if (!sale)
            return res.status(404).json({ message: 'الطلب غير موجود' });
        if (sale.order_status === 'تم الإلغاء') {
            return res.status(400).json({ message: 'لا يمكن تأكيد صرف طلب ملغي' });
        }
        // Never trust the frontend's number — always validate against the sale's real
        // remaining balance as stored server-side. (Clamped at 0: if the customer already
        // overpaid, remaining is negative and there is nothing left to collect.)
        const remaining = sale.remaining;
        const parsed = parseReceivedAmount(req.body?.received_amount, Math.max(remaining, 0));
        if ('error' in parsed) {
            return res.status(400).json({ message: parsed.error });
        }
        const received = parsed.value;
        const wasReservation = sale.order_status === 'تم الحجز';
        const isCorrection = sale.order_status === 'تم الصرف';
        const previousStatus = sale.order_status;
        const previousReceived = sale.shipping_collected;
        const updated = await prisma_1.default.$transaction(async (tx) => {
            // Releasing a reservation's stock hold is part of the same transition to
            // "تم الصرف" — keep it atomic with the status/amount update.
            if (wasReservation) {
                await adjustReserved(extractModels(sale), -1, seasonId, tx);
            }
            return tx.sale.update({
                where: { id },
                data: { order_status: 'تم الصرف', shipping_collected: received },
            });
        });
        const collection_difference = Math.max(0, remaining - received);
        (0, auditHelper_1.logAudit)({
            user: req.user, module: 'Sales', action: isCorrection ? 'SHIPPING_PAYOUT_CORRECTED' : 'SHIPPING_PAYOUT_CONFIRMED', record_id: id,
            before_data: { order_status: previousStatus, shipping_collected: previousReceived, remaining },
            after_data: { order_status: 'تم الصرف', shipping_collected: received, remaining, collection_difference },
            description: `${sale.client} - ${sale.order_number} — المتبقي: ${remaining} — المستلم فعليًا: ${received} — الفرق غير المحصل: ${collection_difference}`,
        });
        return res.json({ ...updated, collection_difference });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في تأكيد الصرف' });
    }
});
// POST /api/sales/:id/convert-reservation — تم الحجز → تم الصرف
router.post('/:id/convert-reservation', auth_1.requireManager, async (req, res) => {
    try {
        const seasonId = await (0, seasonContext_1.getSeasonId)(req);
        const id = parseInt(req.params.id);
        const sale = await prisma_1.default.sale.findFirst({ where: { id, season_id: seasonId } });
        if (!sale)
            return res.status(404).json({ message: 'الطلب غير موجود' });
        if (sale.order_status !== 'تم الحجز') {
            return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
        }
        // Release reserved qty; actual_balance automatically drops once status → 'تم الصرف'
        await adjustReserved(extractModels(sale), -1, seasonId);
        const updated = await prisma_1.default.sale.update({
            where: { id },
            data: { order_status: 'تم الصرف' },
        });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Sales', action: 'UPDATE', record_id: id,
            before_data: sale, after_data: updated, description: `تحويل حجز إلى صرف: ${sale.client} - ${sale.order_number}` });
        return res.json(updated);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في تحويل الحجز' });
    }
});
// POST /api/sales/:id/cancel-reservation — تم الحجز → تم الإلغاء
router.post('/:id/cancel-reservation', auth_1.requireManager, async (req, res) => {
    try {
        const seasonId = await (0, seasonContext_1.getSeasonId)(req);
        const id = parseInt(req.params.id);
        const sale = await prisma_1.default.sale.findFirst({ where: { id, season_id: seasonId } });
        if (!sale)
            return res.status(404).json({ message: 'الطلب غير موجود' });
        if (sale.order_status !== 'تم الحجز') {
            return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
        }
        // Release reserved qty; actual_balance is unchanged (cancelled sales excluded from totalSales)
        await adjustReserved(extractModels(sale), -1, seasonId);
        const updated = await prisma_1.default.sale.update({
            where: { id },
            data: { order_status: 'تم الإلغاء' },
        });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Sales', action: 'UPDATE', record_id: id,
            before_data: sale, after_data: updated, description: `إلغاء حجز: ${sale.client} - ${sale.order_number}` });
        return res.json(updated);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في إلغاء الحجز' });
    }
});
exports.default = router;
//# sourceMappingURL=sales.js.map