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
exports.fixedAssetsRouter = exports.marketersRouter = exports.paymentLogRouter = exports.returnsRouter = exports.clientAccountsRouter = exports.debtsRouter = exports.modelProdRouter = exports.cuttingRouter = exports.accessoriesRouter = exports.fabricRouter = exports.readyStockRouter = exports.expensesRouter = void 0;
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
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
        return res.json(await prisma_1.default.readyStock.update({ where: { id: parseInt(req.params.id) }, data: req.body }));
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
        if (data.total_amount !== undefined || data.amount_paid !== undefined) {
            const cur = await prisma_1.default.debt.findUnique({ where: { id } });
            const total = data.total_amount ?? cur?.total_amount ?? 0;
            const paid = data.amount_paid ?? cur?.amount_paid ?? 0;
            data.remaining = total - paid;
        }
        return res.json(await prisma_1.default.debt.update({ where: { id }, data }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.debtsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.debt.delete({ where: { id: parseInt(req.params.id) } });
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
        if (data.total_amount !== undefined || data.amount_paid !== undefined) {
            const cur = await prisma_1.default.clientAccount.findUnique({ where: { id } });
            const total = data.total_amount ?? cur?.total_amount ?? 0;
            const paid = data.amount_paid ?? cur?.amount_paid ?? 0;
            data.remaining = total - paid;
        }
        return res.json(await prisma_1.default.clientAccount.update({ where: { id }, data }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.clientAccountsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.clientAccount.delete({ where: { id: parseInt(req.params.id) } });
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
// ===== FIXED ASSETS =====
exports.fixedAssetsRouter = (0, express_1.Router)();
exports.fixedAssetsRouter.use(auth_1.authenticate);
exports.fixedAssetsRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.asset.findMany({ orderBy: { id: 'asc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في جلب البيانات' });
    }
});
exports.fixedAssetsRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        return res.status(201).json(await prisma_1.default.asset.create({ data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في الإضافة' });
    }
});
exports.fixedAssetsRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    try {
        return res.json(await prisma_1.default.asset.update({ where: { id: parseInt(req.params.id) }, data: req.body }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ في التحديث' });
    }
});
exports.fixedAssetsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        await prisma_1.default.asset.delete({ where: { id: parseInt(req.params.id) } });
        return res.json({ message: 'تم الحذف' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ في الحذف' });
    }
});
//# sourceMappingURL=entities.js.map