import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { computeFinancialSummary } from '../services/financialMetrics';

const router = Router();
router.use(authenticate);

type AllData = Awaited<ReturnType<typeof fetchAll>>;

async function fetchAll() {
  const [sales, expenses, debts, clientAccts, returns_, paymentLogs, fabric, readyStock, accessories, modelProds, cuttingOrders] = await Promise.all([
    prisma.sale.findMany({ orderBy: { created_at: 'asc' } }),
    prisma.expenseRevenue.findMany({ orderBy: { date: 'asc' } }),
    prisma.debt.findMany({ orderBy: { date: 'asc' } }),
    prisma.clientAccount.findMany({ orderBy: { date: 'asc' } }),
    prisma.returnItem.findMany({ orderBy: { date: 'asc' } }),
    prisma.paymentLog.findMany({ orderBy: { date: 'asc' } }),
    prisma.fabricWarehouse.findMany(),
    prisma.readyStock.findMany(),
    prisma.accessoriesWarehouse.findMany(),
    prisma.modelProduction.findMany({ orderBy: { date: 'asc' } }),
    prisma.cuttingOrder.findMany({ orderBy: { date: 'asc' } }),
  ]);
  return { sales, expenses, debts, clientAccts, returns_, paymentLogs, fabric, readyStock, accessories, modelProds, cuttingOrders };
}

const sd = (s: AllData['sales'][0]) => s.created_at.toISOString().slice(0, 10);

function computeCapitalSnapshot(db: AllData, upToDate: string) {
  const { sales, expenses, debts, clientAccts, returns_, paymentLogs, fabric, readyStock, accessories, modelProds, cuttingOrders } = db;

  const newProd: Record<string, number> = {};
  modelProds.filter(mp => mp.date <= upToDate).forEach(mp => {
    const k = `${mp.model_code}|${mp.color || ''}`;
    newProd[k] = (newProd[k] || 0) + mp.qty_received;
  });

  const soldQty: Record<string, number> = {};
  sales.filter(s => sd(s) <= upToDate && s.order_status !== 'تم الحجز' && s.order_status !== 'تم الإلغاء').forEach(s => {
    [{ c: s.model1_code, q: s.model1_qty, col: s.model1_color },
     { c: s.model2_code, q: s.model2_qty, col: s.model2_color },
     { c: s.model3_code, q: s.model3_qty, col: s.model3_color },
     { c: s.model4_code, q: s.model4_qty, col: s.model4_color },
     { c: s.model5_code, q: s.model5_qty, col: s.model5_color }].forEach(({ c, q, col }) => {
      if (c && q > 0) { const k = `${c}|${col || ''}`; soldQty[k] = (soldQty[k] || 0) + q; }
    });
  });

  const retQty: Record<string, number> = {};
  returns_.filter(r => r.date <= upToDate).forEach(r => {
    if (r.model_code) { const k = `${r.model_code}|${r.model_color || ''}`; retQty[k] = (retQty[k] || 0) + r.model_qty; }
  });

  let stockValue = 0;
  readyStock.forEach(rs => {
    const k = `${rs.model_code}|${rs.color || ''}`;
    const actual = Math.max(0, rs.opening_balance + (newProd[k] || 0) - (soldQty[k] || 0) + (retQty[k] || 0));
    const available = Math.max(0, actual - rs.reserved_quantity);
    stockValue += available * rs.cost_per_piece;
  });

  const consumed: Record<string, number> = {};
  cuttingOrders.filter(c => c.date <= upToDate).forEach(c => {
    const key = `${c.material_type}|${c.color}`;
    consumed[key] = (consumed[key] || 0) + c.kg_consumed;
  });
  let fabricValue = 0;
  fabric.filter(f => f.date <= upToDate).forEach(f => {
    const avail = Math.max(0, f.qty_in - (consumed[`${f.material_type}|${f.color}`] || 0));
    const wac = f.avg_cost_per_kg > 0 ? f.avg_cost_per_kg : f.cost_per_kg;
    fabricValue += avail * wac;
  });

  let accValue = 0;
  accessories.filter(a => a.date <= upToDate).forEach(a => {
    accValue += Math.max(0, a.qty_in - a.qty_consumed) * a.cost;
  });

  const clientBalance  = clientAccts.filter(ca => ca.date <= upToDate).reduce((s, ca) => s + ca.remaining, 0);
  const salesRemaining = sales.filter(s => sd(s) <= upToDate && s.order_status === 'لم يتم الصرف').reduce((s, x) => s + x.remaining, 0);
  const moneyOwed      = salesRemaining + clientBalance;

  const financialSummary = computeFinancialSummary(
    { sales: sales.filter(s => sd(s) <= upToDate), expenses: expenses.filter(e => e.date <= upToDate), returns_: returns_.filter(r => r.date <= upToDate), paymentLogs: paymentLogs.filter(p => p.date <= upToDate) },
  );
  const cashNet    = financialSummary.total_net;
  const totalDebts = debts.filter(d => d.date <= upToDate).reduce((s, d) => s + d.remaining, 0);

  const totalAssets = stockValue + fabricValue + accValue + moneyOwed + cashNet;
  const netAssets   = totalAssets - totalDebts;

  return { stock_value: stockValue, fabric_value: fabricValue, accessories_value: accValue, client_accounts: moneyOwed, cash: cashNet, total_assets: totalAssets, total_debts: totalDebts, net_assets: netAssets };
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const today    = new Date().toISOString().slice(0, 10);
    const fromDate = (req.query.from_date as string) || today;
    const toDate   = (req.query.to_date   as string) || today;

    const db = await fetchAll();
    const { sales, expenses, debts, clientAccts, returns_, paymentLogs, fabric, readyStock, accessories, modelProds, cuttingOrders } = db;

    const inRange     = (d: string) => d >= fromDate && d <= toDate;
    const financialSummary = computeFinancialSummary({ sales, expenses, returns_, paymentLogs });

    const salesInRange = sales.filter(s => inRange(sd(s)));

    const marketerMap: Record<string, { count: number; value: number; remaining: number }> = {};
    salesInRange.forEach(s => {
      const m = s.marketer || 'غير محدد';
      if (!marketerMap[m]) marketerMap[m] = { count: 0, value: 0, remaining: 0 };
      marketerMap[m].count++;
      marketerMap[m].value     += s.invoice_value;
      marketerMap[m].remaining += s.remaining;
    });
    const byMarketer  = Object.entries(marketerMap).map(([marketer, d]) => ({ marketer, ...d })).sort((a, b) => b.value - a.value);
    const topMarketer = byMarketer[0]?.marketer || '';

    const modelQtyMap: Record<string, number> = {};
    salesInRange.forEach(s => {
      [{ c: s.model1_code, q: s.model1_qty }, { c: s.model2_code, q: s.model2_qty },
       { c: s.model3_code, q: s.model3_qty }, { c: s.model4_code, q: s.model4_qty },
       { c: s.model5_code, q: s.model5_qty }].forEach(({ c, q }) => {
        if (c && q > 0) modelQtyMap[c] = (modelQtyMap[c] || 0) + q;
      });
    });
    const topModel = Object.entries(modelQtyMap).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    const newProdAll: Record<string, number> = {};
    modelProds.forEach(mp => {
      const k = `${mp.model_code}|${mp.color || ''}`;
      newProdAll[k] = (newProdAll[k] || 0) + mp.qty_received;
    });

    const soldQtyAll: Record<string, number> = {};
    sales.filter(s => s.order_status !== 'تم الحجز' && s.order_status !== 'تم الإلغاء').forEach(s => {
      [{ c: s.model1_code, q: s.model1_qty, col: s.model1_color },
       { c: s.model2_code, q: s.model2_qty, col: s.model2_color },
       { c: s.model3_code, q: s.model3_qty, col: s.model3_color },
       { c: s.model4_code, q: s.model4_qty, col: s.model4_color },
       { c: s.model5_code, q: s.model5_qty, col: s.model5_color }].forEach(({ c, q, col }) => {
        if (c && q > 0) { const k = `${c}|${col || ''}`; soldQtyAll[k] = (soldQtyAll[k] || 0) + q; }
      });
    });

    const retQtyAll: Record<string, number> = {};
    returns_.forEach(r => {
      if (r.model_code) { const k = `${r.model_code}|${r.model_color || ''}`; retQtyAll[k] = (retQtyAll[k] || 0) + r.model_qty; }
    });

    const stockDetails = readyStock.map(rs => {
      const k        = `${rs.model_code}|${rs.color || ''}`;
      const actual   = rs.opening_balance + (newProdAll[k] || 0) - (soldQtyAll[k] || 0) + (retQtyAll[k] || 0);
      const reserved = rs.reserved_quantity;
      return { model_code: rs.model_code, product_name: rs.product_name, actual, reserved, available: actual - reserved };
    });

    const totalStockQty    = stockDetails.reduce((s, x) => s + x.actual, 0);
    const totalReservedQty = stockDetails.reduce((s, x) => s + x.reserved, 0);
    const lowStock         = stockDetails.filter(x => x.available >= 0 && x.available < 10);

    const fabricConsumedAll: Record<string, number> = {};
    cuttingOrders.forEach(c => {
      const key = `${c.material_type}|${c.color}`;
      fabricConsumedAll[key] = (fabricConsumedAll[key] || 0) + c.kg_consumed;
    });
    let fabricValue = 0; let fabricBalanceKg = 0;
    fabric.forEach(f => {
      const avail = Math.max(0, f.qty_in - (fabricConsumedAll[`${f.material_type}|${f.color}`] || 0));
      const wac   = f.avg_cost_per_kg > 0 ? f.avg_cost_per_kg : f.cost_per_kg;
      fabricValue    += avail * wac;
      fabricBalanceKg += avail;
    });

    let accessoriesValue = 0; let accessoriesBalance = 0;
    accessories.forEach(a => {
      const avail = Math.max(0, a.qty_in - a.qty_consumed);
      accessoriesValue  += avail * a.cost;
      accessoriesBalance += avail;
    });

    const clientMap: Record<string, { value: number; remaining: number }> = {};
    salesInRange.forEach(s => {
      const c = s.client || 'غير محدد';
      if (!clientMap[c]) clientMap[c] = { value: 0, remaining: 0 };
      clientMap[c].value     += s.invoice_value;
      clientMap[c].remaining += s.remaining;
    });
    const topClients      = Object.entries(clientMap).map(([client, d]) => ({ client, ...d })).sort((a, b) => b.value - a.value).slice(0, 15);
    const totalOutstanding = sales.filter(s => s.order_status === 'لم يتم الصرف').reduce((s, x) => s + x.remaining, 0) + clientAccts.reduce((s, ca) => s + ca.remaining, 0);
    const debtsList       = debts.filter(d => d.remaining > 0).map(d => ({ name: d.name, remaining: d.remaining }));

    const reservSales = sales.filter(s => s.order_status === 'تم الحجز');
    const reservValue = reservSales.reduce((s, x) => s + x.invoice_value, 0);
    const reservItems = stockDetails.filter(x => x.reserved > 0);
    const shortages   = stockDetails.filter(x => x.available < 0);

    const allSalesValue = sales.reduce((s, x) => s + x.invoice_value, 0);
    const allDebts      = debts.reduce((s, d) => s + d.remaining, 0);

    const startSnap  = computeCapitalSnapshot(db, fromDate);
    const endSnap    = computeCapitalSnapshot(db, toDate);
    const growthAmt  = endSnap.net_assets - startSnap.net_assets;
    const growthPct  = startSnap.net_assets !== 0 ? (growthAmt / Math.abs(startSnap.net_assets)) * 100 : null;

    return res.json({
      summary: {
        total_sales:       allSalesValue,
        total_expenses:    financialSummary.total_out,
        net_profit:        financialSummary.total_net,
        total_reservations: reservValue,
        total_debts:       allDebts,
      },
      sales_report: {
        total_orders:        salesInRange.length,
        total_invoice_value: salesInRange.reduce((s, x) => s + x.invoice_value, 0),
        total_deposits:      salesInRange.reduce((s, x) => s + x.deposit_paid, 0),
        total_remaining:     salesInRange.reduce((s, x) => s + x.remaining, 0),
        top_marketer:        topMarketer,
        top_model:           topModel,
        by_marketer:         byMarketer,
      },
      inventory_report: {
        total_qty:           totalStockQty,
        reserved_qty:        totalReservedQty,
        available_qty:       totalStockQty - totalReservedQty,
        low_stock:           lowStock,
        fabric_value:        fabricValue,
        fabric_balance_kg:   fabricBalanceKg,
        accessories_value:   accessoriesValue,
        accessories_balance: accessoriesBalance,
      },
      financial_report: {
        total_revenues: financialSummary.total_in,
        total_expenses: financialSummary.total_out,
        net_profit:     financialSummary.total_net,
      },
      customers_report: {
        top_clients:      topClients,
        total_outstanding: totalOutstanding,
        debts:            debtsList,
      },
      reservations_report: {
        count:     reservSales.length,
        value:     reservValue,
        items:     reservItems,
        shortages,
      },
      capital_growth: {
        start:          startSnap,
        end:            endSnap,
        growth_amount:  growthAmt,
        growth_percent: growthPct,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إنشاء التقرير' });
  }
});

// ─── GET /api/reports/cash-flow ───────────────────────────────────────────────

type CashTx = {
  date: string;
  type: string;
  description: string;
  client: string;
  amount: number;
  direction: 'in' | 'out';
};

router.get('/employee-movements', async (req: Request, res: Response) => {
  try {
    const today    = new Date().toISOString().slice(0, 10);
    const fromDate = (req.query.from_date as string) || today;
    const toDate   = (req.query.to_date   as string) || today;

    const [sales, expenses, paymentLogs, returns_] = await Promise.all([
      prisma.sale.findMany({ orderBy: { created_at: 'asc' } }),
      prisma.expenseRevenue.findMany({ orderBy: { date: 'asc' } }),
      prisma.paymentLog.findMany({ orderBy: { date: 'asc' } }),
      prisma.returnItem.findMany({ orderBy: { date: 'asc' } }),
    ]);

    const inRange = (d: string) => d >= fromDate && d <= toDate;
    const saleD   = (s: typeof sales[0]) => s.created_at.toISOString().slice(0, 10);

    const transactions: CashTx[] = [];

    // 1. Order deposits
    sales
      .filter(s => s.deposit_paid > 0 && inRange(saleD(s)))
      .forEach(s => transactions.push({
        date: saleD(s), type: 'عربون أوردر',
        description: `أوردر رقم ${s.order_number}`, client: s.client,
        amount: s.deposit_paid, direction: 'in',
      }));

    // 2. Remaining payments on dispatched orders
    sales
      .filter(s => s.order_status === 'تم الصرف' && s.remaining !== 0 && inRange(saleD(s)))
      .forEach(s => transactions.push({
        date: saleD(s), type: 'متبقي أوردر',
        description: `أوردر رقم ${s.order_number} — تم الصرف`, client: s.client,
        amount: Math.abs(s.remaining), direction: s.remaining > 0 ? 'in' : 'out',
      }));

    // 3. Client payment collections
    paymentLogs
      .filter(p => p.type === 'client_payment' && p.amount > 0 && inRange(p.date))
      .forEach(p => transactions.push({
        date: p.date, type: 'تحصيل من عميل',
        description: p.description || 'تحصيل', client: '',
        amount: p.amount, direction: 'in',
      }));

    // 4. Expense revenues — amount_in
    expenses
      .filter(e => inRange(e.date) && e.amount_in > 0)
      .forEach(e => transactions.push({
        date: e.date, type: `وارد — ${e.operation_type}`,
        description: e.statement, client: '',
        amount: e.amount_in, direction: 'in',
      }));

    // 5. Expense revenues — amount_out
    expenses
      .filter(e => inRange(e.date) && e.amount_out > 0)
      .forEach(e => transactions.push({
        date: e.date, type: `منصرف — ${e.operation_type}`,
        description: e.statement, client: '',
        amount: e.amount_out, direction: 'out',
      }));

    // 6. Debt payments
    paymentLogs
      .filter(p => p.type === 'debt_payment' && p.amount > 0 && inRange(p.date))
      .forEach(p => transactions.push({
        date: p.date, type: 'سداد دين',
        description: p.description || 'سداد ديون', client: '',
        amount: p.amount, direction: 'out',
      }));

    // 7. Refunds
    returns_
      .filter(r => r.refund_amount > 0 && inRange(r.date))
      .forEach(r => transactions.push({
        date: r.date, type: 'مرتجع',
        description: `مرتجع أوردر ${r.order_number}`, client: r.client_name,
        amount: r.refund_amount, direction: 'out',
      }));

    transactions.sort((a, b) => a.date.localeCompare(b.date));

    const totalReceived = transactions.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0);
    const totalPaid     = transactions.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0);

    const expInRange = expenses.filter(e => inRange(e.date));

    return res.json({
      from_date: fromDate,
      to_date:   toDate,
      summary: {
        total_received:    totalReceived,
        total_paid:        totalPaid,
        net_balance:       totalReceived - totalPaid,
        transaction_count: transactions.length,
      },
      expenses_breakdown: {
        exp_in:  expInRange.reduce((s, e) => s + e.amount_in,  0),
        exp_out: expInRange.reduce((s, e) => s + e.amount_out, 0),
      },
      transactions,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إنشاء تقرير التدفق النقدي' });
  }
});

export default router;
