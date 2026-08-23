import prisma from '../lib/prisma';
import { FuzzyKeyIndex } from '../utils/textMatch';

export type SnapshotData = {
  total_current_assets: number;
  cash: number;
  fabric_assets: number;
  ready_stock_assets: number;
  accessories_assets: number;
  receivables: number;
  debts: number;
};

export async function computeSnapshot(): Promise<SnapshotData> {
  const [
    sales, expenses, debtsData, clientAccts, returns_,
    paymentLogs, fabric, readyStock, accessories,
    cuttingOrders, modelProds,
  ] = await Promise.all([
    prisma.sale.findMany(),
    prisma.expenseRevenue.findMany(),
    prisma.debt.findMany(),
    prisma.clientAccount.findMany(),
    prisma.returnItem.findMany(),
    prisma.paymentLog.findMany(),
    prisma.fabricWarehouse.findMany(),
    prisma.readyStock.findMany(),
    prisma.accessoriesWarehouse.findMany(),
    prisma.cuttingOrder.findMany(),
    prisma.modelProduction.findMany(),
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
  const netCash  = totalIn - totalOut;

  const remainingDebts = debtsData.reduce((s, d) => s + d.remaining, 0);
  const moneyOwedToUs  =
    sales.filter(s => s.order_status === 'لم يتم الصرف').reduce((s, sale) => s + sale.remaining, 0) +
    clientAccts.reduce((s, ca) => s + ca.remaining, 0);

  const fabricIndex = new FuzzyKeyIndex(['color', 'color']); // [material_type, color]
  const fabricConsumed: Record<string, number> = {};
  cuttingOrders.forEach(c => {
    const key = fabricIndex.resolve([c.material_type, c.color]);
    fabricConsumed[key] = (fabricConsumed[key] || 0) + c.kg_consumed;
  });
  let fabricValue = 0;
  fabric.forEach(f => {
    const consumed  = fabricConsumed[fabricIndex.resolve([f.material_type, f.color])] || 0;
    const available = Math.max(0, f.qty_in - consumed);
    const wac       = f.avg_cost_per_kg > 0 ? f.avg_cost_per_kg : f.cost_per_kg;
    fabricValue    += available * wac;
  });

  const modelIndex = new FuzzyKeyIndex(['model', 'color']); // [model_code, color]
  const newProd: Record<string, number> = {};
  modelProds.forEach(mp => {
    const k = modelIndex.resolve([mp.model_code, mp.color || '']);
    newProd[k] = (newProd[k] || 0) + mp.qty_received;
  });
  const totalSalesQty: Record<string, number> = {};
  sales
    .filter(s => s.order_status !== 'تم الحجز' && s.order_status !== 'تم الإلغاء')
    .forEach(s => {
      [
        { code: s.model1_code, qty: s.model1_qty, color: s.model1_color },
        { code: s.model2_code, qty: s.model2_qty, color: s.model2_color },
        { code: s.model3_code, qty: s.model3_qty, color: s.model3_color },
        { code: s.model4_code, qty: s.model4_qty, color: s.model4_color },
        { code: s.model5_code, qty: s.model5_qty, color: s.model5_color },
      ].forEach(({ code, qty, color }) => {
        if (code && qty > 0) {
          const k = modelIndex.resolve([code, color || '']);
          totalSalesQty[k] = (totalSalesQty[k] || 0) + qty;
        }
      });
    });
  const returnQty: Record<string, number> = {};
  returns_.forEach(r => {
    if (r.model_code) {
      const k = modelIndex.resolve([r.model_code, r.model_color || '']);
      returnQty[k] = (returnQty[k] || 0) + r.model_qty;
    }
  });
  let stockValue = 0;
  readyStock.forEach(rs => {
    const k        = modelIndex.resolve([rs.model_code, rs.color || '']);
    const actual   = Math.max(0, rs.opening_balance + (newProd[k] || 0) - (totalSalesQty[k] || 0) + (returnQty[k] || 0));
    const available = Math.max(0, actual - rs.reserved_quantity);
    stockValue     += available * rs.cost_per_piece;
  });

  const accessoriesValue = accessories
    .reduce((s, a) => s + Math.max(0, a.qty_in - a.qty_consumed) * a.cost, 0);

  const cash               = netCash - remainingDebts;
  const totalCurrentAssets = fabricValue + stockValue + accessoriesValue + moneyOwedToUs + cash;

  return {
    total_current_assets: totalCurrentAssets,
    cash,
    fabric_assets:       fabricValue,
    ready_stock_assets:  stockValue,
    accessories_assets:  accessoriesValue,
    receivables:         moneyOwedToUs,
    debts:               remainingDebts,
  };
}
