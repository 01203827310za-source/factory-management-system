// ============================================
// API Service - HTTP Client for Backend
// All calls to Express API replacing localStorage
// ============================================

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export class ForbiddenError extends Error {
  constructor(message = 'غير مسموح بالوصول') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// ===== HTTP Client =====
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const seasonId = localStorage.getItem('current_season_id');
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(seasonId ? { 'X-Season-Id': seasonId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.location.href = '/';
    throw new Error('غير مصرح');
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.status === 403) {
    const message = data?.message || 'غير مسموح بالوصول';
    window.dispatchEvent(new CustomEvent('rbac-forbidden', { detail: { path, message, permission: data?.permission } }));
    throw new ForbiddenError(message);
  }

  if (!res.ok) throw new Error(data?.message || 'خطأ في الخادم');
  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body: unknown) => request<T>('POST', path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

// ===== AUTH =====
export const authApi = {
  login: (username: string, password: string) =>
    post<{ token: string; user: AuthUser }>('/auth/login', { username, password }),
  me: () => get<AuthUser>('/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    post<{ message: string }>('/auth/change-password', { current_password, new_password }),
};

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  permissions: string[];
}

export type UserRole = 'admin' | 'manager' | 'viewer' | 'warehouse' | 'sales' | 'accountant' | string;

// ===== SEASONS =====
export type SeasonRecord = {
  id: number;
  name: string;
  year: number;
  type: string;
  status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const seasonsApi = {
  getAll: () => get<SeasonRecord[]>('/seasons'),
  getActive: () => get<SeasonRecord>('/seasons/active'),
  create: (data: { name: string; year: number; type?: string; activate?: boolean }) =>
    post<SeasonRecord>('/seasons', data),
  update: (id: number, data: Partial<Pick<SeasonRecord, 'name' | 'year' | 'type' | 'status'>>) =>
    put<SeasonRecord>(`/seasons/${id}`, data),
  activate: (id: number) => post<SeasonRecord>(`/seasons/${id}/activate`, {}),
};

// ===== USERS =====
export const usersApi = {
  getAll: () => get<User[]>('/users'),
  create: (data: CreateUserInput) => post<User>('/users', data),
  update: (id: number, data: Partial<CreateUserInput & { is_active: boolean }>) =>
    put<User>(`/users/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/users/${id}`),
  getRbac: () => get<RbacMetadata>('/users/rbac'),
};

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  role_id?: number | null;
  is_active: boolean;
  last_login?: string;
  created_at: string;
  permissions: string[];
}

export interface CreateUserInput {
  username: string;
  password: string;
  full_name: string;
  role: UserRole;
  permissions?: string[];
}

export interface RbacRole {
  id: number;
  name: string;
  display_name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
}

export interface RbacPermission {
  id: number;
  key: string;
  module: string;
  action: 'view' | 'create' | 'edit' | 'delete' | 'activate';
  label: string;
}

export interface RbacModule {
  key: string;
  label: string;
  actions?: readonly RbacPermission['action'][];
}

export interface RbacMetadata {
  roles: RbacRole[];
  permissions: RbacPermission[];
  modules: RbacModule[];
  actions: readonly RbacPermission['action'][];
}

// ===== SALES =====
// add/update also return `collection_difference` whenever the saved order_status is
// "تم الصرف" — the gap between the invoice's remaining balance and the actual amount
// received from the shipping company (see the shipping_collected field below).
export const salesApi = {
  getAll: () => get<SaleRecord[]>('/sales'),
  getLedger: (id: number) => get<SaleLedger>(`/sales/${id}/ledger`),
  add: (data: Omit<SaleRecord, 'id' | 'created_at'>) => post<SaleRecord & { collection_difference: number }>('/sales', data),
  update: (id: number, data: Partial<SaleRecord>) => put<SaleRecord & { collection_difference: number }>(`/sales/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/sales/${id}`),
  // Kept for any non-UI caller; the Edit Order modal now drives "تم الحجز" (shown as «يتم التجهيز») → "تم الصرف"
  // through update() (status + received amount saved together via حفظ).
  convertReservation: (id: number, received_amount: number) =>
    post<SaleRecord & { collection_difference: number }>(`/sales/${id}/convert-reservation`, { received_amount }),
  cancelReservation: (id: number) => post<SaleRecord>(`/sales/${id}/cancel-reservation`, {}),
};

export type SaleRecord = {
  id: number;
  order_number: string;
  row_number: number;
  marketer: string;
  client: string;
  model1_code: string; model1_qty: number; model1_color: string;
  model2_code: string; model2_qty: number; model2_color: string;
  model3_code: string; model3_qty: number; model3_color: string;
  model4_code: string; model4_qty: number; model4_color: string;
  model5_code: string; model5_qty: number; model5_color: string;
  invoice_value: number;
  deposit_paid: number;
  deposit_receiver: string;
  remaining: number;
  shipping_number: string;
  order_status: 'تم الصرف' | 'لم يتم الصرف' | 'حساب عميل' | 'تم الحجز' | 'تم الإلغاء';
  delivery_method: string;
  mobile: string;
  warehouse: string;
  shipping_collected: number;
  created_at: string;
};

// ===== EXPENSES =====
export const expensesApi = {
  getAll: () => get<ExpenseRecord[]>('/expenses'),
  add: (data: Omit<ExpenseRecord, 'id' | 'created_at'>) => post<ExpenseRecord>('/expenses', data),
  update: (id: number, data: Partial<ExpenseRecord>) => put<ExpenseRecord>(`/expenses/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/expenses/${id}`),
};

export type ExpenseRecord = {
  id: number;
  date: string;
  operation_type: string;
  statement: string;
  amount_in: number;
  amount_out: number;
  created_at: string;
};

// ===== READY STOCK =====
export const readyStockApi = {
  getAll: () => get<ReadyStockRecord[]>('/ready-stock'),
  add: (data: Omit<ReadyStockRecord, 'id'>) => post<ReadyStockRecord>('/ready-stock', data),
  update: (id: number, data: Partial<ReadyStockRecord>) => put<ReadyStockRecord>(`/ready-stock/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/ready-stock/${id}`),
};

export type ReadyStockRecord = {
  id: number;
  model_code: string;
  product_name: string;
  color: string;
  opening_balance: number;
  cost_per_piece: number;
  location: string;
  reserved_quantity: number;
};

// ===== FABRIC =====
export const fabricApi = {
  getAll: () => get<FabricRecord[]>('/fabric'),
  add: (data: Omit<FabricRecord, 'id' | 'created_at'>) => post<FabricRecord>('/fabric', data),
  update: (id: number, data: Partial<FabricRecord>) => put<FabricRecord>(`/fabric/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/fabric/${id}`),
};

export type FabricRecord = {
  id: number;
  date: string;
  material_type: string;
  color: string;
  qty_in: number;
  cost_per_kg: number;
  avg_cost_per_kg: number;
  last_purchase_price: number;
  created_at: string;
};

// ===== FABRIC PURCHASES =====
export const fabricPurchasesApi = {
  getAll: () => get<FabricPurchaseRecord[]>('/fabric-purchases'),
  add: (data: Omit<FabricPurchaseRecord, 'id' | 'total_cost' | 'created_at'>) =>
    post<FabricPurchaseRecord>('/fabric-purchases', data),
  update: (id: number, data: Omit<FabricPurchaseRecord, 'id' | 'total_cost' | 'created_at'>) =>
    put<FabricPurchaseRecord>(`/fabric-purchases/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/fabric-purchases/${id}`),
};

export type FabricPurchaseRecord = {
  id: number;
  date: string;
  fabric_type: string;
  color: string;
  quantity_kg: number;
  price_per_kg: number;
  total_cost: number;
  supplier: string;
  invoice_no: string;
  notes: string;
  created_at: string;
};

// ===== ACCESSORIES =====
export const accessoriesApi = {
  getAll: () => get<AccessoriesRecord[]>('/accessories'),
  add: (data: Omit<AccessoriesRecord, 'id' | 'created_at'>) => post<AccessoriesRecord>('/accessories', data),
  update: (id: number, data: Partial<AccessoriesRecord>) => put<AccessoriesRecord>(`/accessories/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/accessories/${id}`),
};

export type AccessoriesRecord = {
  id: number;
  date: string;
  item_name: string;
  qty_in: number;
  qty_consumed: number;
  cost: number;
  created_at: string;
};

// ===== CUTTING =====
export const cuttingApi = {
  getAll: () => get<CuttingRecord[]>('/cutting'),
  getColors: (cutNumber: number) => get<string[]>(`/cutting/${cutNumber}/colors`),
  add: (data: Omit<CuttingRecord, 'id' | 'created_at'>) => post<CuttingRecord>('/cutting', data),
  update: (id: number, data: Partial<CuttingRecord>) => put<CuttingRecord>(`/cutting/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/cutting/${id}`),
};

export type CuttingRecord = {
  id: number;
  date: string;
  cut_number: number;
  cut_description: string;
  material_type: string;
  layers_count: number;
  spread_length_m: number;
  total_pieces: number;
  color: string;
  kg_consumed: number;
  cost_per_meter: number;
  notes: string;
  created_at: string;
};

// ===== MODEL PRODUCTION =====
export const modelProdApi = {
  getAll: () => get<ModelProdRecord[]>('/model-prod'),
  add: (data: Omit<ModelProdRecord, 'id' | 'created_at'>) => post<ModelProdRecord>('/model-prod', data),
  update: (id: number, data: Partial<ModelProdRecord>) => put<ModelProdRecord>(`/model-prod/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/model-prod/${id}`),
};

export type ModelPartRecord = {
  id: number;
  model_id: number;
  part_type: string;
  cut_number: number;
  color: string;
  created_at: string;
};

export type ModelProdRecord = {
  id: number;
  date: string;
  cut_number: number; // mirrors first part — kept for backward compatibility
  model_code: string;
  qty_from_cutting: number;
  model_description: string;
  color: string;
  sizes: string;
  status: string;
  wastage: number;
  qty_received: number;
  cost_per_piece: number;
  warehouse_entry_date: string;
  created_at: string;
  parts?: ModelPartRecord[];
};

// ===== DEBTS =====
export type PaymentHistoryRecord = {
  id: number;
  date: string;
  amount: number;
  payment_method: string;
  description: string;
  receiver: string;
  created_by: string;
  created_at: string;
};

export type DebtRecord = {
  id: number;
  date: string;
  name: string;
  total_amount: number;
  amount_paid: number;
  remaining: number;
  created_at: string;
  payments?: PaymentHistoryRecord[];
};

export const debtsApi = {
  getAll: () => get<DebtRecord[]>('/debts'),
  add: (data: Omit<DebtRecord, 'id' | 'created_at' | 'payments'>) => post<DebtRecord>('/debts', data),
  update: (id: number, data: Partial<DebtRecord>) => put<DebtRecord>(`/debts/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/debts/${id}`),
};

export const debtPaymentsApi = {
  add: (debtId: number, data: Omit<PaymentHistoryRecord, 'id' | 'created_at' | 'created_by'>) =>
    post<PaymentHistoryRecord>(`/debts/${debtId}/payments`, data),
  update: (debtId: number, pid: number, data: Partial<Omit<PaymentHistoryRecord, 'id' | 'created_at' | 'created_by'>>) =>
    put<PaymentHistoryRecord>(`/debts/${debtId}/payments/${pid}`, data),
  remove: (debtId: number, pid: number) => del<{ message: string }>(`/debts/${debtId}/payments/${pid}`),
};

// ===== CLIENT ACCOUNTS =====
export type ClientAccountInvoiceRecord = {
  id: number;
  account_id: number;
  date: string;
  order_number: string;
  amount: number;
  notes: string;
  created_by: string;
  created_at: string;
};

export type ClientAccountRecord = {
  id: number;
  date: string;
  client_name: string;
  model_name: string;
  quantity: number;
  total_amount: number;
  amount_paid: number;
  remaining: number;
  notes: string;
  created_at: string;
  payments?: PaymentHistoryRecord[];
  invoices?: ClientAccountInvoiceRecord[];
};

export const clientAccountsApi = {
  getAll: () => get<ClientAccountRecord[]>('/client-accounts'),
  add: (data: Omit<ClientAccountRecord, 'id' | 'created_at' | 'payments' | 'invoices'>) => post<ClientAccountRecord>('/client-accounts', data),
  update: (id: number, data: Partial<ClientAccountRecord>) => put<ClientAccountRecord>(`/client-accounts/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/client-accounts/${id}`),
};

export const clientAccountPaymentsApi = {
  add: (accountId: number, data: Omit<PaymentHistoryRecord, 'id' | 'created_at' | 'created_by'>) =>
    post<PaymentHistoryRecord>(`/client-accounts/${accountId}/payments`, data),
  update: (accountId: number, pid: number, data: Partial<Omit<PaymentHistoryRecord, 'id' | 'created_at' | 'created_by'>>) =>
    put<PaymentHistoryRecord>(`/client-accounts/${accountId}/payments/${pid}`, data),
  remove: (accountId: number, pid: number) => del<{ message: string }>(`/client-accounts/${accountId}/payments/${pid}`),
};

export const clientAccountInvoicesApi = {
  add: (accountId: number, data: Omit<ClientAccountInvoiceRecord, 'id' | 'account_id' | 'created_at' | 'created_by'>) =>
    post<ClientAccountInvoiceRecord>(`/client-accounts/${accountId}/invoices`, data),
};

// ===== RETURNS =====
export const returnsApi = {
  getAll: () => get<ReturnRecord[]>('/returns'),
  add: (data: Omit<ReturnRecord, 'id' | 'created_at'>) => post<ReturnRecord>('/returns', data),
  update: (id: number, data: Partial<ReturnRecord>) => put<ReturnRecord>(`/returns/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/returns/${id}`),
};

export type ReturnRecord = {
  id: number;
  date: string;
  order_number: string;
  client_name: string;
  returned_by: string;
  paid_by: string;
  model_code: string;
  model_qty: number;
  model_color: string;
  refund_amount: number;
  notes: string;
  created_at: string;
};

// ===== PAYMENT LOGS =====
export const paymentLogApi = {
  getAll: () => get<PaymentLogRecord[]>('/payment-log'),
  add: (data: Omit<PaymentLogRecord, 'id' | 'created_at'>) => post<PaymentLogRecord>('/payment-log', data),
  remove: (id: number) => del<{ message: string }>(`/payment-log/${id}`),
};

export type PaymentLogRecord = {
  id: number;
  date: string;
  type: string;
  amount: number;
  receiver: string;
  description: string;
  created_at: string;
};

// ===== MARKETERS =====
export const marketersApi = {
  getAll: () => get<string[]>('/marketers'),
  add: (name: string) => post<string[]>('/marketers', { name }),
  remove: (name: string) => del<string[]>(`/marketers/${encodeURIComponent(name)}`),
};

// ===== DASHBOARD =====
export const dashboardApi = {
  getMetrics: () => get<DashboardMetrics>('/dashboard'),
  getNetProfitBreakdown: () => get<NetProfitBreakdown>('/dashboard/breakdown/net-profit'),
  getExpensesBreakdown: () => get<ExpensesBreakdown>('/dashboard/breakdown/expenses'),
  getExpenseRecords: (category: string) =>
    get<ExpenseRecordsResult>(`/dashboard/breakdown/expenses/records?category=${encodeURIComponent(category)}`),
  getReceivablesAudit: () => get<ReceivablesAudit>('/dashboard/breakdown/receivables-audit'),
  getSalesBreakdown: () => get<SalesBreakdown>('/dashboard/breakdown/sales'),
  getSalesRecords: (group: string, value: string) =>
    get<SalesRecordsResult>(`/dashboard/breakdown/sales/records?group=${encodeURIComponent(group)}&value=${encodeURIComponent(value)}`),
};

export interface BreakdownLine { key: string; label: string; amount: number }
export interface NetProfitBreakdown {
  method: string; cogs_included: boolean; cogs_note: string;
  total_revenue: number; total_expenses: number; net_profit: number;
  inflows: BreakdownLine[]; outflows: BreakdownLine[];
}
export interface ExpenseCategoryRow { key: string; label: string; kind: 'expense' | 'debt_payment' | 'refund'; total: number; count: number }
export interface ExpensesBreakdown {
  total_expenses: number; categories_total: number; reconciled: boolean; difference: number;
  categories: ExpenseCategoryRow[];
  record_access: { expense: boolean; debt_payment: boolean; refund: boolean };
}
export interface ExpenseRecordRow { id: number; date: string; description: string; category: string; amount: number; reference: string }
export interface ExpenseRecordsResult { category: string; count: number; total: number; records: ExpenseRecordRow[] }
export interface SalesGroupRow { value: string; count: number; invoice_value: number; deposit_paid: number; collected: number }
export interface SalesBreakdown {
  total_sales: number; order_count: number; total_deposits: number; total_shipping_collected: number;
  total_cash_collected: number; total_outstanding: number; canceled_count: number; canceled_value: number;
  by_status: SalesGroupRow[]; by_marketer: SalesGroupRow[]; by_delivery_method: SalesGroupRow[];
  can_view_records: boolean;
}
export interface SalesRecordRow {
  id: number; order_number: string; date: string; client: string; marketer: string; order_status: string;
  delivery_method: string; invoice_value: number; deposit_paid: number; shipping_collected: number; remaining: number;
}
export interface SalesRecordsResult { group: string; value: string; count: number; total_invoice_value: number; records: SalesRecordRow[] }

export interface DashboardMetrics {
  total_sales: number;
  total_expenses: number;
  net_profit: number;
  remaining_debts: number;
  total_in: number;
  total_out: number;
  cash_available: number;
  money_owed_to_us: number;
  sales_by_marketer: Record<string, number>;
  order_status_counts: Record<string, number>;
  total_returns: number;
  total_refunds: number;
  total_current_assets: number;
  fabric_value: number;
  stock_value: number;
  stock_reserved_value?: number;
  stock_available_value?: number;
  accessories_value: number;
  cutting_value: number;
  wip_value: number;
  total_reservations: number;
  recognized_sales?: number;
  costed_sales?: number;
  cogs?: number;
  gross_margin?: number;
  uncosted_shipped_orders?: number;
  unmatched_return_cost_lines?: number;
  shipping_receivable?: number;
  client_accounts_receivable?: number;
  advances_on_open_reservations?: number;
  advances_on_canceled_orders?: number;
  reserved_orders_count?: number;
  assets_reconciliation?: {
    components_sum: number;
    differences: Record<'fabric' | 'stock' | 'accessories' | 'cutting' | 'wip' | 'receivables', number>;
    reconciled: boolean;
  };
  receivable_overlap_orders?: number;
  receivable_overlap_amount?: number;
  fabric_items: { material_type: string; color: string; available_qty: number; unit_cost: number; total: number }[];
  stock_items: { model_code: string; product_name: string; color: string; actual_qty: number; reserved_qty: number; available_qty: number; unit_cost: number; total: number; reserved_value?: number; available_value?: number }[];
  accessories_items: { item_name: string; qty: number; unit_cost: number; total: number }[];
  cutting_items: { cut_number: number; cut_description: string; material_type: string; color: string; total_pieces: number; used_pieces: number; remaining_pieces: number; cost_per_meter: number; total: number }[];
  wip_items: { model_code: string; model_description: string; color: string; qty_received: number; cost_per_piece: number; total: number; status: string }[];
  receivable_items: { source: 'sale' | 'sale_shipping_gap' | 'client_account'; name: string; reference: string; invoice_total: number; paid: number; remaining: number; sale_id?: number; stock_status?: 'removed' | 'partly_removed' | 'no_stock_card' | 'possible_mismatch'; inventory_still_in_stock?: boolean; duplicate_in_client_account?: boolean }[];
}
// ===== FIXED ASSETS =====
export const fixedAssetsApi = {
  getAll: () => get<FixedAssetRecord[]>('/fixed-assets'),
  add: (data: Omit<FixedAssetRecord, 'id' | 'created_at'>) => post<FixedAssetRecord>('/fixed-assets', data),
  update: (id: number, data: Partial<FixedAssetRecord>) => put<FixedAssetRecord>(`/fixed-assets/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/fixed-assets/${id}`),
};

export type FixedAssetRecord = {
  id: number;
  name: string;
  category: string;
  purchase_date: string;
  purchase_price: number;
  useful_life_years: number;
  notes: string;
  created_at: string;
};

// ===== REPORTS =====
export const reportsApi = {
  getReport: (from_date: string, to_date: string) =>
    get<ReportData>(`/reports?from_date=${from_date}&to_date=${to_date}`),
};

// ===== EMPLOYEE MOVEMENTS =====
export interface CashFlowTransaction {
  date: string;
  type: string;
  description: string;
  client: string;
  amount: number;
  direction: 'in' | 'out';
}

export interface CashFlowData {
  from_date: string;
  to_date: string;
  summary: {
    total_received: number;
    total_paid: number;
    net_balance: number;
    transaction_count: number;
  };
  expenses_breakdown: { exp_in: number; exp_out: number };
  transactions: CashFlowTransaction[];
}

export const cashFlowApi = {
  get: (from_date: string, to_date: string) =>
    get<CashFlowData>(`/reports/employee-movements?from_date=${from_date}&to_date=${to_date}`),
};

export interface CapitalSnapshot {
  stock_value: number;
  fabric_value: number;
  accessories_value: number;
  client_accounts: number;
  cash: number;
  total_assets: number;
  total_debts: number;
  net_assets: number;
}

export interface ReportData {
  summary: {
    total_sales: number;
    total_expenses: number;
    net_profit: number;
    total_reservations: number;
    total_debts: number;
  };
  sales_report: {
    total_orders: number;
    total_invoice_value: number;
    total_deposits: number;
    total_remaining: number;
    top_marketer: string;
    top_model: string;
    by_marketer: { marketer: string; count: number; value: number; remaining: number }[];
  };
  inventory_report: {
    total_qty: number;
    reserved_qty: number;
    available_qty: number;
    low_stock: { model_code: string; product_name: string; actual: number; reserved: number; available: number }[];
    fabric_value: number;
    fabric_balance_kg: number;
    accessories_value: number;
    accessories_balance: number;
  };
  financial_report: {
    total_revenues: number;
    total_expenses: number;
    net_profit: number;
  };
  customers_report: {
    top_clients: { client: string; value: number; remaining: number }[];
    total_outstanding: number;
    debts: { name: string; remaining: number }[];
  };
  reservations_report: {
    count: number;
    value: number;
    items: { model_code: string; product_name: string; actual: number; reserved: number; available: number }[];
    shortages: { model_code: string; product_name: string; actual: number; reserved: number; available: number }[];
  };
  capital_growth: {
    start: CapitalSnapshot;
    end: CapitalSnapshot;
    growth_amount: number;
    growth_percent: number | null;
  };
}

// ===== FINANCIAL CENTER =====
export const financialCenterApi = {
  getData: () => get<FinancialCenterData>('/financial-center'),
};

// ===== ATTENDANCE & PAYROLL =====

export type EmployeeRecord = {
  id: number; name: string; phone: string; job_title: string;
  monthly_salary: number; daily_hours: number; status: 'active' | 'inactive';
  created_at: string; updated_at: string;
};

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'vacation' | 'business_trip';

export type AttendanceRecord = {
  id: number; employee_id: number; employee: EmployeeRecord;
  date: string; check_in: string; check_out: string;
  worked_hours: number; overtime_hours: number;
  status: AttendanceStatus; notes: string; created_at: string; updated_at: string;
};

export type AdjustmentType = 'advance' | 'deduction' | 'bonus';

export type SalaryAdjustmentRecord = {
  id: number; employee_id: number; employee: EmployeeRecord;
  date: string; type: AdjustmentType; amount: number; reason: string;
  created_at: string; updated_at: string;
};

export type PayrollRow = {
  id: number; employee_id: number; employee: EmployeeRecord;
  month: number; year: number;
  attendance_days: number; absent_days: number; half_days: number;
  worked_hours: number; overtime_hours: number; overtime_amount: number;
  advances: number; deductions: number; bonuses: number;
  base_salary: number; net_salary: number; generated_at: string;
};

type EmployeeSaveInput = {
  name: string; phone: string; job_title: string;
  monthly_salary: number; daily_hours: number; status: 'active' | 'inactive';
};

function buildQS(p?: Record<string, number | string | undefined>) {
  if (!p) return '';
  const qs = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined) qs.set(k, String(v)); });
  const s = qs.toString();
  return s ? '?' + s : '';
}

export const payrollApi = {
  // Employees
  getEmployees: () => get<EmployeeRecord[]>('/payroll/employees'),
  addEmployee:    (data: EmployeeSaveInput) => post<EmployeeRecord>('/payroll/employees', data),
  updateEmployee: (id: number, data: EmployeeSaveInput) => put<EmployeeRecord>(`/payroll/employees/${id}`, data),
  removeEmployee: (id: number) => del<{ message: string }>(`/payroll/employees/${id}`),

  // Attendance
  getAttendance: (p?: { month?: number; year?: number; employee_id?: number }) =>
    get<AttendanceRecord[]>('/payroll/attendance' + buildQS(p)),
  addAttendance: (data: { employee_id: number; date: string; check_in?: string; check_out?: string; status: AttendanceStatus; notes?: string; overtime_hours?: number }) =>
    post<AttendanceRecord>('/payroll/attendance', data),
  updateAttendance: (id: number, data: Partial<{ employee_id: number; date: string; check_in: string; check_out: string; status: AttendanceStatus; notes: string; overtime_hours: number }>) =>
    put<AttendanceRecord>(`/payroll/attendance/${id}`, data),
  removeAttendance: (id: number) => del<{ message: string }>(`/payroll/attendance/${id}`),

  // Salary adjustments (advances / deductions / bonuses)
  getAdjustments: (p?: { month?: number; year?: number; employee_id?: number; type?: AdjustmentType }) =>
    get<SalaryAdjustmentRecord[]>('/payroll/adjustments' + buildQS(p)),
  addAdjustment: (data: { employee_id: number; date: string; type: AdjustmentType; amount: number; reason?: string }) =>
    post<SalaryAdjustmentRecord>('/payroll/adjustments', data),
  updateAdjustment: (id: number, data: Partial<{ employee_id: number; date: string; type: AdjustmentType; amount: number; reason: string }>) =>
    put<SalaryAdjustmentRecord>(`/payroll/adjustments/${id}`, data),
  removeAdjustment: (id: number) => del<{ message: string }>(`/payroll/adjustments/${id}`),

  // Payroll — automatic generation only
  getRecords: (month: number, year: number) =>
    get<PayrollRow[]>(`/payroll/records?month=${month}&year=${year}`),
  generate: (month: number, year: number) =>
    post<PayrollRow[]>('/payroll/generate', { month, year }),
};

// ===== AUDIT LOG =====
export type AuditLogRecord = {
  id: number;
  timestamp: string;
  user_id: number;
  user_name: string;
  module: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  record_id: string;
  before_data: string | null;
  after_data: string | null;
  description: string;
};

export type AuditLogResponse = {
  total: number;
  page: number;
  limit: number;
  logs: AuditLogRecord[];
};

export const auditLogApi = {
  getLogs: (params?: {
    from_date?: string;
    to_date?: string;
    user_name?: string;
    module?: string;
    action?: string;
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.from_date) qs.set('from_date', params.from_date);
    if (params?.to_date)   qs.set('to_date',   params.to_date);
    if (params?.user_name) qs.set('user_name', params.user_name);
    if (params?.module)    qs.set('module',    params.module);
    if (params?.action)    qs.set('action',    params.action);
    if (params?.page)      qs.set('page',      String(params.page));
    if (params?.limit)     qs.set('limit',     String(params.limit));
    const q = qs.toString();
    return get<AuditLogResponse>(`/audit-log${q ? '?' + q : ''}`);
  },
  getDetail: (id: number) => get<AuditLogRecord>(`/audit-log/${id}`),
};

// ===== SNAPSHOTS =====
export type SnapshotRecord = {
  id: number;
  snapshot_date: string;
  total_current_assets: number;
  cash: number;
  fabric_assets: number;
  ready_stock_assets: number;
  accessories_assets: number;
  receivables: number;
  debts: number;
  created_at: string;
};

export type ProfitResult = {
  from_date: string;
  to_date: string;
  start_date: string;
  end_date: string;
  start_assets: number;
  end_assets: number;
  profit: number;
  growth_percent: number | null;
  has_start_data: boolean;
  has_end_data: boolean;
};

export const snapshotsApi = {
  getAll:    ()                              => get<SnapshotRecord[]>('/snapshots'),
  take:      ()                              => post<SnapshotRecord>('/snapshots/take', {}),
  getProfit: (from_date: string, to_date: string) =>
    get<ProfitResult>(`/snapshots/profit?from_date=${from_date}&to_date=${to_date}`),
};

// ===== AI ASSISTANT =====
export type AiAssistantResponse = { answer: string; topics_used: string[] };

export const aiAssistantApi = {
  ask: (question: string) =>
    post<AiAssistantResponse>('/ai-assistant', { question, mode: 'chat' }),
  analyzeFactory: () =>
    post<AiAssistantResponse>('/ai-assistant', { question: 'تحليل شامل', mode: 'analyze' }),
};

export interface FinancialCenterData {
  fabric_value: number;
  stock_value: number;
  accessories_value: number;
  money_owed_to_us: number;
  cash_available: number;
  total_current_assets: number;
  total_fixed_assets: number;
  total_assets: number;
  total_debts: number;
  net_position: number;
}

// ===== PRINT ORDERS =====
export type PrintOrderInput = {
  source_stock_id: number;
  quantity: number;
  date: string;
  new_model_code: string;
  new_product_name: string;
  new_color: string;
  print_type: string;
  print_cost_per_piece: number;
  notes: string;
};

export type PrintOrderRecord = {
  id: number;
  order_number: string;
  date: string;
  source_stock_id: number;
  source_model_code: string;
  source_product_name: string;
  source_color: string;
  quantity: number;
  blank_unit_cost: number;
  print_cost_per_piece: number;
  final_unit_cost: number;
  dest_stock_id: number;
  dest_model_code: string;
  dest_product_name: string;
  dest_color: string;
  print_type: string;
  notes: string;
  created_by: string;
  created_at: string;
};

export const printOrdersApi = {
  getAll: () => get<PrintOrderRecord[]>('/print-orders'),
  create: (data: PrintOrderInput) => post<PrintOrderRecord>('/print-orders', data),
};


// ===== MONTHLY CHARITY (صدقة الشهر) =====
export interface CharityPaymentRow {
  id: number; amount: number; payment_date: string; payment_method: string; notes: string;
  created_by: string; created_at: string;
  expense: { id: number; date: string; operation_type: string; statement: string; amount_out: number } | null;
}
export interface CharityMonthSummary {
  month: string; label: string; season_id: number;
  collections_total: number; order_count: number; estimated_count: number; estimated_total: number;
  rate: number; rate_percent: number; due: number; paid: number; remaining: number; overpaid: number;
  status: 'none_due' | 'unpaid' | 'partial' | 'paid'; status_label: string;
  payment_count: number; payments: CharityPaymentRow[];
}
export type CharityHistoryRow = Omit<CharityMonthSummary, 'payments'>;
export interface CharityPaymentInput {
  charity_month: string; amount: number; payment_date: string; payment_method: string; notes: string; idempotency_key: string;
}
export const charityApi = {
  getSummary: (month: string) => get<CharityMonthSummary>(`/charity/summary?month=${encodeURIComponent(month)}`),
  getHistory: () => get<{ season_id: number; months: CharityHistoryRow[] }>('/charity/history'),
  pay: (input: CharityPaymentInput) =>
    post<{ duplicate: boolean; payment: CharityPaymentRow; summary: CharityMonthSummary }>('/charity/payments', input),
  reverse: (id: number) => del<{ message: string; summary: CharityMonthSummary }>(`/charity/payments/${id}`),
};


// Append-only history behind one order: money received from the shipping company and the
// inventory-cost movements recorded when its goods left the factory.
export interface SaleLedger {
  collections: { id: number; amount: number; kind: string; collected_date: string; date_estimated: boolean; reference: string; created_by: string }[];
  collected_total: number;
  movements: { id: number; movement_type: string; model_code: string; color: string; qty: number; unit_cost: number; total_cost: number; created_at: string }[];
}


// Read-only per-order audit of «الفلوس اللي لنا برا» (see backend/src/services/receivablesAudit.ts).
export interface ReceivablesAuditOrder {
  sale_id: number; order_number: string; client: string; invoice_value: number; deposit_paid: number;
  shipped_qty: number; inventory_qty_deducted: number; inventory_cost_deducted_card: number;
  inventory_cost_deducted_recorded: number | null; collected_amount: number; outstanding_receivable: number;
  stock_status: 'removed' | 'partly_removed' | 'no_stock_card' | 'possible_mismatch'; inventory_still_in_stock: boolean;
  also_in_client_account: { account_id: number; client_name: string; amount: number } | null;
  notes: string[];
}
export interface ReceivablesAudit {
  season_id: number;
  orders: ReceivablesAuditOrder[];
  totals: { orders: number; invoice_value: number; shipped_qty: number; inventory_qty_deducted: number; inventory_cost_deducted_card: number; collected_amount: number; outstanding_receivable: number };
  reconciliation: {
    shipping_receivable_not_paid_out: number; shipping_receivable_paid_out_gap: number; client_accounts_receivable: number;
    money_owed_to_us: number; double_counted_amount: number; double_counted_orders: number;
    on_account_orders_without_client_invoice: { sale_id: number; order_number: string; remaining: number }[];
    uncosted_orders: number;
  };
}
