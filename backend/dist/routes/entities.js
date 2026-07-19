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
exports.printOrdersRouter = exports.fixedAssetsRouter = exports.fabricPurchasesRouter = exports.marketersRouter = exports.paymentLogRouter = exports.returnsRouter = exports.clientAccountsRouter = exports.debtsRouter = exports.modelProdRouter = exports.cuttingRouter = exports.accessoriesRouter = exports.fabricRouter = exports.readyStockRouter = exports.expensesRouter = void 0;
exports.rebuildFabricInventory = rebuildFabricInventory;
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const auditHelper_1 = require("../services/auditHelper");
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
        const rec = await prisma_1.default.expenseRevenue.create({ data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Expenses', action: 'CREATE', record_id: rec.id,
            after_data: rec, description: `إضافة ${rec.operation_type}: ${rec.statement}` });
        return res.status(201).json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ في الإضافة' });
    }
});
exports.expensesRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.expenseRevenue.findUnique({ where: { id } });
        const rec = await prisma_1.default.expenseRevenue.update({ where: { id }, data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Expenses', action: 'UPDATE', record_id: id,
            before_data: before, after_data: rec, description: `تعديل ${rec.operation_type}: ${rec.statement}` });
        return res.json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ في التحديث' });
    }
});
exports.expensesRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.expenseRevenue.findUnique({ where: { id } });
        await prisma_1.default.expenseRevenue.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Expenses', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف ${before?.operation_type}: ${before?.statement}` });
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
        const rec = await prisma_1.default.readyStock.create({ data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ReadyStock', action: 'CREATE', record_id: rec.id,
            after_data: rec, description: `إضافة منتج جاهز: ${rec.model_code} - ${rec.product_name}` });
        return res.status(201).json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.readyStockRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.readyStock.findUnique({ where: { id } });
        // Strip reserved_quantity — it is managed exclusively by the reservation workflow
        const { reserved_quantity: _ignored, ...safeData } = req.body;
        const rec = await prisma_1.default.readyStock.update({ where: { id }, data: safeData });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ReadyStock', action: 'UPDATE', record_id: id,
            before_data: before, after_data: rec, description: `تعديل منتج جاهز: ${rec.model_code} - ${rec.product_name}` });
        return res.json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.readyStockRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.readyStock.findUnique({ where: { id } });
        await prisma_1.default.readyStock.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ReadyStock', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف منتج جاهز: ${before?.model_code} - ${before?.product_name}` });
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
        const rec = await prisma_1.default.fabricWarehouse.create({ data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'FabricWarehouse', action: 'CREATE', record_id: rec.id,
            after_data: rec, description: `إضافة قماش: ${rec.material_type} - ${rec.color}` });
        return res.status(201).json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.fabricRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.fabricWarehouse.findUnique({ where: { id } });
        const rec = await prisma_1.default.fabricWarehouse.update({ where: { id }, data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'FabricWarehouse', action: 'UPDATE', record_id: id,
            before_data: before, after_data: rec, description: `تعديل قماش: ${rec.material_type} - ${rec.color}` });
        return res.json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.fabricRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.fabricWarehouse.findUnique({ where: { id } });
        await prisma_1.default.fabricWarehouse.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'FabricWarehouse', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف قماش: ${before?.material_type} - ${before?.color}` });
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
        const rec = await prisma_1.default.accessoriesWarehouse.create({ data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Accessories', action: 'CREATE', record_id: rec.id,
            after_data: rec, description: `إضافة إكسسوار: ${rec.item_name}` });
        return res.status(201).json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.accessoriesRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.accessoriesWarehouse.findUnique({ where: { id } });
        const rec = await prisma_1.default.accessoriesWarehouse.update({ where: { id }, data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Accessories', action: 'UPDATE', record_id: id,
            before_data: before, after_data: rec, description: `تعديل إكسسوار: ${rec.item_name}` });
        return res.json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.accessoriesRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.accessoriesWarehouse.findUnique({ where: { id } });
        await prisma_1.default.accessoriesWarehouse.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Accessories', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف إكسسوار: ${before?.item_name}` });
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
        const cuts = await prisma_1.default.cuttingOrder.findMany({ orderBy: { id: 'asc' } });
        // For each cut, compute reserved pieces from model_parts → model_production
        const usedMap = new Map();
        const pairs = [...new Set(cuts.map(c => `${c.cut_number}|${c.color}`))];
        await Promise.all(pairs.map(async (key) => {
            const [cut_number, color] = key.split('|');
            const parts = await prisma_1.default.modelPart.findMany({
                where: { cut_number: parseInt(cut_number), color },
                include: { model: { select: { qty_from_cutting: true } } },
            });
            usedMap.set(key, parts.reduce((s, p) => s + p.model.qty_from_cutting, 0));
        }));
        const result = cuts.map(c => {
            const key = `${c.cut_number}|${c.color}`;
            const used = usedMap.get(key) ?? 0;
            return { ...c, remaining_pieces: c.total_pieces - used };
        });
        return res.json(result);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.cuttingRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const rec = await prisma_1.default.cuttingOrder.create({ data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Cutting', action: 'CREATE', record_id: rec.id,
            after_data: rec, description: `إضافة أمر قطع: ${rec.cut_description || rec.cut_number}` });
        return res.status(201).json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.cuttingRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.cuttingOrder.findUnique({ where: { id } });
        const rec = await prisma_1.default.cuttingOrder.update({ where: { id }, data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Cutting', action: 'UPDATE', record_id: id,
            before_data: before, after_data: rec, description: `تعديل أمر قطع: ${rec.cut_description || rec.cut_number}` });
        return res.json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.cuttingRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.cuttingOrder.findUnique({ where: { id } });
        await prisma_1.default.cuttingOrder.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Cutting', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف أمر قطع: ${before?.cut_description || before?.cut_number}` });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== MODEL PRODUCTION =====
exports.modelProdRouter = (0, express_1.Router)();
exports.modelProdRouter.use(auth_1.authenticate);
const PARTS_INCLUDE = { parts: { orderBy: { id: 'asc' } } };
// Returns how many pieces from (cut_number, color) are still available.
// excludeModelId: omit that model's usage (for update validation).
async function getAvailableForPart(cut_number, color, excludeModelId) {
    const cuts = await prisma_1.default.cuttingOrder.findMany({ where: { cut_number, color } });
    const total = cuts.reduce((s, c) => s + c.total_pieces, 0);
    const usedParts = await prisma_1.default.modelPart.findMany({
        where: {
            cut_number,
            color,
            ...(excludeModelId !== undefined ? { model_id: { not: excludeModelId } } : {}),
        },
        include: { model: { select: { qty_from_cutting: true } } },
    });
    const used = usedParts.reduce((s, p) => s + p.model.qty_from_cutting, 0);
    return { total, used, available: total - used };
}
exports.modelProdRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.modelProduction.findMany({
            orderBy: { id: 'asc' },
            include: PARTS_INCLUDE,
        }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.modelProdRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const { parts, ...data } = req.body;
        const qty = parseInt(data.qty_from_cutting) || 0;
        if (Array.isArray(parts) && parts.length > 0) {
            for (const p of parts) {
                const partCut = p.cut_number || 0;
                const partColor = (p.color || '').trim();
                if (partCut > 0 && partColor) {
                    const { available } = await getAvailableForPart(partCut, partColor);
                    if (available < qty) {
                        return res.status(400).json({
                            message: `رصيد غير كافٍ للقصة ${partCut} - ${partColor}.\nالمتاح: ${available}\nالمطلوب: ${qty}`,
                        });
                    }
                }
            }
        }
        const primaryCut = Array.isArray(parts) && parts.length > 0
            ? (parts[0].cut_number || 0) : (data.cut_number || 0);
        const rec = await prisma_1.default.modelProduction.create({ data: { ...data, cut_number: primaryCut } });
        if (Array.isArray(parts) && parts.length > 0) {
            await prisma_1.default.modelPart.createMany({
                data: parts.map(p => ({
                    model_id: rec.id,
                    part_type: p.part_type || '',
                    cut_number: p.cut_number || 0,
                    color: (p.color || '').trim(),
                })),
            });
        }
        const fresh = await prisma_1.default.modelProduction.findUnique({ where: { id: rec.id }, include: PARTS_INCLUDE });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ModelProduction', action: 'CREATE', record_id: rec.id,
            after_data: fresh, description: `إضافة إنتاج موديل: ${rec.model_code} - ${rec.model_description}` });
        return res.status(201).json(fresh);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.modelProdRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const { parts, ...data } = req.body;
        const qty = parseInt(data.qty_from_cutting) || 0;
        if (Array.isArray(parts) && parts.length > 0) {
            for (const p of parts) {
                const partCut = p.cut_number || 0;
                const partColor = (p.color || '').trim();
                if (partCut > 0 && partColor) {
                    const { available } = await getAvailableForPart(partCut, partColor, id);
                    if (available < qty) {
                        return res.status(400).json({
                            message: `رصيد غير كافٍ للقصة ${partCut} - ${partColor}.\nالمتاح: ${available}\nالمطلوب: ${qty}`,
                        });
                    }
                }
            }
        }
        const primaryCut = Array.isArray(parts) && parts.length > 0
            ? (parts[0].cut_number || 0) : (data.cut_number || 0);
        const before = await prisma_1.default.modelProduction.findUnique({ where: { id }, include: PARTS_INCLUDE });
        await prisma_1.default.modelProduction.update({ where: { id }, data: { ...data, cut_number: primaryCut } });
        if (Array.isArray(parts)) {
            await prisma_1.default.modelPart.deleteMany({ where: { model_id: id } });
            if (parts.length > 0) {
                await prisma_1.default.modelPart.createMany({
                    data: parts.map(p => ({
                        model_id: id,
                        part_type: p.part_type || '',
                        cut_number: p.cut_number || 0,
                        color: (p.color || '').trim(),
                    })),
                });
            }
        }
        const fresh = await prisma_1.default.modelProduction.findUnique({ where: { id }, include: PARTS_INCLUDE });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ModelProduction', action: 'UPDATE', record_id: id,
            before_data: before, after_data: fresh,
            description: `تعديل إنتاج موديل: ${fresh?.model_code} - ${fresh?.model_description}` });
        return res.json(fresh);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.modelProdRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.modelProduction.findUnique({ where: { id }, include: PARTS_INCLUDE });
        await prisma_1.default.modelProduction.delete({ where: { id } }); // parts cascade via FK
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ModelProduction', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف إنتاج موديل: ${before?.model_code} - ${before?.model_description}` });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== DEBTS =====
exports.debtsRouter = (0, express_1.Router)();
exports.debtsRouter.use(auth_1.authenticate);
const DEBT_INCLUDE = { payments: { orderBy: { id: 'asc' } } };
exports.debtsRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.debt.findMany({ orderBy: { id: 'asc' }, include: DEBT_INCLUDE }));
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
            include: DEBT_INCLUDE,
        });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Debts', action: 'CREATE', record_id: debt.id,
            after_data: debt, description: `إضافة دين: ${debt.name}` });
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
        const result = await prisma_1.default.debt.update({ where: { id }, data, include: DEBT_INCLUDE });
        const delta = newPaid - cur.amount_paid;
        if (delta < 0) {
            await purgePaymentLogs('debt_payment', `سداد دين: ${cur.name}`, -delta);
        }
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Debts', action: 'UPDATE', record_id: id,
            before_data: cur, after_data: result, description: `تعديل دين: ${result.name}` });
        return res.json(result);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.debtsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const cur = await prisma_1.default.debt.findUnique({ where: { id }, include: DEBT_INCLUDE });
        if (cur) {
            // Clean up PaymentLog entries linked to each payment
            const logIds = (cur.payments || []).map(p => p.payment_log_id).filter((x) => x != null);
            if (logIds.length)
                await prisma_1.default.paymentLog.deleteMany({ where: { id: { in: logIds } } });
        }
        await prisma_1.default.debt.delete({ where: { id } }); // debt_payments cascade
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Debts', action: 'DELETE', record_id: id,
            before_data: cur, description: `حذف دين: ${cur?.name}` });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ----- Debt payment sub-routes -----
exports.debtsRouter.post('/:id/payments', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const { date, amount, payment_method, description, receiver } = req.body;
        const amt = parseFloat(amount) || 0;
        if (amt <= 0)
            return res.status(400).json({ message: 'المبلغ يجب أن يكون أكبر من صفر' });
        const debt = await prisma_1.default.debt.findUnique({ where: { id } });
        if (!debt)
            return res.status(404).json({ message: 'الدين غير موجود' });
        const payDate = date || new Date().toISOString().split('T')[0];
        const log = await prisma_1.default.paymentLog.create({
            data: { date: payDate, type: 'debt_payment', amount: amt,
                receiver: receiver || '', description: `سداد دين: ${debt.name}` },
        });
        const payment = await prisma_1.default.debtPayment.create({
            data: { debt_id: id, payment_log_id: log.id, date: payDate, amount: amt,
                payment_method: payment_method || '', description: description || '',
                receiver: receiver || '', created_by: req.user?.username || '' },
        });
        const newPaid = debt.amount_paid + amt;
        await prisma_1.default.debt.update({ where: { id }, data: { amount_paid: newPaid, remaining: debt.total_amount - newPaid } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Debts', action: 'CREATE', record_id: payment.id,
            after_data: payment, description: `دفعة دين: ${debt.name} - ${amt}` });
        return res.status(201).json(payment);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.debtsRouter.put('/:id/payments/:pid', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    const pid = parseInt(req.params.pid);
    try {
        const { date, amount, payment_method, description } = req.body;
        const newAmt = parseFloat(amount) || 0;
        const [debt, payment] = await Promise.all([
            prisma_1.default.debt.findUnique({ where: { id } }),
            prisma_1.default.debtPayment.findUnique({ where: { id: pid } }),
        ]);
        if (!debt || !payment)
            return res.status(404).json({ message: 'غير موجود' });
        const delta = newAmt - payment.amount;
        const updated = await prisma_1.default.debtPayment.update({
            where: { id: pid },
            data: { date: date || payment.date, amount: newAmt,
                payment_method: payment_method ?? payment.payment_method,
                description: description ?? payment.description },
        });
        if (payment.payment_log_id) {
            await prisma_1.default.paymentLog.update({ where: { id: payment.payment_log_id }, data: { amount: newAmt } });
        }
        const newPaid = debt.amount_paid + delta;
        await prisma_1.default.debt.update({ where: { id }, data: { amount_paid: newPaid, remaining: debt.total_amount - newPaid } });
        return res.json(updated);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.debtsRouter.delete('/:id/payments/:pid', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    const pid = parseInt(req.params.pid);
    try {
        const [debt, payment] = await Promise.all([
            prisma_1.default.debt.findUnique({ where: { id } }),
            prisma_1.default.debtPayment.findUnique({ where: { id: pid } }),
        ]);
        if (!debt || !payment)
            return res.status(404).json({ message: 'غير موجود' });
        await prisma_1.default.debtPayment.delete({ where: { id: pid } });
        if (payment.payment_log_id) {
            await prisma_1.default.paymentLog.delete({ where: { id: payment.payment_log_id } }).catch(() => { });
        }
        const newPaid = Math.max(0, debt.amount_paid - payment.amount);
        await prisma_1.default.debt.update({ where: { id }, data: { amount_paid: newPaid, remaining: debt.total_amount - newPaid } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Debts', action: 'DELETE', record_id: pid,
            before_data: payment, description: `حذف دفعة دين: ${debt.name} - ${payment.amount}` });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ===== CLIENT ACCOUNTS =====
exports.clientAccountsRouter = (0, express_1.Router)();
exports.clientAccountsRouter.use(auth_1.authenticate);
const ACCT_INCLUDE = { payments: { orderBy: { id: 'asc' } } };
exports.clientAccountsRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.clientAccount.findMany({ orderBy: { id: 'asc' }, include: ACCT_INCLUDE }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.clientAccountsRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const data = req.body;
        const rec = await prisma_1.default.clientAccount.create({
            data: { ...data, remaining: (data.total_amount || 0) - (data.amount_paid || 0) },
            include: ACCT_INCLUDE,
        });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ClientAccounts', action: 'CREATE', record_id: rec.id,
            after_data: rec, description: `إضافة حساب عميل: ${rec.client_name}` });
        return res.status(201).json(rec);
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
        const result = await prisma_1.default.clientAccount.update({ where: { id }, data, include: ACCT_INCLUDE });
        const delta = newPaid - cur.amount_paid;
        if (delta < 0) {
            await purgePaymentLogs('client_payment', `دفعة عميل: ${cur.client_name}`, -delta);
        }
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ClientAccounts', action: 'UPDATE', record_id: id,
            before_data: cur, after_data: result, description: `تعديل حساب عميل: ${result.client_name}` });
        return res.json(result);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.clientAccountsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const cur = await prisma_1.default.clientAccount.findUnique({ where: { id }, include: ACCT_INCLUDE });
        if (cur) {
            const logIds = (cur.payments || []).map(p => p.payment_log_id).filter((x) => x != null);
            if (logIds.length)
                await prisma_1.default.paymentLog.deleteMany({ where: { id: { in: logIds } } });
        }
        await prisma_1.default.clientAccount.delete({ where: { id } }); // client_account_payments cascade
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ClientAccounts', action: 'DELETE', record_id: id,
            before_data: cur, description: `حذف حساب عميل: ${cur?.client_name}` });
        return res.json({ message: 'تم' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// ----- Client account payment sub-routes -----
exports.clientAccountsRouter.post('/:id/payments', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const { date, amount, payment_method, description, receiver } = req.body;
        const amt = parseFloat(amount) || 0;
        if (amt <= 0)
            return res.status(400).json({ message: 'المبلغ يجب أن يكون أكبر من صفر' });
        const account = await prisma_1.default.clientAccount.findUnique({ where: { id } });
        if (!account)
            return res.status(404).json({ message: 'الحساب غير موجود' });
        const payDate = date || new Date().toISOString().split('T')[0];
        const log = await prisma_1.default.paymentLog.create({
            data: { date: payDate, type: 'client_payment', amount: amt,
                receiver: receiver || '', description: `دفعة عميل: ${account.client_name} - ${account.model_name}` },
        });
        const payment = await prisma_1.default.clientAccountPayment.create({
            data: { account_id: id, payment_log_id: log.id, date: payDate, amount: amt,
                payment_method: payment_method || '', description: description || '',
                receiver: receiver || '', created_by: req.user?.username || '' },
        });
        const newPaid = account.amount_paid + amt;
        await prisma_1.default.clientAccount.update({ where: { id }, data: { amount_paid: newPaid, remaining: account.total_amount - newPaid } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ClientAccounts', action: 'CREATE', record_id: payment.id,
            after_data: payment, description: `دفعة عميل: ${account.client_name} - ${amt}` });
        return res.status(201).json(payment);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.clientAccountsRouter.put('/:id/payments/:pid', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    const pid = parseInt(req.params.pid);
    try {
        const { date, amount, payment_method, description } = req.body;
        const newAmt = parseFloat(amount) || 0;
        const [account, payment] = await Promise.all([
            prisma_1.default.clientAccount.findUnique({ where: { id } }),
            prisma_1.default.clientAccountPayment.findUnique({ where: { id: pid } }),
        ]);
        if (!account || !payment)
            return res.status(404).json({ message: 'غير موجود' });
        const delta = newAmt - payment.amount;
        const updated = await prisma_1.default.clientAccountPayment.update({
            where: { id: pid },
            data: { date: date || payment.date, amount: newAmt,
                payment_method: payment_method ?? payment.payment_method,
                description: description ?? payment.description },
        });
        if (payment.payment_log_id) {
            await prisma_1.default.paymentLog.update({ where: { id: payment.payment_log_id }, data: { amount: newAmt } });
        }
        const newPaid = account.amount_paid + delta;
        await prisma_1.default.clientAccount.update({ where: { id }, data: { amount_paid: newPaid, remaining: account.total_amount - newPaid } });
        return res.json(updated);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.clientAccountsRouter.delete('/:id/payments/:pid', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    const pid = parseInt(req.params.pid);
    try {
        const [account, payment] = await Promise.all([
            prisma_1.default.clientAccount.findUnique({ where: { id } }),
            prisma_1.default.clientAccountPayment.findUnique({ where: { id: pid } }),
        ]);
        if (!account || !payment)
            return res.status(404).json({ message: 'غير موجود' });
        await prisma_1.default.clientAccountPayment.delete({ where: { id: pid } });
        if (payment.payment_log_id) {
            await prisma_1.default.paymentLog.delete({ where: { id: payment.payment_log_id } }).catch(() => { });
        }
        const newPaid = Math.max(0, account.amount_paid - payment.amount);
        await prisma_1.default.clientAccount.update({ where: { id }, data: { amount_paid: newPaid, remaining: account.total_amount - newPaid } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'ClientAccounts', action: 'DELETE', record_id: pid,
            before_data: payment, description: `حذف دفعة عميل: ${account.client_name} - ${payment.amount}` });
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
        const rec = await prisma_1.default.returnItem.create({ data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Returns', action: 'CREATE', record_id: rec.id,
            after_data: rec, description: `إضافة مرتجع: ${rec.client_name} - ${rec.model_code}` });
        return res.status(201).json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.returnsRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.returnItem.findUnique({ where: { id } });
        const rec = await prisma_1.default.returnItem.update({ where: { id }, data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Returns', action: 'UPDATE', record_id: id,
            before_data: before, after_data: rec, description: `تعديل مرتجع: ${rec.client_name} - ${rec.model_code}` });
        return res.json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.returnsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.returnItem.findUnique({ where: { id } });
        await prisma_1.default.returnItem.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Returns', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف مرتجع: ${before?.client_name} - ${before?.model_code}` });
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
        const rec = await prisma_1.default.paymentLog.create({ data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'PaymentLogs', action: 'CREATE', record_id: rec.id,
            after_data: rec, description: `إضافة سجل دفع: ${rec.description} - ${rec.amount}` });
        return res.status(201).json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.paymentLogRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.paymentLog.findUnique({ where: { id } });
        await prisma_1.default.paymentLog.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'PaymentLogs', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف سجل دفع: ${before?.description} - ${before?.amount}` });
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
        const created = await prisma_1.default.marketer.create({ data: { name } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Marketers', action: 'CREATE', record_id: created.id,
            after_data: created, description: `إضافة مسوق: ${name}` });
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
        const before = await prisma_1.default.marketer.findUnique({ where: { name } });
        await prisma_1.default.marketer.delete({ where: { name } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'Marketers', action: 'DELETE', record_id: before?.id ?? name,
            before_data: before, description: `حذف مسوق: ${name}` });
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
// ─── rebuildFabricInventory ────────────────────────────────────────────────
// Admin/repair utility: recomputes warehouse from ALL purchase records only.
// NOTE: this intentionally overwrites any qty that came from direct entry.
// Use for data-repair only; normal add/edit/delete use incremental WAC below.
async function rebuildFabricInventory(client, fabricType, color) {
    const warehouse = await client.fabricWarehouse.findFirst({
        where: { material_type: fabricType, color },
    });
    if (!warehouse)
        return;
    const purchases = await client.fabricPurchase.findMany({
        where: { fabric_type: fabricType, color },
        orderBy: { id: 'asc' },
    });
    if (purchases.length === 0) {
        await client.fabricWarehouse.update({
            where: { id: warehouse.id },
            data: { qty_in: 0, avg_cost_per_kg: 0, last_purchase_price: 0 },
        });
        return;
    }
    const totalQty = purchases.reduce((s, p) => s + p.quantity_kg, 0);
    const totalValue = purchases.reduce((s, p) => s + p.quantity_kg * p.price_per_kg, 0);
    const wac = Math.round((totalValue / totalQty) * 100) / 100;
    const lastPrice = purchases[purchases.length - 1].price_per_kg;
    await client.fabricWarehouse.update({
        where: { id: warehouse.id },
        data: { qty_in: totalQty, avg_cost_per_kg: wac, last_purchase_price: lastPrice },
    });
}
exports.fabricPurchasesRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.fabricPurchase.findMany({ orderBy: { id: 'desc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
// POST — add purchase: INCREASES existing warehouse qty, updates WAC incrementally.
// Incremental formula: newWAC = (existingQty × existingAvg + purchaseQty × price) / newQty
// This preserves any stock that was entered via "إضافة وارد" (direct entry).
exports.fabricPurchasesRouter.post('/', auth_1.requireManager, async (req, res) => {
    try {
        const { date, fabric_type, color, quantity_kg, price_per_kg, supplier, invoice_no, notes } = req.body;
        const qty = parseFloat(quantity_kg) || 0;
        const price = parseFloat(price_per_kg) || 0;
        if (!fabric_type || qty <= 0 || price <= 0) {
            return res.status(400).json({ message: 'يرجى تحديد الصنف والكمية والسعر' });
        }
        const cleanColor = (color || '').trim();
        const purchase = await prisma_1.default.$transaction(async (tx) => {
            const created = await tx.fabricPurchase.create({
                data: {
                    date, fabric_type, color: cleanColor,
                    quantity_kg: qty, price_per_kg: price,
                    total_cost: Math.round(qty * price * 100) / 100,
                    supplier: supplier || '', invoice_no: invoice_no || '', notes: notes || '',
                },
            });
            const warehouse = await tx.fabricWarehouse.findFirst({
                where: { material_type: fabric_type, color: cleanColor },
            });
            if (!warehouse) {
                // First entry for this type+color — create the warehouse row
                await tx.fabricWarehouse.create({
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
            else {
                // Existing row — add purchase qty and blend WAC incrementally
                const existingAvg = warehouse.avg_cost_per_kg > 0
                    ? warehouse.avg_cost_per_kg
                    : warehouse.cost_per_kg;
                const newQty = warehouse.qty_in + qty;
                const newWAC = Math.round(((warehouse.qty_in * existingAvg + qty * price) / newQty) * 100) / 100;
                await tx.fabricWarehouse.update({
                    where: { id: warehouse.id },
                    data: {
                        qty_in: newQty,
                        avg_cost_per_kg: newWAC,
                        last_purchase_price: price,
                    },
                });
            }
            return created;
        });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'FabricPurchases', action: 'CREATE', record_id: purchase.id,
            after_data: purchase, description: `إضافة مشترى قماش: ${purchase.fabric_type} - ${purchase.color}` });
        return res.status(201).json(purchase);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في حفظ المشترى' });
    }
});
// PUT — edit purchase: adjusts warehouse qty and WAC incrementally.
// Reverse the old contribution, apply the new one:
// newQty   = warehouseQty - oldQty + newQty
// newValue = warehouseQty × existingAvg - oldQty × oldPrice + newQty × newPrice
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
        const before = await prisma_1.default.fabricPurchase.findUnique({ where: { id } });
        const result = await prisma_1.default.$transaction(async (tx) => {
            const existing = await tx.fabricPurchase.findUnique({ where: { id } });
            if (!existing)
                throw new Error('NOT_FOUND');
            const warehouse = await tx.fabricWarehouse.findFirst({
                where: { material_type: existing.fabric_type, color: existing.color },
            });
            if (!warehouse)
                throw new Error('WAREHOUSE_NOT_FOUND');
            const deltaQty = newQty - existing.quantity_kg;
            // Safety: if reducing qty, verify cutting consumption is not exceeded
            if (deltaQty < 0) {
                const cutting = await tx.cuttingOrder.findMany({
                    where: { material_type: existing.fabric_type, color: existing.color },
                });
                const totalConsumed = cutting.reduce((s, c) => s + c.kg_consumed, 0);
                if (warehouse.qty_in + deltaQty < totalConsumed)
                    throw new Error('CONSUMED');
            }
            // Update the purchase record
            const updated = await tx.fabricPurchase.update({
                where: { id },
                data: {
                    date, fabric_type, color: cleanColor,
                    quantity_kg: newQty, price_per_kg: newPrice,
                    total_cost: Math.round(newQty * newPrice * 100) / 100,
                    supplier: supplier || '', invoice_no: invoice_no || '', notes: notes || '',
                },
            });
            // Incremental WAC adjustment: undo old contribution, apply new one
            const existingAvg = warehouse.avg_cost_per_kg > 0 ? warehouse.avg_cost_per_kg : warehouse.cost_per_kg;
            const newTotalQty = warehouse.qty_in + deltaQty;
            const newTotalVal = warehouse.qty_in * existingAvg
                - existing.quantity_kg * existing.price_per_kg
                + newQty * newPrice;
            if (newTotalQty <= 0) {
                await tx.fabricWarehouse.update({
                    where: { id: warehouse.id },
                    data: { qty_in: 0, avg_cost_per_kg: 0, last_purchase_price: 0 },
                });
            }
            else {
                const newWAC = Math.round((newTotalVal / newTotalQty) * 100) / 100;
                await tx.fabricWarehouse.update({
                    where: { id: warehouse.id },
                    data: { qty_in: newTotalQty, avg_cost_per_kg: newWAC, last_purchase_price: newPrice },
                });
            }
            return updated;
        });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'FabricPurchases', action: 'UPDATE', record_id: id,
            before_data: before, after_data: result, description: `تعديل مشترى قماش: ${result.fabric_type} - ${result.color}` });
        return res.json(result);
    }
    catch (err) {
        if (err instanceof Error) {
            if (err.message === 'NOT_FOUND')
                return res.status(404).json({ message: 'العملية غير موجودة' });
            if (err.message === 'CONSUMED')
                return res.status(400).json({ message: 'لا يمكن تقليل هذه العملية لأن جزءاً من الكمية تم استهلاكه بالفعل.' });
            if (err.message === 'WAREHOUSE_NOT_FOUND')
                return res.status(404).json({ message: 'سجل المخزون غير موجود' });
        }
        console.error(err);
        return res.status(500).json({ message: 'خطأ في تعديل المشترى' });
    }
});
// DELETE — remove purchase: subtracts its qty from warehouse and adjusts WAC.
// Reverse formula: newValue = warehouseQty × existingAvg - deletedQty × deletedPrice
exports.fabricPurchasesRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const before = await prisma_1.default.fabricPurchase.findUnique({ where: { id } });
        await prisma_1.default.$transaction(async (tx) => {
            const existing = await tx.fabricPurchase.findUnique({ where: { id } });
            if (!existing)
                throw new Error('NOT_FOUND');
            const warehouse = await tx.fabricWarehouse.findFirst({
                where: { material_type: existing.fabric_type, color: existing.color },
            });
            if (!warehouse)
                throw new Error('WAREHOUSE_NOT_FOUND');
            const newQty = warehouse.qty_in - existing.quantity_kg;
            // Safety: ensure remaining stock covers cutting consumption
            const cutting = await tx.cuttingOrder.findMany({
                where: { material_type: existing.fabric_type, color: existing.color },
            });
            if (newQty < cutting.reduce((s, c) => s + c.kg_consumed, 0))
                throw new Error('CONSUMED');
            await tx.fabricPurchase.delete({ where: { id } });
            if (newQty <= 0) {
                await tx.fabricWarehouse.update({
                    where: { id: warehouse.id },
                    data: { qty_in: 0, avg_cost_per_kg: 0, last_purchase_price: 0 },
                });
            }
            else {
                const existingAvg = warehouse.avg_cost_per_kg > 0 ? warehouse.avg_cost_per_kg : warehouse.cost_per_kg;
                const newValue = warehouse.qty_in * existingAvg - existing.quantity_kg * existing.price_per_kg;
                const newWAC = Math.round((newValue / newQty) * 100) / 100;
                // Find the most-recent remaining purchase for last_purchase_price
                const lastRemaining = await tx.fabricPurchase.findFirst({
                    where: { fabric_type: existing.fabric_type, color: existing.color },
                    orderBy: { id: 'desc' },
                });
                await tx.fabricWarehouse.update({
                    where: { id: warehouse.id },
                    data: {
                        qty_in: newQty,
                        avg_cost_per_kg: newWAC,
                        last_purchase_price: lastRemaining?.price_per_kg ?? warehouse.cost_per_kg,
                    },
                });
            }
        });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'FabricPurchases', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف مشترى قماش: ${before?.fabric_type} - ${before?.color}` });
        return res.json({ message: 'تم الحذف' });
    }
    catch (err) {
        if (err instanceof Error) {
            if (err.message === 'NOT_FOUND')
                return res.status(404).json({ message: 'العملية غير موجودة' });
            if (err.message === 'CONSUMED')
                return res.status(400).json({ message: 'لا يمكن حذف هذه العملية لأن جزءاً من الكمية تم استهلاكه بالفعل.' });
            if (err.message === 'WAREHOUSE_NOT_FOUND')
                return res.status(404).json({ message: 'سجل المخزون غير موجود' });
        }
        console.error(err);
        return res.status(500).json({ message: 'خطأ في حذف المشترى' });
    }
});
// POST /rebuild — admin utility: rebuild a specific warehouse row from full purchase history.
// Overwrites any qty that came from direct "إضافة وارد" entries.
exports.fabricPurchasesRouter.post('/rebuild', auth_1.requireManager, async (req, res) => {
    try {
        const { fabric_type, color } = req.body;
        if (!fabric_type)
            return res.status(400).json({ message: 'fabric_type مطلوب' });
        await rebuildFabricInventory(prisma_1.default, fabric_type, (color || '').trim());
        return res.json({ message: 'تم إعادة الحساب من سجل المشتريات' });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في إعادة الحساب' });
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
        const rec = await prisma_1.default.fixedAsset.create({ data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'FixedAssets', action: 'CREATE', record_id: rec.id,
            after_data: rec, description: `إضافة أصل ثابت: ${rec.name}` });
        return res.status(201).json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ في الإضافة' });
    }
});
exports.fixedAssetsRouter.put('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.fixedAsset.findUnique({ where: { id } });
        const rec = await prisma_1.default.fixedAsset.update({ where: { id }, data: req.body });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'FixedAssets', action: 'UPDATE', record_id: id,
            before_data: before, after_data: rec, description: `تعديل أصل ثابت: ${rec.name}` });
        return res.json(rec);
    }
    catch {
        return res.status(500).json({ message: 'خطأ في التحديث' });
    }
});
exports.fixedAssetsRouter.delete('/:id', auth_1.requireManager, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const before = await prisma_1.default.fixedAsset.findUnique({ where: { id } });
        await prisma_1.default.fixedAsset.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'FixedAssets', action: 'DELETE', record_id: id,
            before_data: before, description: `حذف أصل ثابت: ${before?.name}` });
        return res.json({ message: 'تم الحذف' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ في الحذف' });
    }
});
// ===== PRINT ORDERS =====
exports.printOrdersRouter = (0, express_1.Router)();
exports.printOrdersRouter.use(auth_1.authenticate);
// Helper: compute available quantity for a single ready-stock item
async function computeAvailable(stock) {
    const [modelProds, sales, returns_] = await Promise.all([
        prisma_1.default.modelProduction.findMany(),
        prisma_1.default.sale.findMany(),
        prisma_1.default.returnItem.findMany(),
    ]);
    const mc = stock.model_code;
    const col = stock.color || '';
    const newProd = modelProds
        .filter(mp => mp.model_code === mc && (mp.color || '') === col)
        .reduce((s, mp) => s + mp.qty_received, 0);
    const totalSales = sales
        .filter(s => s.order_status !== 'تم الحجز' && s.order_status !== 'تم الإلغاء')
        .reduce((s, sale) => s + [
        { code: sale.model1_code, qty: sale.model1_qty, color: sale.model1_color },
        { code: sale.model2_code, qty: sale.model2_qty, color: sale.model2_color },
        { code: sale.model3_code, qty: sale.model3_qty, color: sale.model3_color },
        { code: sale.model4_code, qty: sale.model4_qty, color: sale.model4_color },
        { code: sale.model5_code, qty: sale.model5_qty, color: sale.model5_color },
    ].reduce((ss, { code, qty, color }) => code === mc && (color || '') === col ? ss + qty : ss, 0), 0);
    const returnQty = returns_
        .filter(r => r.model_code === mc && (r.model_color || '') === col)
        .reduce((s, r) => s + r.model_qty, 0);
    const actual = stock.opening_balance + newProd - totalSales + returnQty;
    return actual - stock.reserved_quantity;
}
exports.printOrdersRouter.get('/', async (_req, res) => {
    try {
        return res.json(await prisma_1.default.printOrder.findMany({ orderBy: { id: 'desc' } }));
    }
    catch {
        return res.status(500).json({ message: 'خطأ' });
    }
});
exports.printOrdersRouter.post('/', auth_1.requireManager, async (req, res) => {
    const { source_stock_id, quantity, date, new_model_code, new_product_name, new_color, print_type, print_cost_per_piece, notes, } = req.body;
    if (!source_stock_id || !quantity || !new_model_code || !new_product_name) {
        return res.status(400).json({ message: 'بيانات ناقصة' });
    }
    try {
        const source = await prisma_1.default.readyStock.findUnique({ where: { id: parseInt(source_stock_id) } });
        if (!source)
            return res.status(404).json({ message: 'الصنف المصدر غير موجود' });
        const available = await computeAvailable(source);
        const qty = parseInt(quantity);
        if (qty <= 0)
            return res.status(400).json({ message: 'الكمية يجب أن تكون أكبر من صفر' });
        if (qty > available) {
            return res.status(400).json({
                message: `الكمية المطلوبة (${qty}) تتجاوز المتاح (${available})`,
            });
        }
        const blank_unit_cost = source.cost_per_piece;
        const print_cost = parseFloat(print_cost_per_piece) || 0;
        const final_unit_cost = blank_unit_cost + print_cost;
        const count = await prisma_1.default.printOrder.count();
        const order_number = `PO-${String(count + 1).padStart(4, '0')}`;
        const dest_color = (new_color || '').trim() || source.color || '';
        const orderDate = date || new Date().toISOString().slice(0, 10);
        const result = await prisma_1.default.$transaction(async (tx) => {
            await tx.readyStock.update({
                where: { id: source.id },
                data: { opening_balance: { decrement: qty } },
            });
            const dest = await tx.readyStock.create({
                data: {
                    model_code: new_model_code,
                    product_name: new_product_name,
                    color: dest_color,
                    opening_balance: qty,
                    cost_per_piece: final_unit_cost,
                    location: source.location || '',
                    reserved_quantity: 0,
                },
            });
            const po = await tx.printOrder.create({
                data: {
                    order_number,
                    date: orderDate,
                    source_stock_id: source.id,
                    source_model_code: source.model_code,
                    source_product_name: source.product_name,
                    source_color: source.color || '',
                    quantity: qty,
                    blank_unit_cost,
                    print_cost_per_piece: print_cost,
                    final_unit_cost,
                    dest_stock_id: dest.id,
                    dest_model_code: new_model_code,
                    dest_product_name: new_product_name,
                    dest_color,
                    print_type: print_type || '',
                    notes: notes || '',
                    created_by: req.user?.username || '',
                },
            });
            return { dest, po };
        });
        (0, auditHelper_1.logAudit)({ user: req.user, module: 'PrintOrders', action: 'CREATE', record_id: result.po.id,
            after_data: result.po,
            description: `أمر طباعة ${order_number}: ${source.model_code} → ${new_model_code} (${qty} قطعة)` });
        return res.status(201).json(result.po);
    }
    catch (e) {
        console.error('Print order error:', e);
        return res.status(500).json({ message: 'خطأ في تنفيذ أمر الطباعة' });
    }
});
//# sourceMappingURL=entities.js.map