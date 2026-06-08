// ============================================
// All Entity Routes (Expenses, Stock, Fabric, 
// Accessories, Cutting, ModelProd, Debts, 
// ClientAccounts, Returns, PaymentLog, Marketers)
// ============================================

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';

// Remove PaymentLog entries when a debt/client-account paid amount is reduced.
// Deletes from newest first; if a single log exceeds the remaining delta, trims it.
async function purgePaymentLogs(type: string, descPrefix: string, amountToRemove: number) {
  if (amountToRemove <= 0) return;
  const logs = await prisma.paymentLog.findMany({
    where: { type, description: { startsWith: descPrefix } },
    orderBy: { id: 'desc' },
  });
  let toRemove = amountToRemove;
  for (const log of logs) {
    if (toRemove <= 0) break;
    if (log.amount <= toRemove) {
      await prisma.paymentLog.delete({ where: { id: log.id } });
      toRemove -= log.amount;
    } else {
      await prisma.paymentLog.update({ where: { id: log.id }, data: { amount: log.amount - toRemove } });
      toRemove = 0;
    }
  }
}

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
  try {
    // Strip reserved_quantity — it is managed exclusively by the reservation workflow
    const { reserved_quantity: _ignored, ...safeData } = req.body;
    return res.json(await prisma.readyStock.update({
      where: { id: parseInt(req.params.id as string) },
      data: safeData,
    }));
  } catch { return res.status(500).json({ message: 'خطأ' }); }
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
    const cur = await prisma.debt.findUnique({ where: { id } });
    if (!cur) return res.status(404).json({ message: 'الدين غير موجود' });
    const newPaid = data.amount_paid !== undefined ? Number(data.amount_paid) : cur.amount_paid;
    const newTotal = data.total_amount !== undefined ? Number(data.total_amount) : cur.total_amount;
    data.remaining = newTotal - newPaid;
    const result = await prisma.debt.update({ where: { id }, data });
    const delta = newPaid - cur.amount_paid;
    if (delta < 0) {
      await purgePaymentLogs('debt_payment', `سداد دين: ${cur.name}`, -delta);
    }
    return res.json(result);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
debtsRouter.delete('/:id', requireManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const cur = await prisma.debt.findUnique({ where: { id } });
    if (cur && cur.amount_paid > 0) {
      await prisma.paymentLog.deleteMany({
        where: { type: 'debt_payment', description: { startsWith: `سداد دين: ${cur.name}` } },
      });
    }
    await prisma.debt.delete({ where: { id } });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
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
    const cur = await prisma.clientAccount.findUnique({ where: { id } });
    if (!cur) return res.status(404).json({ message: 'الحساب غير موجود' });
    const newPaid = data.amount_paid !== undefined ? Number(data.amount_paid) : cur.amount_paid;
    const newTotal = data.total_amount !== undefined ? Number(data.total_amount) : cur.total_amount;
    data.remaining = newTotal - newPaid;
    const result = await prisma.clientAccount.update({ where: { id }, data });
    const delta = newPaid - cur.amount_paid;
    if (delta < 0) {
      await purgePaymentLogs('client_payment', `دفعة عميل: ${cur.client_name}`, -delta);
    }
    return res.json(result);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
clientAccountsRouter.delete('/:id', requireManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const cur = await prisma.clientAccount.findUnique({ where: { id } });
    if (cur && cur.amount_paid > 0) {
      await prisma.paymentLog.deleteMany({
        where: { type: 'client_payment', description: { startsWith: `دفعة عميل: ${cur.client_name}` } },
      });
    }
    await prisma.clientAccount.delete({ where: { id } });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
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
// ===== FABRIC PURCHASES =====
export const fabricPurchasesRouter = Router();
fabricPurchasesRouter.use(authenticate);

// Transaction client type
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ─── rebuildFabricInventory ────────────────────────────────────────────────
// Admin/repair utility: recomputes warehouse from ALL purchase records only.
// NOTE: this intentionally overwrites any qty that came from direct entry.
// Use for data-repair only; normal add/edit/delete use incremental WAC below.
export async function rebuildFabricInventory(
  client: TxClient | typeof prisma,
  fabricType: string,
  color: string,
): Promise<void> {
  const warehouse = await client.fabricWarehouse.findFirst({
    where: { material_type: fabricType, color },
  });
  if (!warehouse) return;

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

  const totalQty   = purchases.reduce((s, p) => s + p.quantity_kg, 0);
  const totalValue = purchases.reduce((s, p) => s + p.quantity_kg * p.price_per_kg, 0);
  const wac        = Math.round((totalValue / totalQty) * 100) / 100;
  const lastPrice  = purchases[purchases.length - 1].price_per_kg;

  await client.fabricWarehouse.update({
    where: { id: warehouse.id },
    data: { qty_in: totalQty, avg_cost_per_kg: wac, last_purchase_price: lastPrice },
  });
}

fabricPurchasesRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.fabricPurchase.findMany({ orderBy: { id: 'desc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});

// POST — add purchase: INCREASES existing warehouse qty, updates WAC incrementally.
// Incremental formula: newWAC = (existingQty × existingAvg + purchaseQty × price) / newQty
// This preserves any stock that was entered via "إضافة وارد" (direct entry).
fabricPurchasesRouter.post('/', requireManager, async (req: Request, res: Response) => {
  try {
    const { date, fabric_type, color, quantity_kg, price_per_kg, supplier, invoice_no, notes } = req.body;
    const qty   = parseFloat(quantity_kg)  || 0;
    const price = parseFloat(price_per_kg) || 0;
    if (!fabric_type || qty <= 0 || price <= 0) {
      return res.status(400).json({ message: 'يرجى تحديد الصنف والكمية والسعر' });
    }
    const cleanColor = (color || '').trim();

    const purchase = await prisma.$transaction(async (tx) => {
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
            material_type:       fabric_type,
            color:               cleanColor,
            qty_in:              qty,
            cost_per_kg:         price,
            avg_cost_per_kg:     price,
            last_purchase_price: price,
          },
        });
      } else {
        // Existing row — add purchase qty and blend WAC incrementally
        const existingAvg = warehouse.avg_cost_per_kg > 0
          ? warehouse.avg_cost_per_kg
          : warehouse.cost_per_kg;
        const newQty = warehouse.qty_in + qty;
        const newWAC = Math.round(
          ((warehouse.qty_in * existingAvg + qty * price) / newQty) * 100,
        ) / 100;

        await tx.fabricWarehouse.update({
          where: { id: warehouse.id },
          data: {
            qty_in:              newQty,
            avg_cost_per_kg:     newWAC,
            last_purchase_price: price,
          },
        });
      }

      return created;
    });

    return res.status(201).json(purchase);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حفظ المشترى' });
  }
});

// PUT — edit purchase: adjusts warehouse qty and WAC incrementally.
// Reverse the old contribution, apply the new one:
// newQty   = warehouseQty - oldQty + newQty
// newValue = warehouseQty × existingAvg - oldQty × oldPrice + newQty × newPrice
fabricPurchasesRouter.put('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { date, fabric_type, color, quantity_kg, price_per_kg, supplier, invoice_no, notes } = req.body;
    const newQty   = parseFloat(quantity_kg)  || 0;
    const newPrice = parseFloat(price_per_kg) || 0;
    if (!fabric_type || newQty <= 0 || newPrice <= 0) {
      return res.status(400).json({ message: 'يرجى تحديد الصنف والكمية والسعر' });
    }
    const cleanColor = (color || '').trim();

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.fabricPurchase.findUnique({ where: { id } });
      if (!existing) throw new Error('NOT_FOUND');

      const warehouse = await tx.fabricWarehouse.findFirst({
        where: { material_type: existing.fabric_type, color: existing.color },
      });
      if (!warehouse) throw new Error('WAREHOUSE_NOT_FOUND');

      const deltaQty = newQty - existing.quantity_kg;

      // Safety: if reducing qty, verify cutting consumption is not exceeded
      if (deltaQty < 0) {
        const cutting = await tx.cuttingOrder.findMany({
          where: { material_type: existing.fabric_type, color: existing.color },
        });
        const totalConsumed = cutting.reduce((s, c) => s + c.kg_consumed, 0);
        if (warehouse.qty_in + deltaQty < totalConsumed) throw new Error('CONSUMED');
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
      const existingAvg  = warehouse.avg_cost_per_kg > 0 ? warehouse.avg_cost_per_kg : warehouse.cost_per_kg;
      const newTotalQty  = warehouse.qty_in + deltaQty;
      const newTotalVal  = warehouse.qty_in * existingAvg
        - existing.quantity_kg * existing.price_per_kg
        + newQty * newPrice;

      if (newTotalQty <= 0) {
        await tx.fabricWarehouse.update({
          where: { id: warehouse.id },
          data: { qty_in: 0, avg_cost_per_kg: 0, last_purchase_price: 0 },
        });
      } else {
        const newWAC = Math.round((newTotalVal / newTotalQty) * 100) / 100;
        await tx.fabricWarehouse.update({
          where: { id: warehouse.id },
          data: { qty_in: newTotalQty, avg_cost_per_kg: newWAC, last_purchase_price: newPrice },
        });
      }

      return updated;
    });

    return res.json(result);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === 'NOT_FOUND')           return res.status(404).json({ message: 'العملية غير موجودة' });
      if (err.message === 'CONSUMED')            return res.status(400).json({ message: 'لا يمكن تقليل هذه العملية لأن جزءاً من الكمية تم استهلاكه بالفعل.' });
      if (err.message === 'WAREHOUSE_NOT_FOUND') return res.status(404).json({ message: 'سجل المخزون غير موجود' });
    }
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تعديل المشترى' });
  }
});

// DELETE — remove purchase: subtracts its qty from warehouse and adjusts WAC.
// Reverse formula: newValue = warehouseQty × existingAvg - deletedQty × deletedPrice
fabricPurchasesRouter.delete('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.fabricPurchase.findUnique({ where: { id } });
      if (!existing) throw new Error('NOT_FOUND');

      const warehouse = await tx.fabricWarehouse.findFirst({
        where: { material_type: existing.fabric_type, color: existing.color },
      });
      if (!warehouse) throw new Error('WAREHOUSE_NOT_FOUND');

      const newQty = warehouse.qty_in - existing.quantity_kg;

      // Safety: ensure remaining stock covers cutting consumption
      const cutting = await tx.cuttingOrder.findMany({
        where: { material_type: existing.fabric_type, color: existing.color },
      });
      if (newQty < cutting.reduce((s, c) => s + c.kg_consumed, 0)) throw new Error('CONSUMED');

      await tx.fabricPurchase.delete({ where: { id } });

      if (newQty <= 0) {
        await tx.fabricWarehouse.update({
          where: { id: warehouse.id },
          data: { qty_in: 0, avg_cost_per_kg: 0, last_purchase_price: 0 },
        });
      } else {
        const existingAvg = warehouse.avg_cost_per_kg > 0 ? warehouse.avg_cost_per_kg : warehouse.cost_per_kg;
        const newValue    = warehouse.qty_in * existingAvg - existing.quantity_kg * existing.price_per_kg;
        const newWAC      = Math.round((newValue / newQty) * 100) / 100;

        // Find the most-recent remaining purchase for last_purchase_price
        const lastRemaining = await tx.fabricPurchase.findFirst({
          where: { fabric_type: existing.fabric_type, color: existing.color },
          orderBy: { id: 'desc' },
        });

        await tx.fabricWarehouse.update({
          where: { id: warehouse.id },
          data: {
            qty_in:              newQty,
            avg_cost_per_kg:     newWAC,
            last_purchase_price: lastRemaining?.price_per_kg ?? warehouse.cost_per_kg,
          },
        });
      }
    });

    return res.json({ message: 'تم الحذف' });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === 'NOT_FOUND')           return res.status(404).json({ message: 'العملية غير موجودة' });
      if (err.message === 'CONSUMED')            return res.status(400).json({ message: 'لا يمكن حذف هذه العملية لأن جزءاً من الكمية تم استهلاكه بالفعل.' });
      if (err.message === 'WAREHOUSE_NOT_FOUND') return res.status(404).json({ message: 'سجل المخزون غير موجود' });
    }
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حذف المشترى' });
  }
});

// POST /rebuild — admin utility: rebuild a specific warehouse row from full purchase history.
// Overwrites any qty that came from direct "إضافة وارد" entries.
fabricPurchasesRouter.post('/rebuild', requireManager, async (req: Request, res: Response) => {
  try {
    const { fabric_type, color } = req.body;
    if (!fabric_type) return res.status(400).json({ message: 'fabric_type مطلوب' });
    await rebuildFabricInventory(prisma, fabric_type, (color || '').trim());
    return res.json({ message: 'تم إعادة الحساب من سجل المشتريات' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إعادة الحساب' });
  }
});

// ===== FIXED ASSETS =====
export const fixedAssetsRouter = Router();
fixedAssetsRouter.use(authenticate);

fixedAssetsRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.fixedAsset.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ في جلب البيانات' }); }
});
fixedAssetsRouter.post('/', requireManager, async (req, res) => {
  try { return res.status(201).json(await prisma.fixedAsset.create({ data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ في الإضافة' }); }
});
fixedAssetsRouter.put('/:id', requireManager, async (req, res) => {
  try { return res.json(await prisma.fixedAsset.update({ where: { id: parseInt(req.params.id as string) }, data: req.body })); }
  catch { return res.status(500).json({ message: 'خطأ في التحديث' }); }
});
fixedAssetsRouter.delete('/:id', requireManager, async (req, res) => {
  try { await prisma.fixedAsset.delete({ where: { id: parseInt(req.params.id as string) } }); return res.json({ message: 'تم الحذف' }); }
  catch { return res.status(500).json({ message: 'خطأ في الحذف' }); }
});