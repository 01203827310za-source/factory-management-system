"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET /api/dashboard - Compute all metrics server-side
router.get('/', async (_req, res) => {
    try {
        // Fetch all needed data in parallel
        const [sales, expenses, debts, clientAccts, returns_, paymentLogs, fabric, readyStock, accessories] = await Promise.all([
            prisma_1.default.sale.findMany(),
            prisma_1.default.expenseRevenue.findMany(),
            prisma_1.default.debt.findMany(),
            prisma_1.default.clientAccount.findMany(),
            prisma_1.default.returnItem.findMany(),
            prisma_1.default.paymentLog.findMany(),
            prisma_1.default.fabricWarehouse.findMany(),
            prisma_1.default.readyStock.findMany(),
            prisma_1.default.accessoriesWarehouse.findMany(),
        ]);
        // Payment logs
        const hatemPaymentIn = paymentLogs.filter(p => p.receiver === 'حاتم').reduce((s, p) => s + p.amount, 0);
        const midoPaymentIn = paymentLogs.filter(p => p.receiver === 'ميدو').reduce((s, p) => s + p.amount, 0);
        const hatemDebtOut = paymentLogs.filter(p => p.type === 'debt_payment' && p.receiver === 'حاتم').reduce((s, p) => s + p.amount, 0);
        const midoDebtOut = paymentLogs.filter(p => p.type === 'debt_payment' && p.receiver === 'ميدو').reduce((s, p) => s + p.amount, 0);
        const totalSales = sales.reduce((s, sale) => s + sale.invoice_value, 0);
        const totalReservations = sales
            .filter(s => s.order_status === 'تم الحجز')
            .reduce((s, sale) => s + sale.invoice_value, 0);
        const hatemDepositIn = sales.filter(s => s.deposit_receiver === 'حاتم').reduce((s, sale) => s + sale.deposit_paid, 0);
        const midoDepositIn = sales.filter(s => s.deposit_receiver === 'ميدو').reduce((s, sale) => s + sale.deposit_paid, 0);
        const hatemRemainingIn = sales.filter(s => s.order_status === 'تم الصرف').reduce((s, sale) => s + sale.remaining, 0);
        const hatemReturnOut = returns_.filter(r => r.paid_by === 'حاتم').reduce((s, r) => s + r.refund_amount, 0);
        const midoReturnOut = returns_.filter(r => r.paid_by === 'ميدو').reduce((s, r) => s + r.refund_amount, 0);
        const totalRefunds = hatemReturnOut + midoReturnOut;
        const hatemIn = expenses.reduce((s, e) => s + e.hatem_in, 0) + hatemDepositIn + hatemRemainingIn + hatemPaymentIn;
        const hatemOut = expenses.reduce((s, e) => s + e.hatem_out, 0) + hatemDebtOut + hatemReturnOut;
        const midoIn = expenses.reduce((s, e) => s + e.mido_in, 0) + midoDepositIn + midoPaymentIn;
        const midoOut = expenses.reduce((s, e) => s + e.mido_out, 0) + midoDebtOut + midoReturnOut;
        const totalIn = hatemIn + midoIn;
        const totalOut = hatemOut + midoOut;
        const netProfit = totalIn - totalOut;
        const remainingDebts = debts.reduce((s, d) => s + d.remaining, 0);
        const moneyOwedToUs = sales.filter(s => s.order_status === 'لم يتم الصرف').reduce((s, sale) => s + sale.remaining, 0) +
            clientAccts.reduce((s, ca) => s + ca.remaining, 0);
        const cashAvailable = totalIn - totalOut - remainingDebts;
        const salesByMarketer = {};
        sales.forEach(s => { salesByMarketer[s.marketer] = (salesByMarketer[s.marketer] || 0) + s.invoice_value; });
        const orderStatusCounts = {};
        sales.forEach(s => { orderStatusCounts[s.order_status] = (orderStatusCounts[s.order_status] || 0) + 1; });
        // Compute asset values
        // Fabric: need cutting consumption
        const cuttingOrders = await prisma_1.default.cuttingOrder.findMany();
        const fabricConsumed = {};
        cuttingOrders.forEach(c => {
            const key = `${c.material_type}|${c.color}`;
            fabricConsumed[key] = (fabricConsumed[key] || 0) + c.kg_consumed;
        });
        let fabricValue = 0;
        fabric.forEach(f => {
            const consumed = fabricConsumed[`${f.material_type}|${f.color}`] || 0;
            const available = Math.max(0, f.qty_in - consumed);
            fabricValue += available * f.cost_per_kg;
        });
        // Stock value
        const modelProds = await prisma_1.default.modelProduction.findMany();
        const newProd = {};
        modelProds.forEach(mp => {
            const key = `${mp.model_code}`;
            newProd[key] = (newProd[key] || 0) + mp.qty_received;
        });
        // Only deduct stock for actual dispatched/pending sales — NOT reservations or cancelled
        const totalSalesQty = {};
        sales
            .filter(s => s.order_status !== 'تم الحجز' && s.order_status !== 'تم الإلغاء')
            .forEach(s => {
            [
                { code: s.model1_code, qty: s.model1_qty },
                { code: s.model2_code, qty: s.model2_qty },
                { code: s.model3_code, qty: s.model3_qty },
                { code: s.model4_code, qty: s.model4_qty },
                { code: s.model5_code, qty: s.model5_qty },
            ].forEach(({ code, qty }) => {
                if (code && qty > 0)
                    totalSalesQty[code] = (totalSalesQty[code] || 0) + qty;
            });
        });
        const returnQty = {};
        returns_.forEach(r => {
            if (r.model_code)
                returnQty[r.model_code] = (returnQty[r.model_code] || 0) + r.model_qty;
        });
        let stockValue = 0;
        readyStock.forEach(rs => {
            const prod = newProd[rs.model_code] || 0;
            const sold = totalSalesQty[rs.model_code] || 0;
            const returned = returnQty[rs.model_code] || 0;
            const actual = Math.max(0, rs.opening_balance + prod - sold + returned);
            stockValue += actual * rs.cost_per_piece;
        });
        const accessoriesValue = accessories.reduce((s, a) => s + Math.max(0, a.qty_in - a.qty_consumed) * a.cost, 0);
        const netPartners = (hatemIn - hatemOut) + (midoIn - midoOut);
        const totalCurrentAssets = fabricValue + stockValue + accessoriesValue + moneyOwedToUs + netPartners - remainingDebts;
        return res.json({
            total_sales: totalSales,
            total_expenses: totalOut,
            net_profit: netProfit,
            remaining_debts: remainingDebts,
            hatem_total_in: hatemIn,
            hatem_total_out: hatemOut,
            hatem_net: hatemIn - hatemOut,
            mido_total_in: midoIn,
            mido_total_out: midoOut,
            mido_net: midoIn - midoOut,
            total_in: totalIn,
            total_out: totalOut,
            cash_available: cashAvailable,
            money_owed_to_us: moneyOwedToUs,
            sales_by_marketer: salesByMarketer,
            order_status_counts: orderStatusCounts,
            total_returns: returns_.length,
            total_refunds: totalRefunds,
            total_current_assets: totalCurrentAssets,
            fabric_value: fabricValue,
            stock_value: stockValue,
            accessories_value: accessoriesValue,
            total_reservations: totalReservations,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في حساب الإحصائيات' });
    }
});
exports.default = router;
//# sourceMappingURL=dashboard.js.map