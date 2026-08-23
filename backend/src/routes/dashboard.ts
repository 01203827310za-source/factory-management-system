import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { FuzzyKeyIndex } from '../utils/textMatch';

const router = Router();
router.use(authenticate);

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [sales, expenses, debts, clientAccts, returns_, paymentLogs, fabric, readyStock, accessories] = await Promise.all([
      prisma.sale.findMany(),
      prisma.expenseRevenue.findMany(),
      prisma.debt.findMany(),
      prisma.clientAccount.findMany(),
      prisma.returnItem.findMany(),
      prisma.paymentLog.findMany(),
      prisma.fabricWarehouse.findMany(),
      prisma.readyStock.findMany(),
      prisma.accessoriesWarehouse.findMany(),
    ]);

    const totalSales = sales.reduce((s, sale) => s + sale.invoice_value, 0);
    const totalReservations = sales
      .filter(s => s.order_status === 'تم الحجز')
      .reduce((s, sale) => s + sale.invoice_value, 0);

    const depositIn      = sales.reduce((s, sale) => s + sale.deposit_paid, 0);
    const remainingIn    = sales
      .filter(s => s.order_status === 'تم الصرف')
      .reduce((s, sale) => s + sale.remaining, 0);
    const clientPayIn    = paymentLogs
      .filter(p => p.type === 'client_payment')
      .reduce((s, p) => s + p.amount, 0);
    const debtOut        = paymentLogs
      .filter(p => p.type === 'debt_payment')
      .reduce((s, p) => s + p.amount, 0);
    const refundOut      = returns_.reduce((s, r) => s + r.refund_amount, 0);

    const totalIn  = expenses.reduce((s, e) => s + e.amount_in, 0) + depositIn + remainingIn + clientPayIn;
    const totalOut = expenses.reduce((s, e) => s + e.amount_out, 0) + debtOut + refundOut;
    const netProfit = totalIn - totalOut;

    const remainingDebts = debts.reduce((s, d) => s + d.remaining, 0);
    const moneyOwedToUs =
      sales.filter(s => s.order_status === 'لم يتم الصرف').reduce((s, sale) => s + sale.remaining, 0) +
      clientAccts.reduce((s, ca) => s + ca.remaining, 0);
    const cashAvailable = totalIn - totalOut - remainingDebts;

    const salesByMarketer: Record<string, number> = {};
    sales.forEach(s => { salesByMarketer[s.marketer] = (salesByMarketer[s.marketer] || 0) + s.invoice_value; });

    const orderStatusCounts: Record<string, number> = {};
    sales.forEach(s => { orderStatusCounts[s.order_status] = (orderStatusCounts[s.order_status] || 0) + 1; });

    const cuttingOrders = await prisma.cuttingOrder.findMany();
    const fabricIndex = new FuzzyKeyIndex(['color', 'color']); // [material_type, color]
    const fabricConsumed: Record<string, number> = {};
    cuttingOrders.forEach(c => {
      const key = fabricIndex.resolve([c.material_type, c.color]);
      fabricConsumed[key] = (fabricConsumed[key] || 0) + c.kg_consumed;
    });
    let fabricValue = 0;
    const fabricItems: Array<{ material_type: string; color: string; available_qty: number; unit_cost: number; total: number }> = [];
    fabric.forEach(f => {
      const consumed = fabricConsumed[fabricIndex.resolve([f.material_type, f.color])] || 0;
      const available = Math.max(0, f.qty_in - consumed);
      const wac = f.avg_cost_per_kg > 0 ? f.avg_cost_per_kg : f.cost_per_kg;
      const total = available * wac;
      fabricValue += total;
      if (total !== 0) {
        fabricItems.push({ material_type: f.material_type, color: f.color, available_qty: available, unit_cost: wac, total });
      }
    });

    // Cutting inventory value: SUM(remaining_pieces × cost_per_meter)
    const allModelParts = await prisma.modelPart.findMany({
      include: { model: { select: { qty_from_cutting: true } } },
    });
    const cutIndex = new FuzzyKeyIndex(['exact', 'color']); // [cut_number, color]
    const usedByKey = new Map<string, number>();
    allModelParts.forEach(p => {
      const key = cutIndex.resolve([p.cut_number, p.color]);
      usedByKey.set(key, (usedByKey.get(key) || 0) + p.model.qty_from_cutting);
    });
    let cuttingInventoryValue = 0;
    const cuttingItems: Array<{ cut_number: number; cut_description: string; material_type: string; color: string; total_pieces: number; used_pieces: number; remaining_pieces: number; cost_per_meter: number; total: number }> = [];
    cuttingOrders.forEach(c => {
      const key = cutIndex.resolve([c.cut_number, c.color]);
      const used = usedByKey.get(key) || 0;
      const remaining = Math.max(0, c.total_pieces - used);
      const total = remaining * (c.cost_per_meter || 0);
      cuttingInventoryValue += total;
      if (total !== 0) {
        cuttingItems.push({
          cut_number: c.cut_number, cut_description: c.cut_description, material_type: c.material_type, color: c.color,
          total_pieces: c.total_pieces, used_pieces: used, remaining_pieces: remaining, cost_per_meter: c.cost_per_meter || 0, total,
        });
      }
    });

    // WIP value: SUM(qty_received × cost_per_piece) WHERE status = 'قيد التشغيل'
    // Models that move to 'تام' are automatically excluded — no double-counting with stockValue.
    const modelProds = await prisma.modelProduction.findMany();
    const wipRecords = modelProds.filter(mp => mp.status === 'قيد التشغيل');
    const wipValue = wipRecords.reduce((s, mp) => s + mp.qty_received * ((mp as any).cost_per_piece || 0), 0);
    const wipItems = wipRecords
      .map(mp => ({
        model_code: mp.model_code, model_description: mp.model_description, color: mp.color,
        qty_received: mp.qty_received, cost_per_piece: (mp as any).cost_per_piece || 0,
        total: mp.qty_received * ((mp as any).cost_per_piece || 0), status: mp.status,
      }))
      .filter(item => item.total !== 0);

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
          if (code && qty > 0) { const k = modelIndex.resolve([code, color || '']); totalSalesQty[k] = (totalSalesQty[k] || 0) + qty; }
        });
      });
    const returnQty: Record<string, number> = {};
    returns_.forEach(r => {
      if (r.model_code) { const k = modelIndex.resolve([r.model_code, r.model_color || '']); returnQty[k] = (returnQty[k] || 0) + r.model_qty; }
    });

    let stockValue = 0;
    const stockItems: Array<{ model_code: string; product_name: string; color: string; actual_qty: number; reserved_qty: number; available_qty: number; unit_cost: number; total: number }> = [];
    readyStock.forEach(rs => {
      const k = modelIndex.resolve([rs.model_code, rs.color || '']);
      const prod = newProd[k] || 0;
      const sold = totalSalesQty[k] || 0;
      const returned = returnQty[k] || 0;
      const actual = Math.max(0, rs.opening_balance + prod - sold + returned);
      const available = Math.max(0, actual - rs.reserved_quantity);
      const total = available * rs.cost_per_piece;
      stockValue += total;
      if (total !== 0) {
        stockItems.push({
          model_code: rs.model_code, product_name: rs.product_name, color: rs.color,
          actual_qty: actual, reserved_qty: rs.reserved_quantity, available_qty: available,
          unit_cost: rs.cost_per_piece, total,
        });
      }
    });

    const accessoriesItems: Array<{ item_name: string; qty: number; unit_cost: number; total: number }> = [];
    const accessoriesValue = accessories.reduce((s, a) => {
      const qty = Math.max(0, a.qty_in - a.qty_consumed);
      const total = qty * a.cost;
      if (total !== 0) accessoriesItems.push({ item_name: a.item_name, qty, unit_cost: a.cost, total });
      return s + total;
    }, 0);

    const receivableItems: Array<{ source: 'sale' | 'client_account'; name: string; reference: string; invoice_total: number; paid: number; remaining: number }> = [];
    sales
      .filter(s => s.order_status === 'لم يتم الصرف' && s.remaining !== 0)
      .forEach(s => {
        receivableItems.push({
          source: 'sale', name: s.client, reference: s.order_number,
          invoice_total: s.invoice_value, paid: s.deposit_paid, remaining: s.remaining,
        });
      });
    clientAccts
      .filter(ca => ca.remaining !== 0)
      .forEach(ca => {
        receivableItems.push({
          source: 'client_account', name: ca.client_name, reference: ca.model_name,
          invoice_total: ca.total_amount, paid: ca.amount_paid, remaining: ca.remaining,
        });
      });
    // Total current assets = warehouses + remaining cutting pieces + WIP + receivables.
    // Deliberately excludes cash/net-profit/debts and Fixed Assets — those live in the Financial Center, not here.
    const totalCurrentAssets = fabricValue + stockValue + accessoriesValue + cuttingInventoryValue + wipValue + moneyOwedToUs;

    const _today = new Date().toISOString().slice(0, 10);
    setImmediate(() => {
      prisma.financialSnapshot.upsert({
        where:  { snapshot_date: _today },
        update: { total_current_assets: totalCurrentAssets, cash: cashAvailable, fabric_assets: fabricValue, ready_stock_assets: stockValue, accessories_assets: accessoriesValue, receivables: moneyOwedToUs, debts: remainingDebts },
        create: { snapshot_date: _today, total_current_assets: totalCurrentAssets, cash: cashAvailable, fabric_assets: fabricValue, ready_stock_assets: stockValue, accessories_assets: accessoriesValue, receivables: moneyOwedToUs, debts: remainingDebts },
      }).catch((e: Error) => console.error('Auto-snapshot failed:', e.message));
    });

    return res.json({
      total_sales: totalSales,
      total_expenses: totalOut,
      net_profit: netProfit,
      remaining_debts: remainingDebts,
      total_in: totalIn,
      total_out: totalOut,
      cash_available: cashAvailable,
      money_owed_to_us: moneyOwedToUs,
      sales_by_marketer: salesByMarketer,
      order_status_counts: orderStatusCounts,
      total_returns: returns_.length,
      total_refunds: refundOut,
      total_current_assets: totalCurrentAssets,
      fabric_value: fabricValue,
      stock_value: stockValue,
      accessories_value: accessoriesValue,
      cutting_value: cuttingInventoryValue,
      wip_value: wipValue,
      total_reservations: totalReservations,
      fabric_items: fabricItems,
      stock_items: stockItems,
      accessories_items: accessoriesItems,
      cutting_items: cuttingItems,
      wip_items: wipItems,
      receivable_items: receivableItems,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حساب الإحصائيات' });
  }
});

export default router;
