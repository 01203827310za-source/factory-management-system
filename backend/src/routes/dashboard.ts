import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { FuzzyKeyIndex } from '../utils/textMatch';
import { getSeasonId, seasonWhere } from '../services/seasonContext';
import { computeDashboardCashFlow } from '../services/financialMetrics';
import { computeStockPositions, isStockDeducting, STATUS_CANCELED, STATUS_RESERVED, valueStockRow } from '../services/readyStockPositions';
import { costOfGoodsShipped, returnsCostCredit, type MovementRow } from '../services/inventoryMovements';
import { analyseShipments, findReceivableOverlap } from '../services/receivablesAudit';

const router = Router();
router.use(authenticate);

router.get('/', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const [sales, expenses, debts, clientAccts, returns_, paymentLogs, fabric, readyStock, accessories] = await Promise.all([
      prisma.sale.findMany({ where: seasonWhere(seasonId) }),
      prisma.expenseRevenue.findMany({ where: seasonWhere(seasonId) }),
      prisma.debt.findMany({ where: seasonWhere(seasonId) }),
      prisma.clientAccount.findMany({ where: seasonWhere(seasonId) }),
      prisma.returnItem.findMany({ where: seasonWhere(seasonId) }),
      prisma.paymentLog.findMany({ where: seasonWhere(seasonId) }),
      prisma.fabricWarehouse.findMany({ where: seasonWhere(seasonId) }),
      prisma.readyStock.findMany({ where: seasonWhere(seasonId) }),
      prisma.accessoriesWarehouse.findMany({ where: seasonWhere(seasonId) }),
    ]);

    const totalSales = sales.reduce((s, sale) => s + sale.invoice_value, 0);
    const totalReservations = sales
      .filter(s => s.order_status === 'تم الحجز')
      .reduce((s, sale) => s + sale.invoice_value, 0);

    // Shared with the /breakdown endpoints so cards and drill-downs always reconcile.
    const { totalIn, totalOut, netProfit, refundOut } = computeDashboardCashFlow({ sales, expenses, returns_, paymentLogs });

    const remainingDebts = debts.reduce((s, d) => s + d.remaining, 0);
    const dispatchedUncollected = sales
      .filter(s => s.order_status === 'تم الصرف')
      .reduce((s, sale) => s + Math.max(0, sale.remaining - sale.shipping_collected), 0);
    const moneyOwedToUs =
      sales.filter(s => s.order_status === 'لم يتم الصرف').reduce((s, sale) => s + Math.max(0, sale.remaining), 0) +
      dispatchedUncollected +
      clientAccts.reduce((s, ca) => s + Math.max(0, ca.remaining), 0);
    const cashAvailable = totalIn - totalOut - remainingDebts;

    const salesByMarketer: Record<string, number> = {};
    sales.forEach(s => { salesByMarketer[s.marketer] = (salesByMarketer[s.marketer] || 0) + s.invoice_value; });

    const orderStatusCounts: Record<string, number> = {};
    sales.forEach(s => { orderStatusCounts[s.order_status] = (orderStatusCounts[s.order_status] || 0) + 1; });

    const cuttingOrders = await prisma.cuttingOrder.findMany({ where: seasonWhere(seasonId) });
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
      where: seasonWhere(seasonId),
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
    const modelProds = await prisma.modelProduction.findMany({ where: seasonWhere(seasonId) });
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
    const stockItems: Array<{ model_code: string; product_name: string; color: string; actual_qty: number; reserved_qty: number; available_qty: number; unit_cost: number; total: number; reserved_value: number; available_value: number; pending_qty: number }> = [];
    // Reservations are ALLOCATED from stock that really exists (see computeStockPositions): an order that
    // asks for more than is available holds only what exists; the rest is pending, never an asset.
    const stockCtx = computeStockPositions({ readyStock, modelProds, sales, returns_ });
    const positionOf = new Map(stockCtx.positions.map(p => [p.row.id, p]));
    let stockReservedValue = 0;
    let stockAvailableValue = 0;
    readyStock.forEach(rs => {
      const k = modelIndex.resolve([rs.model_code, rs.color || '']);
      const prod = newProd[k] || 0;
      const sold = totalSalesQty[k] || 0;
      const returned = returnQty[k] || 0;
      const actual = Math.max(0, rs.opening_balance + prod - sold + returned);
      // Stock is valued at PHYSICAL quantity (available + reserved): reserved goods are still in
      // the factory, so reserving only moves value from "available" to "reserved".
      const pos = positionOf.get(rs.id);
      const v = valueStockRow(actual, pos?.reserved ?? 0, rs.cost_per_piece);
      const total = v.physicalValue;
      stockValue += total;
      stockReservedValue += v.reservedValue;
      stockAvailableValue += v.availableValue;
      if (total !== 0) {
        stockItems.push({
          model_code: rs.model_code, product_name: rs.product_name, color: rs.color,
          actual_qty: v.physicalQty, reserved_qty: v.reservedQty, available_qty: v.availableQty,
          unit_cost: rs.cost_per_piece, total, reserved_value: v.reservedValue, available_value: v.availableValue,
          pending_qty: pos?.pending ?? 0,
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

    const receivableItems: Array<{
      source: 'sale' | 'sale_shipping_gap' | 'client_account'; name: string; reference: string; invoice_total: number; paid: number; remaining: number;
      // sale-sourced rows only: which order it is, and whether its goods are really out of stock value
      sale_id?: number; stock_status?: string; inventory_still_in_stock?: boolean; duplicate_in_client_account?: boolean;
    }> = [];
    sales
      .filter(s => s.order_status === 'لم يتم الصرف' && s.remaining > 0)
      .forEach(s => {
        receivableItems.push({
          source: 'sale', sale_id: s.id, name: s.client, reference: s.order_number,
          invoice_total: s.invoice_value, paid: s.deposit_paid, remaining: s.remaining,
        });
      });
    // Dispatched orders where the shipping company paid less than the remaining
    // balance still leave that gap owed by the customer — surface it, don't drop it.
    sales
      .filter(s => s.order_status === 'تم الصرف' && s.remaining - s.shipping_collected > 0)
      .forEach(s => {
        receivableItems.push({
          source: 'sale_shipping_gap', sale_id: s.id, name: s.client, reference: s.order_number,
          invoice_total: s.invoice_value, paid: s.deposit_paid + s.shipping_collected,
          remaining: s.remaining - s.shipping_collected,
        });
      });
    clientAccts
      .filter(ca => ca.remaining > 0)
      .forEach(ca => {
        receivableItems.push({
          source: 'client_account', name: ca.client_name, reference: ca.model_name,
          invoice_total: ca.total_amount, paid: ca.amount_paid, remaining: ca.remaining,
        });
      });

    // ── Sales recognition, cost of goods sold, receivables and advances (additive metrics) ──
    // "Recognized" sales = orders whose goods physically left the factory (any status except
    // a reservation or a cancellation). total_sales above is kept as-is (it also counts
    // reservations/cancellations) so existing cards don't change; these are separate metrics.
    const shippedSales = sales.filter(s => isStockDeducting(s.order_status));
    const recognizedSales = shippedSales.reduce((n, s) => n + s.invoice_value, 0);

    const movements = await prisma.inventoryMovement.findMany({ where: seasonWhere(seasonId) });
    const saleById = new Map(sales.map(s => [s.id, s]));
    const movementsByOrder = new Map<string, MovementRow[]>();
    movements.forEach(m => {
      const sale = saleById.get(m.sale_id);
      if (!sale) return;
      const list = movementsByOrder.get(sale.order_number) ?? [];
      list.push(m);
      movementsByOrder.set(sale.order_number, list);
    });
    const costKeys = new FuzzyKeyIndex(['model', 'color']);
    const keyOf = (code: string, color: string) => costKeys.resolve([code, color || '']);
    const costedSaleIds = new Set<number>();
    movements.forEach(m => { if (m.movement_type === 'SHIP') costedSaleIds.add(m.sale_id); });
    const costedSales = shippedSales.filter(s => costedSaleIds.has(s.id));
    const returnsCredit = returnsCostCredit({
      returns: returns_.map(r => ({ order_number: r.order_number, model_code: r.model_code, model_color: r.model_color, model_qty: r.model_qty })),
      movementsByOrder, keyOf,
    });
    const cogs = costOfGoodsShipped(movements) - returnsCredit.credit;
    const costedRevenue = costedSales.reduce((n, s) => n + s.invoice_value, 0);

    const shippingReceivable = receivableItems
      .filter(i => i.source === 'sale' || i.source === 'sale_shipping_gap')
      .reduce((n, i) => n + i.remaining, 0);
    const clientAccountsReceivable = receivableItems
      .filter(i => i.source === 'client_account')
      .reduce((n, i) => n + i.remaining, 0);

    // Deposits are real cash, but on an order that has not shipped they are an obligation to
    // deliver (or refund) — not earned revenue. Surfaced so they are not mistaken for profit.
    const advancesOnOpenReservations = sales.filter(s => s.order_status === STATUS_RESERVED).reduce((n, s) => n + s.deposit_paid, 0);
    const advancesOnCanceledOrders = sales.filter(s => s.order_status === STATUS_CANCELED).reduce((n, s) => n + s.deposit_paid, 0);
    const reservedOrdersCount = sales.filter(s => s.order_status === STATUS_RESERVED).length;

    // Orders accepted as «يتم التجهيز» whose goods are not (fully) in stock yet — an operational list for
    // production / purchasing. Their pending quantities are NOT inventory and NOT assets.
    const pendingOrders = [...stockCtx.allocations.values()]
      .filter(a => a.pending > 0)
      .map(a => {
        const sale = saleById.get(a.sale_id);
        return {
          sale_id: a.sale_id, order_number: sale?.order_number ?? '', client: sale?.client ?? '',
          invoice_value: sale?.invoice_value ?? 0, deposit_paid: sale?.deposit_paid ?? 0,
          requested: a.requested, reserved: a.reserved, pending: a.pending,
          slots: a.slots.filter(x => x.pending > 0).map(x => ({ code: x.code, color: x.color, requested: x.requested, reserved: x.reserved, pending: x.pending, has_card: x.has_card })),
        };
      });

    // Debt entered both as a shipped-order receivable and as a client-account invoice (same order number).
    const clientInvoices = await prisma.clientAccountInvoice.findMany({ where: seasonWhere(seasonId) });
    const receivableOverlap = findReceivableOverlap(sales, clientInvoices);

    // Per receivable row: were the shipped goods actually removed from ready-stock value (so the
    // same goods are not an inventory asset AND a receivable), and is the same order also a
    // client-account invoice (so the debt is not counted twice)?
    const { perOrder: shipmentVerdict } = analyseShipments({ sales, readyStock, modelProds, returns_ });
    const invoiceOrderNumbers = new Set(clientInvoices.map(i => i.order_number.trim().toLowerCase()).filter(Boolean));
    receivableItems.forEach(it => {
      if (it.sale_id === undefined) return;
      const v = shipmentVerdict.get(it.sale_id);
      it.stock_status = v?.status ?? 'removed';
      it.inventory_still_in_stock = v ? (v.status === 'possible_mismatch' || v.status === 'partly_removed') : false;
      it.duplicate_in_client_account = invoiceOrderNumbers.has(it.reference.trim().toLowerCase());
    });
    // Total current assets = warehouses + remaining cutting pieces + WIP + receivables.
    // Deliberately excludes cash/net-profit/debts and Fixed Assets — those live in the Financial Center, not here.
    const totalCurrentAssets = fabricValue + stockValue + accessoriesValue + cuttingInventoryValue + wipValue + moneyOwedToUs;

    // Proof that the headline total, each component and its detail rows agree (checked on every request).
    const sumOf = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0);
    const components = { fabric: fabricValue, stock: stockValue, accessories: accessoriesValue, cutting: cuttingInventoryValue, wip: wipValue, receivables: moneyOwedToUs };
    const fromRows = {
      fabric: sumOf(fabricItems, i => i.total), stock: sumOf(stockItems, i => i.total), accessories: sumOf(accessoriesItems, i => i.total),
      cutting: sumOf(cuttingItems, i => i.total), wip: sumOf(wipItems, i => i.total), receivables: sumOf(receivableItems, i => i.remaining),
    };
    const differences = Object.fromEntries(
      (Object.keys(components) as (keyof typeof components)[]).map(k => [k, Math.round((components[k] - fromRows[k]) * 100) / 100]),
    ) as Record<keyof typeof components, number>;
    const componentsSum = Object.values(components).reduce((n, v) => n + v, 0);
    const assetsReconciliation = {
      components_sum: componentsSum,
      differences,
      reconciled: Math.abs(componentsSum - totalCurrentAssets) < 0.01 && Object.values(differences).every(d => Math.abs(d) < 0.01),
    };

    const _today = new Date().toISOString().slice(0, 10);
    setImmediate(() => {
      prisma.financialSnapshot.upsert({
        where:  { season_id_snapshot_date: { season_id: seasonId, snapshot_date: _today } },
        update: { total_current_assets: totalCurrentAssets, cash: cashAvailable, fabric_assets: fabricValue, ready_stock_assets: stockValue, accessories_assets: accessoriesValue, receivables: moneyOwedToUs, debts: remainingDebts },
        create: { season_id: seasonId, snapshot_date: _today, total_current_assets: totalCurrentAssets, cash: cashAvailable, fabric_assets: fabricValue, ready_stock_assets: stockValue, accessories_assets: accessoriesValue, receivables: moneyOwedToUs, debts: remainingDebts },
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
      stock_reserved_value: stockReservedValue,
      stock_available_value: stockAvailableValue,
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
      recognized_sales: recognizedSales,
      costed_sales: costedRevenue,
      cogs,
      gross_margin: costedRevenue - cogs,
      uncosted_shipped_orders: shippedSales.length - costedSales.length,
      unmatched_return_cost_lines: returnsCredit.unmatched,
      shipping_receivable: shippingReceivable,
      client_accounts_receivable: clientAccountsReceivable,
      advances_on_open_reservations: advancesOnOpenReservations,
      advances_on_canceled_orders: advancesOnCanceledOrders,
      reserved_orders_count: reservedOrdersCount,
      pending_orders: pendingOrders,
      pending_units: pendingOrders.reduce((n, o) => n + o.pending, 0),
      assets_reconciliation: assetsReconciliation,
      receivable_overlap_orders: receivableOverlap.orders,
      receivable_overlap_amount: receivableOverlap.amount,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حساب الإحصائيات' });
  }
});

export default router;
