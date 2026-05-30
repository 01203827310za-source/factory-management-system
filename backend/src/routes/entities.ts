// ============================================
// All Entity Routes (Expenses, Stock, Fabric, 
// Accessories, Cutting, ModelProd, Debts, 
// ClientAccounts, Returns, PaymentLog, Marketers)
// ============================================

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';

// ===== EXPENSES =====
export const expensesRouter = Router();
expensesRouter.use(authenticate);

expensesRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.expenseRevenue.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ في جلب البيانات' }); }
});
expensesRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.expenseRevenue.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ في الإضافة' }); }
});
expensesRouter.put('/:id', requireManager, async (req, res) => {
  try { return res.json(await prisma.expenseRevenue.update({ where: { id: parseInt(req.params.id as string) }, data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ في التحديث' }); }
});
expensesRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.expenseRevenue.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم الحذف' }); }
  catch { return res.status(500).json({ message: 'خطأ في الحذف' }); }
});

// ===== READY STOCK =====
export const readyStockRouter = Router();
readyStockRouter.use(authenticate);

readyStockRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.readyStock.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
readyStockRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.readyStock.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
readyStockRouter.put('/:id', requireManager, async (req, res) => {
  try { return res.json(await prisma.readyStock.update({ where: { id: parseInt(req.params.id as string) }, data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
readyStockRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.readyStock.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم' }); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== FABRIC WAREHOUSE =====
export const fabricRouter = Router();
fabricRouter.use(authenticate);

fabricRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.fabricWarehouse.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
fabricRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.fabricWarehouse.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
fabricRouter.put('/:id', requireManager, async (req, res) => {
  try { return res.json(await prisma.fabricWarehouse.update({ where: { id: parseInt(req.params.id as string) }, data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
fabricRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.fabricWarehouse.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم' }); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== ACCESSORIES =====
export const accessoriesRouter = Router();
accessoriesRouter.use(authenticate);

accessoriesRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.accessoriesWarehouse.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
accessoriesRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.accessoriesWarehouse.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
accessoriesRouter.put('/:id', requireManager, async (req, res) => {
  try { return res.json(await prisma.accessoriesWarehouse.update({ where: { id: parseInt(req.params.id as string) }, data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
accessoriesRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.accessoriesWarehouse.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم' }); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== CUTTING ORDERS =====
export const cuttingRouter = Router();
cuttingRouter.use(authenticate);

cuttingRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.cuttingOrder.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
cuttingRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.cuttingOrder.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
cuttingRouter.put('/:id', requireManager, async (req, res) => {
  try { return res.json(await prisma.cuttingOrder.update({ where: { id: parseInt(req.params.id as string) }, data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
cuttingRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.cuttingOrder.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم' }); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== MODEL PRODUCTION =====
export const modelProdRouter = Router();
modelProdRouter.use(authenticate);

modelProdRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.modelProduction.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
modelProdRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.modelProduction.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
modelProdRouter.put('/:id', requireManager, async (req, res) => {
  try { return res.json(await prisma.modelProduction.update({ where: { id: parseInt(req.params.id as string) }, data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
modelProdRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.modelProduction.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم' }); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== DEBTS =====
export const debtsRouter = Router();
debtsRouter.use(authenticate);

debtsRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.debt.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
debtsRouter.post('/', requireManager, async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const debt = await prisma.debt.create({
      data: { ...data, remaining: (data.total_amount || 0) - (data.amount_paid || 0) },
    });
    return res.status(201).json(debt);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
debtsRouter.put('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const data = req.body;
    if (data.total_amount !== undefined || data.amount_paid !== undefined) {
      const cur = await prisma.debt.findUnique({ where: { id } });
      const total = data.total_amount ?? cur?.total_amount ?? 0;
      const paid = data.amount_paid ?? cur?.amount_paid ?? 0;
      data.remaining = total - paid;
    }
    return res.json(await prisma.debt.update({ where: { id }, data }));
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
debtsRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.debt.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم' }); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== CLIENT ACCOUNTS =====
export const clientAccountsRouter = Router();
clientAccountsRouter.use(authenticate);

clientAccountsRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.clientAccount.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
clientAccountsRouter.post('/', requireManager, async (req: Request, res: Response) => {
  try {
    const data = req.body;
    return res.status(201).json(await prisma.clientAccount.create({
      data: { ...data, remaining: (data.total_amount || 0) - (data.amount_paid || 0) },
    }));
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
clientAccountsRouter.put('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const data = req.body;
    if (data.total_amount !== undefined || data.amount_paid !== undefined) {
      const cur = await prisma.clientAccount.findUnique({ where: { id } });
      const total = data.total_amount ?? cur?.total_amount ?? 0;
      const paid = data.amount_paid ?? cur?.amount_paid ?? 0;
      data.remaining = total - paid;
    }
    return res.json(await prisma.clientAccount.update({ where: { id }, data }));
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
clientAccountsRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.clientAccount.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم' }); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== RETURNS =====
export const returnsRouter = Router();
returnsRouter.use(authenticate);

returnsRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.returnItem.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
returnsRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.returnItem.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
returnsRouter.put('/:id', requireManager, async (req, res) => {
  try { return res.json(await prisma.returnItem.update({ where: { id: parseInt(req.params.id as string) }, data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
returnsRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.returnItem.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم' }); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== PAYMENT LOGS =====
export const paymentLogRouter = Router();
paymentLogRouter.use(authenticate);

paymentLogRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.paymentLog.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
paymentLogRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.paymentLog.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
paymentLogRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.paymentLog.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم' }); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== MARKETERS =====
export const marketersRouter = Router();
marketersRouter.use(authenticate);

marketersRouter.get('/', async (_req, res) => {
  try {
    const marketers = await prisma.marketer.findMany({ orderBy: { id: 'asc' } });
    return res.json(marketers.map(m => m.name));
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
marketersRouter.post('/', requireManager, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'اسم المسوق مطلوب' });
    const existing = await prisma.marketer.findUnique({ where: { name } });
    if (existing) return res.status(400).json({ message: 'المسوق موجود بالفعل' });
    await prisma.marketer.create({ data: { name } });
    const all = await prisma.marketer.findMany({ orderBy: { id: 'asc' } });
    return res.status(201).json(all.map(m => m.name));
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
marketersRouter.delete('/:name', requireManager, async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name as string);
    await prisma.marketer.delete({ where: { name } });
    const all = await prisma.marketer.findMany({ orderBy: { id: 'asc' } });
    return res.json(all.map(m => m.name));
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
// ===== FIXED ASSETS =====
export const fixedAssetsRouter = Router();
fixedAssetsRouter.use(authenticate);

fixedAssetsRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.asset.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ في جلب البيانات' }); }
});
fixedAssetsRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.asset.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ في الإضافة' }); }
});
fixedAssetsRouter.put('/:id', requireManager, async (req, res) => {
  try { return res.json(await prisma.asset.update({ where: { id: parseInt(req.params.id as string) }, data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ في التحديث' }); }
});
fixedAssetsRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.asset.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم الحذف' }); }
  catch { return res.status(500).json({ message: 'خطأ في الحذف' }); }
});