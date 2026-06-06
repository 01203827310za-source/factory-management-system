"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
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
async function findStockRow(code, color) {
    if (color) {
        const exact = await prisma_1.default.readyStock.findFirst({ where: { model_code: code, color } });
        if (exact)
            return exact;
    }
    return prisma_1.default.readyStock.findFirst({ where: { model_code: code } });
}
// Adjust reserved_quantity on all model slots of a sale by `delta` (+qty or -qty)
async function adjustReserved(models, delta) {
    for (const m of models) {
        const row = await findStockRow(m.code, m.color);
        if (!row)
            continue;
        const next = Math.max(0, row.reserved_quantity + delta * m.qty);
        await prisma_1.default.readyStock.update({
            where: { id: row.id },
            data: { reserved_quantity: next },
        });
    }
}
// ─── routes ─────────────────────────────────────────────────────────────────
// GET /api/sales
router.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.sale.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في جلب المبيعات' });
    }
});
// POST /api/sales
router.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const data = req.body;
        const isReservation = data.order_status === 'تم الحجز';
        const sale = await prisma_1.default.sale.create({
            data: {
                ...data,
                remaining: (Number(data.invoice_value) || 0) - (Number(data.deposit_paid) || 0),
            },
        });
        if (isReservation) {
            await adjustReserved(extractModels(data), +1);
        }
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
        const id = parseInt(req.params.id);
        const data = req.body;
        const oldSale = await prisma_1.default.sale.findUnique({ where: { id } });
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
            await adjustReserved(extractModels(oldSale), -1);
        }
        const sale = await prisma_1.default.sale.update({ where: { id }, data });
        // Apply new reservation quantities after saving
        if (willBeReservation) {
            await adjustReserved(extractModels(data), +1);
        }
        return res.json(sale);
    }
    catch {
        return res.status(500).json({ message: 'خطأ في تحديث الطلب' });
    }
});
// DELETE /api/sales/:id
router.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        // If deleting a reservation, release reserved stock first
        const sale = await prisma_1.default.sale.findUnique({ where: { id } });
        if (sale?.order_status === 'تم الحجز') {
            await adjustReserved(extractModels(sale), -1);
        }
        await prisma_1.default.sale.delete({ where: { id } });
        return res.json({ message: 'تم حذف الطلب' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ في حذف الطلب' });
    }
});
// POST /api/sales/:id/convert-reservation — تم الحجز → تم الصرف
router.post('/:id/convert-reservation', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const sale = await prisma_1.default.sale.findUnique({ where: { id } });
        if (!sale)
            return res.status(404).json({ message: 'الطلب غير موجود' });
        if (sale.order_status !== 'تم الحجز') {
            return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
        }
        // Release reserved qty; actual_balance automatically drops once status → 'تم الصرف'
        await adjustReserved(extractModels(sale), -1);
        const updated = await prisma_1.default.sale.update({
            where: { id },
            data: { order_status: 'تم الصرف' },
        });
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
        const id = parseInt(req.params.id);
        const sale = await prisma_1.default.sale.findUnique({ where: { id } });
        if (!sale)
            return res.status(404).json({ message: 'الطلب غير موجود' });
        if (sale.order_status !== 'تم الحجز') {
            return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
        }
        // Release reserved qty; actual_balance is unchanged (cancelled sales excluded from totalSales)
        await adjustReserved(extractModels(sale), -1);
        const updated = await prisma_1.default.sale.update({
            where: { id },
            data: { order_status: 'تم الإلغاء' },
        });
        return res.json(updated);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في إلغاء الحجز' });
    }
});
exports.default = router;
//# sourceMappingURL=sales.js.map