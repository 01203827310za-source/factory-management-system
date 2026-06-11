// ============================================
// All Entity Routes (Expenses, Stock, Fabric,
// Accessories, Cutting, ModelProd, Debts,
// ClientAccounts, Returns, PaymentLog, Marketers)
// ============================================

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';

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
  try {
    const rec = await prisma.expenseRevenue.create({ data: req.body });
    logAudit({ user: req.user, module: 'Expenses', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة ${rec.operation_type}: ${rec.statement}` });
    return res.status(201).json(rec);
  } catch { return res.status(500).json({ message: 'خطأ في الإضافة' }); }
});
expensesRouter.put('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.expenseRevenue.findUnique({ where: { id } });
    const rec = await prisma.expenseRevenue.update({ where: { id }, data: req.body });
    logAudit({ user: req.user, module: 'Expenses', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل ${rec.operation_type}: ${rec.statement}` });
    return res.json(rec);
  } catch { return res.status(500).json({ message: 'خطأ في التحديث' }); }
});
expensesRouter.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.expenseRevenue.findUnique({ where: { id } });
    await prisma.expenseRevenue.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Expenses', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف ${before?.operation_type}: ${before?.statement}` });
    return res.json({ message: 'تم الحذف' });
  } catch { return res.status(500).json({ message: 'خطأ في الحذف' }); }
});

// ===== READY STOCK =====
export const readyStockRouter = Router();
readyStockRouter.use(authenticate);

readyStockRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.readyStock.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
readyStockRouter.post('/', requireManager, async (req, res) => {
  try {
    const rec = await prisma.readyStock.create({ data: req.body });
    logAudit({ user: req.user, module: 'ReadyStock', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة منتج جاهز: ${rec.model_code} - ${rec.product_name}` });
    return res.status(201).json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
readyStockRouter.put('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.readyStock.findUnique({ where: { id } });
    // Strip reserved_quantity — it is managed exclusively by the reservation workflow
    const { reserved_quantity: _ignored, ...safeData } = req.body;
    const rec = await prisma.readyStock.update({ where: { id }, data: safeData });
    logAudit({ user: req.user, module: 'ReadyStock', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل منتج جاهز: ${rec.model_code} - ${rec.product_name}` });
    return res.json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
readyStockRouter.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.readyStock.findUnique({ where: { id } });
    await prisma.readyStock.delete({ where: { id } });
    logAudit({ user: req.user, module: 'ReadyStock', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف منتج جاهز: ${before?.model_code} - ${before?.product_name}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== FABRIC WAREHOUSE =====
export const fabricRouter = Router();
fabricRouter.use(authenticate);

fabricRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.fabricWarehouse.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
fabricRouter.post('/', requireManager, async (req, res) => {
  try {
    const rec = await prisma.fabricWarehouse.create({ data: req.body });
    logAudit({ user: req.user, module: 'FabricWarehouse', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة قماش: ${rec.material_type} - ${rec.color}` });
    return res.status(201).json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
fabricRouter.put('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.fabricWarehouse.findUnique({ where: { id } });
    const rec = await prisma.fabricWarehouse.update({ where: { id }, data: req.body });
    logAudit({ user: req.user, module: 'FabricWarehouse', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل قماش: ${rec.material_type} - ${rec.color}` });
    return res.json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
fabricRouter.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.fabricWarehouse.findUnique({ where: { id } });
    await prisma.fabricWarehouse.delete({ where: { id } });
    logAudit({ user: req.user, module: 'FabricWarehouse', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف قماش: ${before?.material_type} - ${before?.color}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== ACCESSORIES =====
export const accessoriesRouter = Router();
accessoriesRouter.use(authenticate);

accessoriesRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.accessoriesWarehouse.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
accessoriesRouter.post('/', requireManager, async (req, res) => {
  try {
    const rec = await prisma.accessoriesWarehouse.create({ data: req.body });
    logAudit({ user: req.user, module: 'Accessories', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة إكسسوار: ${rec.item_name}` });
    return res.status(201).json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
accessoriesRouter.put('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.accessoriesWarehouse.findUnique({ where: { id } });
    const rec = await prisma.accessoriesWarehouse.update({ where: { id }, data: req.body });
    logAudit({ user: req.user, module: 'Accessories', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل إكسسوار: ${rec.item_name}` });
    return res.json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
accessoriesRouter.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.accessoriesWarehouse.findUnique({ where: { id } });
    await prisma.accessoriesWarehouse.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Accessories', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف إكسسوار: ${before?.item_name}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== CUTTING ORDERS =====
export const cuttingRouter = Router();
cuttingRouter.use(authenticate);

cuttingRouter.get('/', async (_req, res) => {
  try {
    const cuts = await prisma.cuttingOrder.findMany({ orderBy: { id: 'asc' } });

    // For each cut, compute reserved pieces from model_parts → model_production
    const usedMap = new Map<string, number>();
    const pairs = [...new Set(cuts.map(c => `${c.cut_number}|${c.color}`))];
    await Promise.all(pairs.map(async (key) => {
      const [cut_number, color] = key.split('|');
      const parts = await prisma.modelPart.findMany({
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
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
cuttingRouter.post('/', requireManager, async (req, res) => {
  try {
    const rec = await prisma.cuttingOrder.create({ data: req.body });
    logAudit({ user: req.user, module: 'Cutting', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة أمر قطع: ${rec.cut_description || rec.cut_number}` });
    return res.status(201).json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
cuttingRouter.put('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.cuttingOrder.findUnique({ where: { id } });
    const rec = await prisma.cuttingOrder.update({ where: { id }, data: req.body });
    logAudit({ user: req.user, module: 'Cutting', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل أمر قطع: ${rec.cut_description || rec.cut_number}` });
    return res.json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
cuttingRouter.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.cuttingOrder.findUnique({ where: { id } });
    await prisma.cuttingOrder.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Cutting', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف أمر قطع: ${before?.cut_description || before?.cut_number}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== MODEL PRODUCTION =====
export const modelProdRouter = Router();
modelProdRouter.use(authenticate);

const PARTS_INCLUDE = { parts: { orderBy: { id: 'asc' as const } } } as const;

type PartInput = { part_type?: string; cut_number?: number; color?: string };

// Returns how many pieces from (cut_number, color) are still available.
// excludeModelId: omit that model's usage (for update validation).
async function getAvailableForPart(
  cut_number: number,
  color: string,
  excludeModelId?: number,
): Promise<{ total: number; used: number; available: number }> {
  const cuts = await prisma.cuttingOrder.findMany({ where: { cut_number, color } });
  const total = cuts.reduce((s, c) => s + c.total_pieces, 0);

  const usedParts = await prisma.modelPart.findMany({
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

modelProdRouter.get('/', async (_req, res) => {
  try {
    return res.json(await prisma.modelProduction.findMany({
      orderBy: { id: 'asc' },
      include: PARTS_INCLUDE,
    }));
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

modelProdRouter.post('/', requireManager, async (req, res) => {
  try {
    const { parts, ...data } = req.body;
    const qty = parseInt(data.qty_from_cutting) || 0;

    if (Array.isArray(parts) && parts.length > 0) {
      for (const p of parts as PartInput[]) {
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
    const rec = await prisma.modelProduction.create({ data: { ...data, cut_number: primaryCut } });
    if (Array.isArray(parts) && parts.length > 0) {
      await prisma.modelPart.createMany({
        data: (parts as PartInput[]).map(p => ({
          model_id:   rec.id,
          part_type:  p.part_type  || '',
          cut_number: p.cut_number || 0,
          color:      (p.color     || '').trim(),
        })),
      });
    }
    const fresh = await prisma.modelProduction.findUnique({ where: { id: rec.id }, include: PARTS_INCLUDE });
    logAudit({ user: req.user, module: 'ModelProduction', action: 'CREATE', record_id: rec.id,
      after_data: fresh, description: `إضافة إنتاج موديل: ${rec.model_code} - ${rec.model_description}` });
    return res.status(201).json(fresh);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

modelProdRouter.put('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const { parts, ...data } = req.body;
    const qty = parseInt(data.qty_from_cutting) || 0;

    if (Array.isArray(parts) && parts.length > 0) {
      for (const p of parts as PartInput[]) {
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
    const before = await prisma.modelProduction.findUnique({ where: { id }, include: PARTS_INCLUDE });
    await prisma.modelProduction.update({ where: { id }, data: { ...data, cut_number: primaryCut } });
    if (Array.isArray(parts)) {
      await prisma.modelPart.deleteMany({ where: { model_id: id } });
      if (parts.length > 0) {
        await prisma.modelPart.createMany({
          data: (parts as PartInput[]).map(p => ({
            model_id:   id,
            part_type:  p.part_type  || '',
            cut_number: p.cut_number || 0,
            color:      (p.color     || '').trim(),
          })),
        });
      }
    }
    const fresh = await prisma.modelProduction.findUnique({ where: { id }, include: PARTS_INCLUDE });
    logAudit({ user: req.user, module: 'ModelProduction', action: 'UPDATE', record_id: id,
      before_data: before, after_data: fresh,
      description: `تعديل إنتاج موديل: ${fresh?.model_code} - ${fresh?.model_description}` });
    return res.json(fresh);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

modelProdRouter.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.modelProduction.findUnique({ where: { id }, include: PARTS_INCLUDE });
    await prisma.modelProduction.delete({ where: { id } }); // parts cascade via FK
    logAudit({ user: req.user, module: 'ModelProduction', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف إنتاج موديل: ${before?.model_code} - ${before?.model_description}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== DEBTS =====
export const debtsRouter = Router();
debtsRouter.use(authenticate);

const DEBT_INCLUDE = { payments: { orderBy: { id: 'asc' as const } } } as const;

debtsRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.debt.findMany({ orderBy: { id: 'asc' }, include: DEBT_INCLUDE })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
debtsRouter.post('/', requireManager, async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const debt = await prisma.debt.create({
      data: { ...data, remaining: (data.total_amount || 0) - (data.amount_paid || 0) },
      include: DEBT_INCLUDE,
    });
    logAudit({ user: req.user, module: 'Debts', action: 'CREATE', record_id: debt.id,
      after_data: debt, description: `إضافة دين: ${debt.name}` });
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
    const result = await prisma.debt.update({ where: { id }, data, include: DEBT_INCLUDE });
    const delta = newPaid - cur.amount_paid;
    if (delta < 0) {
      await purgePaymentLogs('debt_payment', `سداد دين: ${cur.name}`, -delta);
    }
    logAudit({ user: req.user, module: 'Debts', action: 'UPDATE', record_id: id,
      before_data: cur, after_data: result, description: `تعديل دين: ${result.name}` });
    return res.json(result);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
debtsRouter.delete('/:id', requireManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const cur = await prisma.debt.findUnique({ where: { id }, include: DEBT_INCLUDE });
    if (cur) {
      // Clean up PaymentLog entries linked to each payment
      const logIds = (cur.payments || []).map(p => p.payment_log_id).filter((x): x is number => x != null);
      if (logIds.length) await prisma.paymentLog.deleteMany({ where: { id: { in: logIds } } });
    }
    await prisma.debt.delete({ where: { id } }); // debt_payments cascade
    logAudit({ user: req.user, module: 'Debts', action: 'DELETE', record_id: id,
      before_data: cur, description: `حذف دين: ${cur?.name}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ----- Debt payment sub-routes -----
debtsRouter.post('/:id/payments', requireManager, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  try {
    const { date, amount, payment_method, description, receiver } = req.body;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return res.status(400).json({ message: 'المبلغ يجب أن يكون أكبر من صفر' });
    const debt = await prisma.debt.findUnique({ where: { id } });
    if (!debt) return res.status(404).json({ message: 'الدين غير موجود' });

    const payDate = date || new Date().toISOString().split('T')[0];
    const log = await prisma.paymentLog.create({
      data: { date: payDate, type: 'debt_payment', amount: amt,
        receiver: receiver || '', description: `سداد دين: ${debt.name}` },
    });
    const payment = await prisma.debtPayment.create({
      data: { debt_id: id, payment_log_id: log.id, date: payDate, amount: amt,
        payment_method: payment_method || '', description: description || '',
        receiver: receiver || '', created_by: req.user?.username || '' },
    });
    const newPaid = debt.amount_paid + amt;
    await prisma.debt.update({ where: { id }, data: { amount_paid: newPaid, remaining: debt.total_amount - newPaid } });
    logAudit({ user: req.user, module: 'Debts', action: 'CREATE', record_id: payment.id,
      after_data: payment, description: `دفعة دين: ${debt.name} - ${amt}` });
    return res.status(201).json(payment);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

debtsRouter.put('/:id/payments/:pid', requireManager, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const pid = parseInt(req.params.pid as string);
  try {
    const { date, amount, payment_method, description } = req.body;
    const newAmt = parseFloat(amount) || 0;
    const [debt, payment] = await Promise.all([
      prisma.debt.findUnique({ where: { id } }),
      prisma.debtPayment.findUnique({ where: { id: pid } }),
    ]);
    if (!debt || !payment) return res.status(404).json({ message: 'غير موجود' });

    const delta = newAmt - payment.amount;
    const updated = await prisma.debtPayment.update({
      where: { id: pid },
      data: { date: date || payment.date, amount: newAmt,
        payment_method: payment_method ?? payment.payment_method,
        description: description ?? payment.description },
    });
    if (payment.payment_log_id) {
      await prisma.paymentLog.update({ where: { id: payment.payment_log_id }, data: { amount: newAmt } });
    }
    const newPaid = debt.amount_paid + delta;
    await prisma.debt.update({ where: { id }, data: { amount_paid: newPaid, remaining: debt.total_amount - newPaid } });
    return res.json(updated);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

debtsRouter.delete('/:id/payments/:pid', requireManager, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const pid = parseInt(req.params.pid as string);
  try {
    const [debt, payment] = await Promise.all([
      prisma.debt.findUnique({ where: { id } }),
      prisma.debtPayment.findUnique({ where: { id: pid } }),
    ]);
    if (!debt || !payment) return res.status(404).json({ message: 'غير موجود' });
    await prisma.debtPayment.delete({ where: { id: pid } });
    if (payment.payment_log_id) {
      await prisma.paymentLog.delete({ where: { id: payment.payment_log_id } }).catch(() => {});
    }
    const newPaid = Math.max(0, debt.amount_paid - payment.amount);
    await prisma.debt.update({ where: { id }, data: { amount_paid: newPaid, remaining: debt.total_amount - newPaid } });
    logAudit({ user: req.user, module: 'Debts', action: 'DELETE', record_id: pid,
      before_data: payment, description: `حذف دفعة دين: ${debt.name} - ${payment.amount}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== CLIENT ACCOUNTS =====
export const clientAccountsRouter = Router();
clientAccountsRouter.use(authenticate);

const ACCT_INCLUDE = { payments: { orderBy: { id: 'asc' as const } } } as const;

clientAccountsRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.clientAccount.findMany({ orderBy: { id: 'asc' }, include: ACCT_INCLUDE })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
clientAccountsRouter.post('/', requireManager, async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const rec = await prisma.clientAccount.create({
      data: { ...data, remaining: (data.total_amount || 0) - (data.amount_paid || 0) },
      include: ACCT_INCLUDE,
    });
    logAudit({ user: req.user, module: 'ClientAccounts', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة حساب عميل: ${rec.client_name}` });
    return res.status(201).json(rec);
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
    const result = await prisma.clientAccount.update({ where: { id }, data, include: ACCT_INCLUDE });
    const delta = newPaid - cur.amount_paid;
    if (delta < 0) {
      await purgePaymentLogs('client_payment', `دفعة عميل: ${cur.client_name}`, -delta);
    }
    logAudit({ user: req.user, module: 'ClientAccounts', action: 'UPDATE', record_id: id,
      before_data: cur, after_data: result, description: `تعديل حساب عميل: ${result.client_name}` });
    return res.json(result);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
clientAccountsRouter.delete('/:id', requireManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const cur = await prisma.clientAccount.findUnique({ where: { id }, include: ACCT_INCLUDE });
    if (cur) {
      const logIds = (cur.payments || []).map(p => p.payment_log_id).filter((x): x is number => x != null);
      if (logIds.length) await prisma.paymentLog.deleteMany({ where: { id: { in: logIds } } });
    }
    await prisma.clientAccount.delete({ where: { id } }); // client_account_payments cascade
    logAudit({ user: req.user, module: 'ClientAccounts', action: 'DELETE', record_id: id,
      before_data: cur, description: `حذف حساب عميل: ${cur?.client_name}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ----- Client account payment sub-routes -----
clientAccountsRouter.post('/:id/payments', requireManager, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  try {
    const { date, amount, payment_method, description, receiver } = req.body;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return res.status(400).json({ message: 'المبلغ يجب أن يكون أكبر من صفر' });
    const account = await prisma.clientAccount.findUnique({ where: { id } });
    if (!account) return res.status(404).json({ message: 'الحساب غير موجود' });

    const payDate = date || new Date().toISOString().split('T')[0];
    const log = await prisma.paymentLog.create({
      data: { date: payDate, type: 'client_payment', amount: amt,
        receiver: receiver || '', description: `دفعة عميل: ${account.client_name} - ${account.model_name}` },
    });
    const payment = await prisma.clientAccountPayment.create({
      data: { account_id: id, payment_log_id: log.id, date: payDate, amount: amt,
        payment_method: payment_method || '', description: description || '',
        receiver: receiver || '', created_by: req.user?.username || '' },
    });
    const newPaid = account.amount_paid + amt;
    await prisma.clientAccount.update({ where: { id }, data: { amount_paid: newPaid, remaining: account.total_amount - newPaid } });
    logAudit({ user: req.user, module: 'ClientAccounts', action: 'CREATE', record_id: payment.id,
      after_data: payment, description: `دفعة عميل: ${account.client_name} - ${amt}` });
    return res.status(201).json(payment);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

clientAccountsRouter.put('/:id/payments/:pid', requireManager, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const pid = parseInt(req.params.pid as string);
  try {
    const { date, amount, payment_method, description } = req.body;
    const newAmt = parseFloat(amount) || 0;
    const [account, payment] = await Promise.all([
      prisma.clientAccount.findUnique({ where: { id } }),
      prisma.clientAccountPayment.findUnique({ where: { id: pid } }),
    ]);
    if (!account || !payment) return res.status(404).json({ message: 'غير موجود' });

    const delta = newAmt - payment.amount;
    const updated = await prisma.clientAccountPayment.update({
      where: { id: pid },
      data: { date: date || payment.date, amount: newAmt,
        payment_method: payment_method ?? payment.payment_method,
        description: description ?? payment.description },
    });
    if (payment.payment_log_id) {
      await prisma.paymentLog.update({ where: { id: payment.payment_log_id }, data: { amount: newAmt } });
    }
    const newPaid = account.amount_paid + delta;
    await prisma.clientAccount.update({ where: { id }, data: { amount_paid: newPaid, remaining: account.total_amount - newPaid } });
    return res.json(updated);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

clientAccountsRouter.delete('/:id/payments/:pid', requireManager, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const pid = parseInt(req.params.pid as string);
  try {
    const [account, payment] = await Promise.all([
      prisma.clientAccount.findUnique({ where: { id } }),
      prisma.clientAccountPayment.findUnique({ where: { id: pid } }),
    ]);
    if (!account || !payment) return res.status(404).json({ message: 'غير موجود' });
    await prisma.clientAccountPayment.delete({ where: { id: pid } });
    if (payment.payment_log_id) {
      await prisma.paymentLog.delete({ where: { id: payment.payment_log_id } }).catch(() => {});
    }
    const newPaid = Math.max(0, account.amount_paid - payment.amount);
    await prisma.clientAccount.update({ where: { id }, data: { amount_paid: newPaid, remaining: account.total_amount - newPaid } });
    logAudit({ user: req.user, module: 'ClientAccounts', action: 'DELETE', record_id: pid,
      before_data: payment, description: `حذف دفعة عميل: ${account.client_name} - ${payment.amount}` });
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
  try {
    const rec = await prisma.returnItem.create({ data: req.body });
    logAudit({ user: req.user, module: 'Returns', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة مرتجع: ${rec.client_name} - ${rec.model_code}` });
    return res.status(201).json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
returnsRouter.put('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.returnItem.findUnique({ where: { id } });
    const rec = await prisma.returnItem.update({ where: { id }, data: req.body });
    logAudit({ user: req.user, module: 'Returns', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل مرتجع: ${rec.client_name} - ${rec.model_code}` });
    return res.json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
returnsRouter.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.returnItem.findUnique({ where: { id } });
    await prisma.returnItem.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Returns', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف مرتجع: ${before?.client_name} - ${before?.model_code}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});

// ===== PAYMENT LOGS =====
export const paymentLogRouter = Router();
paymentLogRouter.use(authenticate);

paymentLogRouter.get('/', async (_req, res) => {
  try { return res.json(await prisma.paymentLog.findMany({ orderBy: { id: 'asc' } })); }
  catch { return res.status(500).json({ message: 'خطأ' }); }
});
paymentLogRouter.post('/', requireManager, async (req, res) => {
  try {
    const rec = await prisma.paymentLog.create({ data: req.body });
    logAudit({ user: req.user, module: 'PaymentLogs', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة سجل دفع: ${rec.description} - ${rec.amount}` });
    return res.status(201).json(rec);
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
paymentLogRouter.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.paymentLog.findUnique({ where: { id } });
    await prisma.paymentLog.delete({ where: { id } });
    logAudit({ user: req.user, module: 'PaymentLogs', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف سجل دفع: ${before?.description} - ${before?.amount}` });
    return res.json({ message: 'تم' });
  } catch { return res.status(500).json({ message: 'خطأ' }); }
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
    const created = await prisma.marketer.create({ data: { name } });
    logAudit({ user: req.user, module: 'Marketers', action: 'CREATE', record_id: created.id,
      after_data: created, description: `إضافة مسوق: ${name}` });
    const all = await prisma.marketer.findMany({ orderBy: { id: 'asc' } });
    return res.status(201).json(all.map(m => m.name));
  } catch { return res.status(500).json({ message: 'خطأ' }); }
});
marketersRouter.delete('/:name', requireManager, async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name as string);
    const before = await prisma.marketer.findUnique({ where: { name } });
    await prisma.marketer.delete({ where: { name } });
    logAudit({ user: req.user, module: 'Marketers', action: 'DELETE', record_id: before?.id ?? name,
      before_data: before, description: `حذف مسوق: ${name}` });
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

    logAudit({ user: req.user, module: 'FabricPurchases', action: 'CREATE', record_id: purchase.id,
      after_data: purchase, description: `إضافة مشترى قماش: ${purchase.fabric_type} - ${purchase.color}` });
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

    const before = await prisma.fabricPurchase.findUnique({ where: { id } });

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

    logAudit({ user: req.user, module: 'FabricPurchases', action: 'UPDATE', record_id: id,
      before_data: before, after_data: result, description: `تعديل مشترى قماش: ${result.fabric_type} - ${result.color}` });
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
    const before = await prisma.fabricPurchase.findUnique({ where: { id } });

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

    logAudit({ user: req.user, module: 'FabricPurchases', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف مشترى قماش: ${before?.fabric_type} - ${before?.color}` });
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
  try {
    const rec = await prisma.fixedAsset.create({ data: req.body });
    logAudit({ user: req.user, module: 'FixedAssets', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة أصل ثابت: ${rec.name}` });
    return res.status(201).json(rec);
  } catch { return res.status(500).json({ message: 'خطأ في الإضافة' }); }
});
fixedAssetsRouter.put('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.fixedAsset.findUnique({ where: { id } });
    const rec = await prisma.fixedAsset.update({ where: { id }, data: req.body });
    logAudit({ user: req.user, module: 'FixedAssets', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل أصل ثابت: ${rec.name}` });
    return res.json(rec);
  } catch { return res.status(500).json({ message: 'خطأ في التحديث' }); }
});
fixedAssetsRouter.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.fixedAsset.findUnique({ where: { id } });
    await prisma.fixedAsset.delete({ where: { id } });
    logAudit({ user: req.user, module: 'FixedAssets', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف أصل ثابت: ${before?.name}` });
    return res.json({ message: 'تم الحذف' });
  } catch { return res.status(500).json({ message: 'خطأ في الحذف' }); }
});
