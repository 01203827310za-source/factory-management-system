import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { FuzzyKeyIndex } from '../utils/textMatch';

const router = Router();
router.use(authenticate);

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [sales, expenses, debts, clientAccts, returns_, paymentLogs, fabric, readyStock, accessories, fixedAssets] = await Promise.all([
      prisma.sale.findMany(),
      prisma.expenseRevenue.findMany(),
      prisma.debt.findMany(),
      prisma.clientAccount.findMany(),
      prisma.returnItem.findMany(),
      prisma.paymentLog.findMany(),
      prisma.fabricWarehouse.findMany(),
      prisma.readyStock.findMany(),
      prisma.accessoriesWarehouse.findMany(),
      prisma.fixedAsset.findMany(),
    ]);

    const depositIn   = sales.reduce((s, sale) => s + sale.deposit_paid, 0);
    const remainingIn = sales
      .filter(s => s.order_status === 'تم الصرف')
      .reduce((s, sale) => s + sale.remaining, 0);
    const clientPayIn = paymentLogs
      .filter(p => p.type === 'client_payment')
      .reduce((s, p) => s + p.amount, 0);
    const debtOut     = paymentLogs
      .filter(p => p.type === 'debt_payment')
      .reduce((s, p) => s + p.amount, 0);
    const refundOut   = returns_.reduce((s, r) => s + r.refund_amount, 0);

    const totalIn  = expenses.reduce((s, e) => s + e.amount_in, 0) + depositIn + remainingIn + clientPayIn;
    const totalOut = expenses.reduce((s, e) => s + e.amount_out, 0) + debtOut + refundOut;

    const remainingDebts = debts.reduce((s, d) => s + d.remaining, 0);
    const moneyOwedToUs  =
      sales.filter(s => s.order_status === 'لم يتم الصرف').reduce((s, sale) => s + sale.remaining, 0) +
      clientAccts.reduce((s, ca) => s + ca.remaining, 0);

    const cashAvailable = totalIn - totalOut;

    const cuttingOrders = await prisma.cuttingOrder.findMany();
    const fabricIndex = new FuzzyKeyIndex(['color', 'color']); // [material_type, color]
    const fabricConsumed: Record<string, number> = {};
    cuttingOrders.forEach(c => {
      const key = fabricIndex.resolve([c.material_type, c.color]);
      fabricConsumed[key] = (fabricConsumed[key] || 0) + c.kg_consumed;
    });
    let fabricValue = 0;
    fabric.forEach(f => {
      const consumed = fabricConsumed[fabricIndex.resolve([f.material_type, f.color])] || 0;
      fabricValue += Math.max(0, f.qty_in - consumed) * f.cost_per_kg;
    });

    const modelProds = await prisma.modelProduction.findMany();
    const modelIndex = new FuzzyKeyIndex(['model', 'color']); // [model_code, color]
    const newProd: Record<string, number> = {};
    modelProds.forEach(mp => {
      const key = modelIndex.resolve([mp.model_code, mp.color || '']);
      newProd[key] = (newProd[key] || 0) + mp.qty_received;
    });
    const totalSalesQty: Record<string, number> = {};
    sales.forEach(s => {
      [{ code: s.model1_code, qty: s.model1_qty, color: s.model1_color },
       { code: s.model2_code, qty: s.model2_qty, color: s.model2_color },
       { code: s.model3_code, qty: s.model3_qty, color: s.model3_color },
       { code: s.model4_code, qty: s.model4_qty, color: s.model4_color },
       { code: s.model5_code, qty: s.model5_qty, color: s.model5_color }].forEach(({ code, qty, color }) => {
        if (code && qty > 0) {
          const key = modelIndex.resolve([code, color || '']);
          totalSalesQty[key] = (totalSalesQty[key] || 0) + qty;
        }
      });
    });
    const returnQty: Record<string, number> = {};
    returns_.forEach(r => {
      if (r.model_code) {
        const key = modelIndex.resolve([r.model_code, r.model_color || '']);
        returnQty[key] = (returnQty[key] || 0) + r.model_qty;
      }
    });

    let stockValue = 0;
    readyStock.forEach(rs => {
      const key = modelIndex.resolve([rs.model_code, rs.color || '']);
      const actual = Math.max(0, rs.opening_balance + (newProd[key] || 0) - (totalSalesQty[key] || 0) + (returnQty[key] || 0));
      stockValue += actual * rs.cost_per_piece;
    });

    const accessoriesValue = accessories.reduce((s, a) => s + Math.max(0, a.qty_in - a.qty_consumed) * a.cost, 0);
    const totalCurrentAssets = fabricValue + stockValue + accessoriesValue + moneyOwedToUs + cashAvailable;

    const totalFixedAssets = fixedAssets.reduce((s, a) => s + a.purchase_price, 0);
    const totalAssets      = totalCurrentAssets + totalFixedAssets;
    const netPosition      = totalAssets - remainingDebts;

    return res.json({
      fabric_value:         fabricValue,
      stock_value:          stockValue,
      accessories_value:    accessoriesValue,
      money_owed_to_us:     moneyOwedToUs,
      cash_available:       cashAvailable,
      total_current_assets: totalCurrentAssets,
      total_fixed_assets:   totalFixedAssets,
      total_assets:         totalAssets,
      total_debts:          remainingDebts,
      net_position:         netPosition,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حساب المركز المالي' });
  }
});

export default router;
