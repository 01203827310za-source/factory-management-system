"use strict";
// ============================================
// All Entity Routes (Expenses, Stock, Fabric, 
// Accessories, Cutting, ModelProd, Debts, 
// ClientAccounts, Returns, PaymentLog, Marketers)
// ============================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixedAssetsRouter = exports.fabricPurchasesRouter = exports.marketersRouter = exports.paymentLogRouter = exports.returnsRouter = exports.clientAccountsRouter = exports.debtsRouter = exports.modelProdRouter = exports.cuttingRouter = exports.accessoriesRouter = exports.fabricRouter = exports.readyStockRouter = exports.expensesRouter = void 0;
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
// Remove PaymentLog entries when a debt/client-account paid amount is reduced.
// Deletes from newest first; if a single log exceeds the remaining delta, trims it.
async function purgePaymentLogs(type, descPrefix, amountToRemove) {
    if (amountToRemove <= 0)
        return;
    const logs = await prisma_1.default.paymentLog.findMany({
        where: { type, description: { startsWith: descPrefix } },
        orderBy: { id: 'desc' },
    });
    let toRemove = amountToRemove;
    for (const log of logs) {
        if (toRemove <= 0)
            break;
        if (log.amount <= toRemove) {
            await prisma_1.default.paymentLog.delete({ where: { id: log.id } });
            toRemove -= log.amount;
        }
        else {
            await prisma_1.default.paymentLog.update({ where: { id: log.id }, data: { amount: log.amount - toRemove } });
            toRemove = 0;
        }
    }
}
// ===== EXPENSES =====
exports.expensesRouter = (0, express_1.Router)();
exports.expensesRouter.use(auth_1.authenticate);
exports.expensesRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.expenseRevenue.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في جلب البيانات' });
    }
});
exports.expensesRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.expenseRevenue.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في الإضافة' });
    }
});
exports.expensesRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        return res.json(await prisma_1.default.expenseRevenue.update({ where: { id: parseInt(req.params.id) }, data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في التحديث' });
    }
});
exports.expensesRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.expenseRevenue.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم الحذف' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ في الحذف' });
    }
});
// ===== READY STOCK =====
exports.readyStockRouter = (0, express_1.Router)();
exports.readyStockRouter.use(auth_1.authenticate);
exports.readyStockRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.readyStock.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.readyStockRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.readyStock.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.readyStockRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        // Strip reserved_quantity — it is managed exclusively by the reservation workflow
        const { reserved_quantity: _ignored, ...safeData } = req.body;
        return res.json(await prisma_1.default.readyStock.update({
            where: { id: parseInt(req.params.id) },
            data: safeData,
        }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.readyStockRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.readyStock.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== FABRIC WAREHOUSE =====
exports.fabricRouter = (0, express_1.Router)();
exports.fabricRouter.use(auth_1.authenticate);
exports.fabricRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.fabricWarehouse.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.fabricRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.fabricWarehouse.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.fabricRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        return res.json(await prisma_1.default.fabricWarehouse.update({ where: { id: parseInt(req.params.id) }, data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.fabricRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.fabricWarehouse.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== ACCESSORIES =====
exports.accessoriesRouter = (0, express_1.Router)();
exports.accessoriesRouter.use(auth_1.authenticate);
exports.accessoriesRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.accessoriesWarehouse.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.accessoriesRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.accessoriesWarehouse.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.accessoriesRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        return res.json(await prisma_1.default.accessoriesWarehouse.update({ where: { id: parseInt(req.params.id) }, data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.accessoriesRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.accessoriesWarehouse.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== CUTTING ORDERS =====
exports.cuttingRouter = (0, express_1.Router)();
exports.cuttingRouter.use(auth_1.authenticate);
exports.cuttingRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.cuttingOrder.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.cuttingRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.cuttingOrder.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.cuttingRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        return res.json(await prisma_1.default.cuttingOrder.update({ where: { id: parseInt(req.params.id) }, data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.cuttingRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.cuttingOrder.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== MODEL PRODUCTION =====
exports.modelProdRouter = (0, express_1.Router)();
exports.modelProdRouter.use(auth_1.authenticate);
exports.modelProdRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.modelProduction.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.modelProdRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.modelProduction.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.modelProdRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        return res.json(await prisma_1.default.modelProduction.update({ where: { id: parseInt(req.params.id) }, data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.modelProdRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.modelProduction.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== DEBTS =====
exports.debtsRouter = (0, express_1.Router)();
exports.debtsRouter.use(auth_1.authenticate);
exports.debtsRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.debt.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.debtsRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const data = req.body;
        const debt = await prisma_1.default.debt.create({
            data: { ...data, remaining: (data.total_amount || 0) - (data.amount_paid || 0) },
        });
        return res.status(201).json(debt);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.debtsRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const data = req.body;
        const cur = await prisma_1.default.debt.findUnique({ where: { id } });
        if (!cur)
            return res.status(404).json({ message: 'الدين غير موجود' });
        const newPaid = data.amount_paid !== undefined ? Number(data.amount_paid) : cur.amount_paid;
        const newTotal = data.total_amount !== undefined ? Number(data.total_amount) : cur.total_amount;
        data.remaining = newTotal - newPaid;
        const result = await prisma_1.default.debt.update({ where: { id }, data });
        const delta = newPaid - cur.amount_paid;
        if (delta < 0) {
            await purgePaymentLogs('debt_payment', `سداد دين: ${cur.name}`, -delta);
        }
        return res.json(result);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.debtsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const cur = await prisma_1.default.debt.findUnique({ where: { id } });
        if (cur && cur.amount_paid > 0) {
            await prisma_1.default.paymentLog.deleteMany({
                where: { type: 'debt_payment', description: { startsWith: `سداد دين: ${cur.name}` } },
            });
        }
        await prisma_1.default.debt.delete({ where: { id } });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== CLIENT ACCOUNTS =====
exports.clientAccountsRouter = (0, express_1.Router)();
exports.clientAccountsRouter.use(auth_1.authenticate);
exports.clientAccountsRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.clientAccount.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.clientAccountsRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const data = req.body;
        return res.status(201).json(await prisma_1.default.clientAccount.create({
            data: { ...data, remaining: (data.total_amount || 0) - (data.amount_paid || 0) },
        }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.clientAccountsRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const data = req.body;
        const cur = await prisma_1.default.clientAccount.findUnique({ where: { id } });
        if (!cur)
            return res.status(404).json({ message: 'الحساب غير موجود' });
        const newPaid = data.amount_paid !== undefined ? Number(data.amount_paid) : cur.amount_paid;
        const newTotal = data.total_amount !== undefined ? Number(data.total_amount) : cur.total_amount;
        data.remaining = newTotal - newPaid;
        const result = await prisma_1.default.clientAccount.update({ where: { id }, data });
        const delta = newPaid - cur.amount_paid;
        if (delta < 0) {
            await purgePaymentLogs('client_payment', `دفعة عميل: ${cur.client_name}`, -delta);
        }
        return res.json(result);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.clientAccountsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const cur = await prisma_1.default.clientAccount.findUnique({ where: { id } });
        if (cur && cur.amount_paid > 0) {
            await prisma_1.default.paymentLog.deleteMany({
                where: { type: 'client_payment', description: { startsWith: `دفعة عميل: ${cur.client_name}` } },
            });
        }
        await prisma_1.default.clientAccount.delete({ where: { id } });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== RETURNS =====
exports.returnsRouter = (0, express_1.Router)();
exports.returnsRouter.use(auth_1.authenticate);
exports.returnsRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.returnItem.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.returnsRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.returnItem.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.returnsRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        return res.json(await prisma_1.default.returnItem.update({ where: { id: parseInt(req.params.id) }, data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.returnsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.returnItem.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== PAYMENT LOGS =====
exports.paymentLogRouter = (0, express_1.Router)();
exports.paymentLogRouter.use(auth_1.authenticate);
exports.paymentLogRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.paymentLog.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.paymentLogRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.paymentLog.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.paymentLogRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.paymentLog.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== MARKETERS =====
exports.marketersRouter = (0, express_1.Router)();
exports.marketersRouter.use(auth_1.authenticate);
exports.marketersRouter.get('/', async (_req, res) => {
    try {
        const marketers = await prisma_1.default.marketer.findMany({ orderBy: { id: 'asc' } });
        return res.json(marketers.map(m => m.name));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.marketersRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name)
            return res.status(400).json({ message: 'اسم المسوق مطلوب' });
        const existing = await prisma_1.default.marketer.findUnique({ where: { name } });
        if (existing)
            return res.status(400).json({ message: 'المسوق موجود بالفعل' });
        await prisma_1.default.marketer.create({ data: { name } });
        const all = await prisma_1.default.marketer.findMany({ orderBy: { id: 'asc' } });
        return res.status(201).json(all.map(m => m.name));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.marketersRouter.delete('/:name', auth_1.requireManager, async (req, res) => {
    try {
        const name = decodeURIComponent(req.params.name);
        await prisma_1.default.marketer.delete({ where: { name } });
        const all = await prisma_1.default.marketer.findMany({ orderBy: { id: 'asc' } });
        return res.json(all.map(m => m.name));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== FABRIC PURCHASES =====
exports.fabricPurchasesRouter = (0, express_1.Router)();
exports.fabricPurchasesRouter.use(auth_1.authenticate);
exports.fabricPurchasesRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.fabricPurchase.findMany({ orderBy: { id: 'desc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.fabricPurchasesRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const { date, fabric_type, color, quantity_kg, price_per_kg, supplier, invoice_no, notes } = req.body;
        const qty = parseFloat(quantity_kg) || 0;
        const price = parseFloat(price_per_kg) || 0;
        if (!fabric_type || qty <= 0 || price <= 0) {
            return res.status(400).json({ message: 'يرجى تحديد الصنف والكمية والسعر' });
        }
        const total_cost = Math.round(qty * price * 100) / 100;
        const cleanColor = (color || '').trim();
        // 1. Save purchase history (immutable record)
        const purchase = await prisma_1.default.fabricPurchase.create({
            data: {
                date, fabric_type, color: cleanColor,
                quantity_kg: qty, price_per_kg: price, total_cost,
                supplier: supplier || '', invoice_no: invoice_no || '', notes: notes || '',
            },
        });
        // 2. Find existing warehouse row for this type + color
        const existing = await prisma_1.default.fabricWarehouse.findFirst({
            where: { material_type: fabric_type, color: cleanColor },
        });
        if (existing) {
            // Weighted average: (old_qty * old_avg + new_qty * new_price) / total_qty
            const currentAvg = existing.avg_cost_per_kg > 0 ? existing.avg_cost_per_kg : existing.cost_per_kg;
            const totalQty = existing.qty_in + qty;
            const newAvg = totalQty > 0
                ? (existing.qty_in * currentAvg + qty * price) / totalQty
                : price;
            await prisma_1.default.fabricWarehouse.update({
                where: { id: existing.id },
                data: {
                    qty_in: totalQty,
                    avg_cost_per_kg: Math.round(newAvg * 100) / 100,
                    last_purchase_price: price,
                },
            });
        }
        else {
            // No existing row — create one
            await prisma_1.default.fabricWarehouse.create({
                data: {
                    date,
                    material_type: fabric_type,
                    color: cleanColor,
                    qty_in: qty,
                    cost_per_kg: price,
                    avg_cost_per_kg: price,
                    last_purchase_price: price,
                },
            });
        }
        return res.status(201).json(purchase);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في حفظ المشترى' });
    }
});
exports.fabricPurchasesRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { date, fabric_type, color, quantity_kg, price_per_kg, supplier, invoice_no, notes } = req.body;
        const newQty = parseFloat(quantity_kg) || 0;
        const newPrice = parseFloat(price_per_kg) || 0;
        if (!fabric_type || newQty <= 0 || newPrice <= 0) {
            return res.status(400).json({ message: 'يرجى تحديد الصنف والكمية والسعر' });
        }
        const cleanColor = (color || '').trim();
        const result = await prisma_1.default.$transaction(async (tx) => {
            const existing = await tx.fabricPurchase.findUnique({ where: { id } });
            if (!existing)
                throw new Error('NOT_FOUND');
            const warehouse = await tx.fabricWarehouse.findFirst({
                where: { material_type: existing.fabric_type, color: existing.color },
            });
            if (!warehouse)
                throw new Error('WAREHOUSE_NOT_FOUND');
            // Get all purchases to compute baseQty
            const allPurchases = await tx.fabricPurchase.findMany({
                where: { fabric_type: existing.fabric_type, color: existing.color },
                orderBy: { id: 'asc' },
            });
            const currentPurchaseTotalQty = allPurchases.reduce((s, p) => s + p.quantity_kg, 0);
            const baseQty = Math.max(0, warehouse.qty_in - currentPurchaseTotalQty);
            const baseCost = warehouse.cost_per_kg;
            // Safety: if reducing quantity, check cutting consumption
            if (newQty < existing.quantity_kg) {
                const cutting = await tx.cuttingOrder.findMany({
                    where: { material_type: existing.fabric_type, color: existing.color },
                });
                const totalConsumed = cutting.reduce((s, c) => s + c.kg_consumed, 0);
                const newTotalQty = baseQty + (currentPurchaseTotalQty - existing.quantity_kg + newQty);
                if (newTotalQty < totalConsumed)
                    throw new Error('CONSUMED');
            }
            // Build updated purchase list: replace old with new values
            const afterPurchases = allPurchases.map(p => p.id === id
                ? { quantity_kg: newQty, price_per_kg: newPrice }
                : { quantity_kg: p.quantity_kg, price_per_kg: p.price_per_kg });
            const newPurchaseTotalQty = afterPurchases.reduce((s, p) => s + p.quantity_kg, 0);
            const newTotalQty = baseQty + newPurchaseTotalQty;
            const weightedSum = baseQty * baseCost + afterPurchases.reduce((s, p) => s + p.quantity_kg * p.price_per_kg, 0);
            const newAvg = newTotalQty > 0 ? weightedSum / newTotalQty : newPrice;
            const lastPurchase = afterPurchases[afterPurchases.length - 1];
            await tx.fabricWarehouse.update({
                where: { id: warehouse.id },
                data: {
                    qty_in: newTotalQty,
                    avg_cost_per_kg: Math.round(newAvg * 100) / 100,
                    last_purchase_price: lastPurchase?.price_per_kg ?? baseCost,
                },
            });
            return tx.fabricPurchase.update({
                where: { id },
                data: {
                    date, fabric_type, color: cleanColor,
                    quantity_kg: newQty, price_per_kg: newPrice,
                    total_cost: Math.round(newQty * newPrice * 100) / 100,
                    supplier: supplier || '', invoice_no: invoice_no || '', notes: notes || '',
                },
            });
        });
        return res.json(result);
    }
    catch (err) {
        if (err instanceof Error) {
            if (err.message === 'NOT_FOUND')
                return res.status(404).json({ message: 'العملية غير موجودة' });
            if (err.message === 'CONSUMED')
                return res.status(400).json({ message: 'لا يمكن حذف أو تقليل هذه العملية لأن جزءاً من الكمية تم استهلاكه بالفعل.' });
            if (err.message === 'WAREHOUSE_NOT_FOUND')
                return res.status(404).json({ message: 'سجل المخزون غير موجود' });
        }
        console.error(err);
        return res.status(500).json({ message: 'خطأ في تعديل المشترى' });
    }
});
exports.fabricPurchasesRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await prisma_1.default.$transaction(async (tx) => {
            const existing = await tx.fabricPurchase.findUnique({ where: { id } });
            if (!existing)
                throw new Error('NOT_FOUND');
            const warehouse = await tx.fabricWarehouse.findFirst({
                where: { material_type: existing.fabric_type, color: existing.color },
            });
            if (!warehouse)
                throw new Error('WAREHOUSE_NOT_FOUND');
            const allPurchases = await tx.fabricPurchase.findMany({
                where: { fabric_type: existing.fabric_type, color: existing.color },
                orderBy: { id: 'asc' },
            });
            const currentPurchaseTotalQty = allPurchases.reduce((s, p) => s + p.quantity_kg, 0);
            const baseQty = Math.max(0, warehouse.qty_in - currentPurchaseTotalQty);
            const baseCost = warehouse.cost_per_kg;
            const afterPurchases = allPurchases
                .filter(p => p.id !== id)
                .map(p => ({ quantity_kg: p.quantity_kg, price_per_kg: p.price_per_kg }));
            const newPurchaseTotalQty = afterPurchases.reduce((s, p) => s + p.quantity_kg, 0);
            const newTotalQty = baseQty + newPurchaseTotalQty;
            // Safety: ensure remaining stock covers cutting consumption
            const cutting = await tx.cuttingOrder.findMany({
                where: { material_type: existing.fabric_type, color: existing.color },
            });
            const totalConsumed = cutting.reduce((s, c) => s + c.kg_consumed, 0);
            if (newTotalQty < totalConsumed)
                throw new Error('CONSUMED');
            const weightedSum = baseQty * baseCost + afterPurchases.reduce((s, p) => s + p.quantity_kg * p.price_per_kg, 0);
            const newAvg = newTotalQty > 0 ? weightedSum / newTotalQty : baseCost;
            const lastPurchase = afterPurchases[afterPurchases.length - 1];
            await tx.fabricWarehouse.update({
                where: { id: warehouse.id },
                data: {
                    qty_in: newTotalQty,
                    avg_cost_per_kg: Math.round(newAvg * 100) / 100,
                    last_purchase_price: lastPurchase?.price_per_kg ?? baseCost,
                },
            });
            await tx.fabricPurchase.delete({ where: { id } });
        });
        return res.json({ message: 'تم الحذف' });
    }
    catch (err) {
        if (err instanceof Error) {
            if (err.message === 'NOT_FOUND')
                return res.status(404).json({ message: 'العملية غير موجودة' });
            if (err.message === 'CONSUMED')
                return res.status(400).json({ message: 'لا يمكن حذف أو تقليل هذه العملية لأن جزءاً من الكمية تم استهلاكه بالفعل.' });
            if (err.message === 'WAREHOUSE_NOT_FOUND')
                return res.status(404).json({ message: 'سجل المخزون غير موجود' });
        }
        console.error(err);
        return res.status(500).json({ message: 'خطأ في حذف المشترى' });
    }
});
// ===== FIXED ASSETS =====
exports.fixedAssetsRouter = (0, express_1.Router)();
exports.fixedAssetsRouter.use(auth_1.authenticate);
exports.fixedAssetsRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.fixedAsset.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في جلب البيانات' });
    }
});
exports.fixedAssetsRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.fixedAsset.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في الإضافة' });
    }
});
exports.fixedAssetsRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        return res.json(await prisma_1.default.fixedAsset.update({ where: { id: parseInt(req.params.id) }, data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في التحديث' });
    }
});
exports.fixedAssetsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.fixedAsset.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم الحذف' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ في الحذف' });
    }
});
//# sourceMappingURL=entities.js.map