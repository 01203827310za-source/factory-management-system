import type {
  AccessoriesWarehouse,
  ClientAccount,
  Debt,
  ExpenseRevenue,
  PaymentLog,
  ReturnItem,
  Sale,
} from '@prisma/client';

const CLIENT_PAYMENT    = 'client_payment';
const DEBT_PAYMENT      = 'debt_payment';
const STATUS_DISPATCHED = 'تم الصرف';
const STATUS_NOT_DISPATCHED = 'لم يتم الصرف';

type DateRange = { fromDate?: string; toDate?: string };

type FinancialInput = {
  sales: Sale[];
  expenses: ExpenseRevenue[];
  returns_: ReturnItem[];
  paymentLogs: PaymentLog[];
};

type BalanceInput = { debts: Debt[]; sales: Sale[]; clientAccts: ClientAccount[] };

export type FinancialSummary = {
  total_in: number;
  total_out: number;
  total_net: number;
};

function saleDate(sale: Sale) {
  return sale.created_at.toISOString().slice(0, 10);
}

function isInRange(date: string, range?: DateRange) {
  if (!range) return true;
  if (range.fromDate && date < range.fromDate) return false;
  if (range.toDate   && date > range.toDate)   return false;
  return true;
}

export function computeFinancialSummary(input: FinancialInput, range?: DateRange): FinancialSummary {
  const sales       = input.sales.filter(s => isInRange(saleDate(s), range));
  const expenses    = input.expenses.filter(e => isInRange(e.date, range));
  const returns_    = input.returns_.filter(r => isInRange(r.date, range));
  const paymentLogs = input.paymentLogs.filter(p => isInRange(p.date, range));

  // Cash inflows
  const depositIn      = sales.reduce((s, x) => s + x.deposit_paid, 0);
  const remainingIn    = sales
    .filter(s => s.order_status === STATUS_DISPATCHED)
    .reduce((s, x) => s + x.remaining, 0);
  const clientPayIn    = paymentLogs
    .filter(p => p.type === CLIENT_PAYMENT)
    .reduce((s, p) => s + p.amount, 0);

  // Cash outflows
  const debtOut        = paymentLogs
    .filter(p => p.type === DEBT_PAYMENT)
    .reduce((s, p) => s + p.amount, 0);
  const refundOut      = returns_.reduce((s, r) => s + r.refund_amount, 0);

  const totalIn  = expenses.reduce((s, e) => s + e.amount_in, 0)  + depositIn + remainingIn + clientPayIn;
  const totalOut = expenses.reduce((s, e) => s + e.amount_out, 0) + debtOut   + refundOut;

  return { total_in: totalIn, total_out: totalOut, total_net: totalIn - totalOut };
}

export function computeCurrentAssets(params: {
  fabricValue: number;
  stockValue: number;
  accessoriesValue: number;
  financialSummary: FinancialSummary;
}) {
  return params.fabricValue + params.stockValue + params.accessoriesValue + params.financialSummary.total_net;
}

export function computeRemainingDebts(input: Pick<BalanceInput, 'debts'>, range?: DateRange) {
  return input.debts
    .filter(d => isInRange(d.date, range))
    .reduce((s, d) => s + d.remaining, 0);
}

export function computeMoneyOwedToUs(input: Pick<BalanceInput, 'sales' | 'clientAccts'>, range?: DateRange) {
  const salesRemaining = input.sales
    .filter(s => isInRange(saleDate(s), range) && s.order_status === STATUS_NOT_DISPATCHED)
    .reduce((s, sale) => s + sale.remaining, 0);
  const clientBalance = input.clientAccts
    .filter(ca => isInRange(ca.date, range))
    .reduce((s, ca) => s + ca.remaining, 0);
  return salesRemaining + clientBalance;
}

export function computeAccessoriesValue(accessories: AccessoriesWarehouse[], range?: DateRange) {
  return accessories
    .filter(a => isInRange(a.date, range))
    .reduce((s, a) => s + Math.max(0, a.qty_in - a.qty_consumed) * a.cost, 0);
}
