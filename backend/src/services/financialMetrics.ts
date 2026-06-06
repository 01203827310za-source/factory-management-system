import type {
  AccessoriesWarehouse,
  ClientAccount,
  Debt,
  ExpenseRevenue,
  PaymentLog,
  ReturnItem,
  Sale,
} from '@prisma/client';

const HATEM = '\u062d\u0627\u062a\u0645';
const MIDO = '\u0645\u064a\u062f\u0648';
const CLIENT_PAYMENT = 'client_payment';
const DEBT_PAYMENT = 'debt_payment';
const STATUS_DISPATCHED = '\u062a\u0645 \u0627\u0644\u0635\u0631\u0641';
const STATUS_NOT_DISPATCHED = '\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0635\u0631\u0641';

type DateRange = {
  fromDate?: string;
  toDate?: string;
};

type PartnerSummaryInput = {
  sales: Sale[];
  expenses: ExpenseRevenue[];
  returns_: ReturnItem[];
  paymentLogs: PaymentLog[];
};

type BalanceInput = {
  debts: Debt[];
  sales: Sale[];
  clientAccts: ClientAccount[];
};

type CurrentAssetInput = {
  fabricValue: number;
  stockValue: number;
  accessoriesValue: number;
  partnerSummary: PartnerSummary;
};

export type PartnerSummary = {
  hatem_total_in: number;
  hatem_total_out: number;
  hatem_net: number;
  mido_total_in: number;
  mido_total_out: number;
  mido_net: number;
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
  if (range.toDate && date > range.toDate) return false;
  return true;
}

export function computePartnerSummary(input: PartnerSummaryInput, range?: DateRange): PartnerSummary {
  const sales = input.sales.filter(s => isInRange(saleDate(s), range));
  const expenses = input.expenses.filter(e => isInRange(e.date, range));
  const returns_ = input.returns_.filter(r => isInRange(r.date, range));
  const paymentLogs = input.paymentLogs.filter(p => isInRange(p.date, range));

  const hatemPaymentIn = paymentLogs
    .filter(p => p.receiver === HATEM && p.type === CLIENT_PAYMENT)
    .reduce((s, p) => s + p.amount, 0);
  const midoPaymentIn = paymentLogs
    .filter(p => p.receiver === MIDO && p.type === CLIENT_PAYMENT)
    .reduce((s, p) => s + p.amount, 0);
  const hatemDebtOut = paymentLogs
    .filter(p => p.receiver === HATEM && p.type === DEBT_PAYMENT)
    .reduce((s, p) => s + p.amount, 0);
  const midoDebtOut = paymentLogs
    .filter(p => p.receiver === MIDO && p.type === DEBT_PAYMENT)
    .reduce((s, p) => s + p.amount, 0);

  const hatemDepositIn = sales
    .filter(s => s.deposit_receiver === HATEM)
    .reduce((s, sale) => s + sale.deposit_paid, 0);
  const midoDepositIn = sales
    .filter(s => s.deposit_receiver === MIDO)
    .reduce((s, sale) => s + sale.deposit_paid, 0);
  const hatemRemainingIn = sales
    .filter(s => s.order_status === STATUS_DISPATCHED)
    .reduce((s, sale) => s + sale.remaining, 0);

  const hatemReturnOut = returns_
    .filter(r => r.paid_by === HATEM)
    .reduce((s, r) => s + r.refund_amount, 0);
  const midoReturnOut = returns_
    .filter(r => r.paid_by === MIDO)
    .reduce((s, r) => s + r.refund_amount, 0);

  const hatemIn = expenses.reduce((s, e) => s + e.hatem_in, 0) + hatemDepositIn + hatemRemainingIn + hatemPaymentIn;
  const hatemOut = expenses.reduce((s, e) => s + e.hatem_out, 0) + hatemDebtOut + hatemReturnOut;
  const midoIn = expenses.reduce((s, e) => s + e.mido_in, 0) + midoDepositIn + midoPaymentIn;
  const midoOut = expenses.reduce((s, e) => s + e.mido_out, 0) + midoDebtOut + midoReturnOut;
  const totalIn = hatemIn + midoIn;
  const totalOut = hatemOut + midoOut;

  return {
    hatem_total_in: hatemIn,
    hatem_total_out: hatemOut,
    hatem_net: hatemIn - hatemOut,
    mido_total_in: midoIn,
    mido_total_out: midoOut,
    mido_net: midoIn - midoOut,
    total_in: totalIn,
    total_out: totalOut,
    total_net: totalIn - totalOut,
  };
}

export function computeCurrentAssets(input: CurrentAssetInput) {
  return input.fabricValue + input.stockValue + input.accessoriesValue + input.partnerSummary.total_net;
}

export function computeCashAvailable(partnerSummary: PartnerSummary) {
  return partnerSummary.total_net;
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
