import prisma from '../lib/prisma';

export type SnapshotData = {
  total_current_assets: number;
  cash: number;
  fabric_assets: number;
  ready_stock_assets: number;
  accessories_assets: number;
  receivables: number;
  debts: number;
};

// Replicates the exact computation from dashboard.ts so snapshots are consistent.
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

  // ── Partner cash flows ──────────────────────────────────────────
  const hatemPaymentIn = paymentLogs
    .filter(p => p.receiver === 'حاتم' && p.type === 'client_payment')
    .reduce((s, p) => s + p.amount, 0);
  const midoPaymentIn = paymentLogs
    .filter(p => p.receiver === 'ميدو' && p.type === 'client_payment')
    .reduce((s, p) => s + p.amount, 0);
  const hatemDebtOut = paymentLogs
    .filter(p => p.type === 'debt_payment' && p.receiver === 'حاتم')
    .reduce((s, p) => s + p.amount, 0);
  const midoDebtOut = paymentLogs
    .filter(p => p.type === 'debt_payment' && p.receiver === 'ميدو')
    .reduce((s, p) => s + p.amount, 0);

  const hatemDepositIn = sales
    .filter(s => s.deposit_receiver === 'حاتم')
    .reduce((s, sale) => s + sale.deposit_paid, 0);
  const midoDepositIn = sales
    .filter(s => s.deposit_receiver === 'ميدو')
    .reduce((s, sale) => s + sale.deposit_paid, 0);
  const hatemRemainingIn = sales
    .filter(s => s.order_status === 'تم الصرف')
    .reduce((s, sale) => s + sale.remaining, 0);

  const hatemReturnOut = returns_
    .filter(r => r.paid_by === 'حاتم')
    .reduce((s, r) => s + r.refund_amount, 0);
  const midoReturnOut = returns_
    .filter(r => r.paid_by === 'ميدو')
    .reduce((s, r) => s + r.refund_amount, 0);

  const hatemIn  = expenses.reduce((s, e) => s + e.hatem_in, 0)  + hatemDepositIn + hatemRemainingIn + hatemPaymentIn;
  const hatemOut = expenses.reduce((s, e) => s + e.hatem_out, 0) + hatemDebtOut   + hatemReturnOut;
  const midoIn   = expenses.reduce((s, e) => s + e.mido_in, 0)   + midoDepositIn  + midoPaymentIn;
  const midoOut  = expenses.reduce((s, e) => s + e.mido_out, 0)  + midoDebtOut    + midoReturnOut;

  const netPartners  = (hatemIn - hatemOut) + (midoIn - midoOut);
  const remainingDebts = debtsData.reduce((s, d) => s + d.remaining, 0);

  const moneyOwedToUs =
    sales.filter(s => s.order_status === 'لم يتم الصرف').reduce((s, sale) => s + sale.remaining, 0) +
    clientAccts.reduce((s, ca) => s + ca.remaining, 0);

  // ── Fabric value (weighted average cost) ───────────────────────
  const fabricConsumed: Record<string, number> = {};
  cuttingOrders.forEach(c => {
    const key = `${c.material_type}|${c.color}`;
    fabricConsumed[key] = (fabricConsumed[key] || 0) + c.kg_consumed;
  });
  let fabricValue = 0;
  fabric.forEach(f => {
    const consumed  = fabricConsumed[`${f.material_type}|${f.color}`] || 0;
    const available = Math.max(0, f.qty_in - consumed);
    const wac       = f.avg_cost_per_kg > 0 ? f.avg_cost_per_kg : f.cost_per_kg;
    fabricValue    += available * wac;
  });

  // ── Ready-stock value ───────────────────────────────────────────
  const newProd: Record<string, number> = {};
  modelProds.forEach(mp => {
    const k = `${mp.model_code}|${mp.color || ''}`;
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
          const k = `${code}|${color || ''}`;
          totalSalesQty[k] = (totalSalesQty[k] || 0) + qty;
        }
      });
    });
  const returnQty: Record<string, number> = {};
  returns_.forEach(r => {
    if (r.model_code) {
      const k = `${r.model_code}|${r.model_color || ''}`;
      returnQty[k] = (returnQty[k] || 0) + r.model_qty;
    }
  });
  let stockValue = 0;
  readyStock.forEach(rs => {
    const k        = `${rs.model_code}|${rs.color || ''}`;
    const actual   = Math.max(0, rs.opening_balance + (newProd[k] || 0) - (totalSalesQty[k] || 0) + (returnQty[k] || 0));
    const available = Math.max(0, actual - rs.reserved_quantity);
    stockValue     += available * rs.cost_per_piece;
  });

  const accessoriesValue = accessories
    .reduce((s, a) => s + Math.max(0, a.qty_in - a.qty_consumed) * a.cost, 0);

  const cash               = netPartners - remainingDebts;
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
