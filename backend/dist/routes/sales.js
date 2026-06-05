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
// GET /api/sales
router.get('/', async (_req, res) => {
    try {
        const sales = await prisma_1.default.sale.findMany({ orderBy: { id: 'asc' } });
        return res.json(sales);
    }
    catch {
        return res.status(500).json({ message: 'خطأ في جلب المبيعات' });
    }
});
// POST /api/sales
router.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const data = req.body;
        const sale = await prisma_1.default.sale.create({
            data: {
                ...data,
                remaining: (data.invoice_value || 0) - (data.deposit_paid || 0),
            },
        });
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
        if (data.invoice_value !== undefined || data.deposit_paid !== undefined) {
            const current = await prisma_1.default.sale.findUnique({ where: { id } });
            const inv = data.invoice_value ?? current?.invoice_value ?? 0;
            const dep = data.deposit_paid ?? current?.deposit_paid ?? 0;
            data.remaining = inv - dep;
        }
        const sale = await prisma_1.default.sale.update({ where: { id }, data });
        return res.json(sale);
    }
    catch {
        return res.status(500).json({ message: 'خطأ في تحديث الطلب' });
    }
});
// DELETE /api/sales/:id
router.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.sale.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم حذف الطلب' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ في حذف الطلب' });
    }
});
// POST /api/sales/:id/convert-reservation — convert reservation → completed sale
router.post('/:id/convert-reservation', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const sale = await prisma_1.default.sale.findUnique({ where: { id } });
        if (!sale)
            return res.status(404).json({ message: 'الطلب غير موجود' });
        if (sale.order_status !== 'تم الحجز') {
            return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
        }
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
// POST /api/sales/:id/cancel-reservation — cancel reservation
router.post('/:id/cancel-reservation', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const sale = await prisma_1.default.sale.findUnique({ where: { id } });
        if (!sale)
            return res.status(404).json({ message: 'الطلب غير موجود' });
        if (sale.order_status !== 'تم الحجز') {
            return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
        }
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