import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

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
      prisma.asset.findMany(),
    ]);

    // --- Reuse same logic as dashboard for current assets ---
    const hatemPaymentIn = paymentLogs.filter(p => p.receiver === 'حاتم').reduce((s, p) => s + p.amount, 0);
    const midoPaymentIn = paymentLogs.filter(p => p.receiver === 'ميدو').reduce((s, p) => s + p.amount, 0);
    const hatemDebtOut = paymentLogs.filter(p => p.type === 'debt_payment' && p.receiver === 'حاتم').reduce((s, p) => s + p.amount, 0);
    const midoDebtOut = paymentLogs.filter(p => p.type === 'debt_payment' && p.receiver === 'ميدو').reduce((s, p) => s + p.amount, 0);

    const hatemDepositIn = sales.filter(s => s.deposit_receiver === 'حاتم').reduce((s, sale) => s + sale.deposit_paid, 0);
    const midoDepositIn = sales.filter(s => s.deposit_receiver === 'ميدو').reduce((s, sale) => s + sale.deposit_paid, 0);
    const hatemRemainingIn = sales.filter(s => s.order_status === 'تم الصرف').reduce((s, sale) => s + sale.remaining, 0);

    const hatemReturnOut = returns_.filter(r => r.paid_by === 'حاتم').reduce((s, r) => s + r.refund_amount, 0);
    const midoReturnOut = returns_.filter(r => r.paid_by === 'ميدو').reduce((s, r) => s + r.refund_amount, 0);

    const hatemIn = expenses.reduce((s, e) => s + e.hatem_in, 0) + hatemDepositIn + hatemRemainingIn + hatemPaymentIn;
    const hatemOut = expenses.reduce((s, e) => s + e.hatem_out, 0) + hatemDebtOut + hatemReturnOut;
    const midoIn = expenses.reduce((s, e) => s + e.mido_in, 0) + midoDepositIn + midoPaymentIn;
    const midoOut = expenses.reduce((s, e) => s + e.mido_out, 0) + midoDebtOut + midoReturnOut;

    const remainingDebts = debts.reduce((s, d) => s + d.remaining, 0);
    const moneyOwedToUs =
      sales.filter(s => s.order_status === 'لم يتم الصرف').reduce((s, sale) => s + sale.remaining, 0) +
      clientAccts.reduce((s, ca) => s + ca.remaining, 0);

    const totalIn = hatemIn + midoIn;
    const totalOut = hatemOut + midoOut;
    const cashAvailable = totalIn - totalOut - remainingDebts;

    // Fabric value
    const cuttingOrders = await prisma.cuttingOrder.findMany();
    const fabricConsumed: Record<string, number> = {};
    cuttingOrders.forEach(c => {
      const key = `${c.material_type}|${c.color}`;
      fabricConsumed[key] = (fabricConsumed[key] || 0) + c.kg_consumed;
    });
    let fabricValue = 0;
    fabric.forEach(f => {
      const consumed = fabricConsumed[`${f.material_type}|${f.color}`] || 0;
      fabricValue += Math.max(0, f.qty_in - consumed) * f.cost_per_kg;
    });

    // Stock value
    const modelProds = await prisma.modelProduction.findMany();
    const newProd: Record<string, number> = {};
    modelProds.forEach(mp => { newProd[mp.model_code] = (newProd[mp.model_code] || 0) + mp.qty_received; });
    const totalSalesQty: Record<string, number> = {};
    sales.forEach(s => {
      [{ code: s.model1_code, qty: s.model1_qty }, { code: s.model2_code, qty: s.model2_qty },
       { code: s.model3_code, qty: s.model3_qty }, { code: s.model4_code, qty: s.model4_qty },
       { code: s.model5_code, qty: s.model5_qty }].forEach(({ code, qty }) => {
        if (code && qty > 0) totalSalesQty[code] = (totalSalesQty[code] || 0) + qty;
      });
    });
    const returnQty: Record<string, number> = {};
    returns_.forEach(r => { if (r.model_code) returnQty[r.model_code] = (returnQty[r.model_code] || 0) + r.model_qty; });

    let stockValue = 0;
    readyStock.forEach(rs => {
      const actual = Math.max(0, rs.opening_balance + (newProd[rs.model_code] || 0) - (totalSalesQty[rs.model_code] || 0) + (returnQty[rs.model_code] || 0));
      stockValue += actual * rs.cost_per_piece;
    });

    const accessoriesValue = accessories.reduce((s, a) => s + Math.max(0, a.qty_in - a.qty_consumed) * a.cost, 0);
    const netPartners = (hatemIn - hatemOut) + (midoIn - midoOut);
    const totalCurrentAssets = fabricValue + stockValue + accessoriesValue + moneyOwedToUs + netPartners - remainingDebts;

    // Fixed assets
    const totalFixedAssets = fixedAssets.reduce((s, a) => s + a.value, 0);

    // Totals
    const totalAssets = totalCurrentAssets + totalFixedAssets;
    const netPosition = totalAssets - remainingDebts;

    return res.json({
      fabric_value: fabricValue,
      stock_value: stockValue,
      accessories_value: accessoriesValue,
      money_owed_to_us: moneyOwedToUs,
      cash_available: cashAvailable,
      total_current_assets: totalCurrentAssets,
      total_fixed_assets: totalFixedAssets,
      total_assets: totalAssets,
      total_debts: remainingDebts,
      net_position: netPosition,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حساب المركز المالي' });
  }
});

export default router;