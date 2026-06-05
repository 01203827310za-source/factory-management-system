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
// Validate that each model slot has enough available stock.
// available = actual_balance - reserved_quantity
// actual_balance = opening + production - non_reservation_sales + returns
async function validateAvailability(models) {
    const uniqueCodes = [...new Set(models.map(m => m.code))];
    const [stockRows, modelProds, allSales, allReturns] = await Promise.all([
        prisma_1.default.readyStock.findMany({ where: { model_code: { in: uniqueCodes } } }),
        prisma_1.default.modelProduction.findMany({ where: { model_code: { in: uniqueCodes } } }),
        prisma_1.default.sale.findMany({
            where: { NOT: { order_status: { in: ['تم الحجز', 'تم الإلغاء'] } } },
        }),
        prisma_1.default.returnItem.findMany({ where: { model_code: { in: uniqueCodes } } }),
    ]);
    // Pre-aggregate by model_code (mirrors the ReadyStock computation)
    const newProd = {};
    modelProds.forEach(mp => { newProd[mp.model_code] = (newProd[mp.model_code] || 0) + mp.qty_received; });
    const totalSold = {};
    allSales.forEach(s => {
        [
            { code: s.model1_code, qty: s.model1_qty },
            { code: s.model2_code, qty: s.model2_qty },
            { code: s.model3_code, qty: s.model3_qty },
            { code: s.model4_code, qty: s.model4_qty },
            { code: s.model5_code, qty: s.model5_qty },
        ].forEach(({ code, qty }) => {
            if (code && qty > 0)
                totalSold[code] = (totalSold[code] || 0) + qty;
        });
    });
    const totalReturns = {};
    allReturns.forEach(r => { if (r.model_code)
        totalReturns[r.model_code] = (totalReturns[r.model_code] || 0) + r.model_qty; });
    const errors = [];
    for (const m of models) {
        // Prefer exact (code+color) match, fall back to code-only
        const row = stockRows.find(s => s.model_code === m.code && s.color === m.color) ||
            stockRows.find(s => s.model_code === m.code);
        if (!row)
            continue; // No stock entry at all — skip validation
        const actualBalance = row.opening_balance +
            (newProd[m.code] || 0) -
            (totalSold[m.code] || 0) +
            (totalReturns[m.code] || 0);
        const available = Math.max(0, actualBalance - row.reserved_quantity);
        if (m.qty > available) {
            errors.push(`الموديل ${m.code}${m.color ? ` (${m.color})` : ''}: المتاح ${available} — المطلوب ${m.qty}`);
        }
    }
    return errors;
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
        if (data.invoice_value !== undefined || data.deposit_paid !== undefined) {
            const current = await prisma_1.default.sale.findUnique({ where: { id } });
            const inv = Number(data.invoice_value ?? current?.invoice_value ?? 0);
            const dep = Number(data.deposit_paid ?? current?.deposit_paid ?? 0);
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