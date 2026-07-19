// ============================================
// API Service - HTTP Client for Backend
// All calls to Express API replacing localStorage
// ============================================

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// ===== HTTP Client =====
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.location.href = '/';
    throw new Error('غير مصرح');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'خطأ في الخادم');
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
  role: 'admin' | 'manager' | 'viewer';
}

// ===== USERS =====
export const usersApi = {
  getAll: () => get<User[]>('/users'),
  create: (data: CreateUserInput) => post<User>('/users', data),
  update: (id: number, data: Partial<CreateUserInput & { is_active: boolean }>) =>
    put<User>(`/users/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/users/${id}`),
};

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: 'admin' | 'manager' | 'viewer';
  is_active: boolean;
  last_login?: string;
  created_at: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  full_name: string;
  role: 'admin' | 'manager' | 'viewer';
}

// ===== SALES =====
export const salesApi = {
  getAll: () => get<SaleRecord[]>('/sales'),
  add: (data: Omit<SaleRecord, 'id' | 'created_at'>) => post<SaleRecord>('/sales', data),
  update: (id: number, data: Partial<SaleRecord>) => put<SaleRecord>(`/sales/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/sales/${id}`),
  convertReservation: (id: number) => post<SaleRecord>(`/sales/${id}/convert-reservation`, {}),
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
};

export const clientAccountsApi = {
  getAll: () => get<ClientAccountRecord[]>('/client-accounts'),
  add: (data: Omit<ClientAccountRecord, 'id' | 'created_at' | 'payments'>) => post<ClientAccountRecord>('/client-accounts', data),
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
};

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
  accessories_value: number;
  total_reservations: number;
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

// ===== PAYROLL =====

export type PieceRateRecord = {
  id: number; employee_id: number; category_name: string; piece_rate: number; created_at: string;
};

export type EmployeeRecord = {
  id: number; employee_code: string; employee_name: string; department: string;
  job_title: string; employee_type: 'fixed' | 'piecework'; base_salary: number;
  piece_category: string; piece_rate: number; status: 'active' | 'inactive';
  notes: string; created_at: string; updated_at: string;
  piece_rates: PieceRateRecord[];
};

export type ProductionRecord = {
  id: number; employee_id: number; employee: EmployeeRecord;
  category_name: string; piece_rate: number; quantity: number;
  production_value: number; date: string; notes: string; created_at: string;
};

export type AdvanceRecord = {
  id: number; employee_id: number; employee: EmployeeRecord;
  date: string; amount: number; notes: string; created_at: string;
};

export type DeductionRecord = {
  id: number; employee_id: number; employee: EmployeeRecord;
  date: string; amount: number; reason: string; created_at: string;
};

export type BonusRecord = {
  id: number; employee_id: number; employee: EmployeeRecord;
  date: string; amount: number; reason: string; created_at: string;
};

export type SalaryRow = {
  employee: EmployeeRecord; production_value: number;
  total_advances: number; total_deductions: number; total_bonuses: number;
  net_salary: number; productions: ProductionRecord[];
};

export type PayrollReportData = {
  month: number; year: number; total_employees: number;
  total_fixed_employees: number; total_piecework_employees: number;
  total_fixed_salaries: number; total_piecework_salaries: number;
  total_advances: number; total_deductions: number; total_bonuses: number;
  total_payroll_cost: number; rows: SalaryRow[];
};

type EmployeeSaveInput = {
  employee_code: string; employee_name: string; department: string; job_title: string;
  employee_type: 'fixed' | 'piecework'; base_salary: number; status: 'active' | 'inactive';
  notes: string; piece_rates?: { category_name: string; piece_rate: number }[];
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

  // Production
  getProduction: (p?: { month?: number; year?: number; employee_id?: number }) =>
    get<ProductionRecord[]>('/payroll/production' + buildQS(p)),
  addProduction: (data: { employee_id: number; category_name: string; piece_rate: number; quantity: number; date: string; notes?: string }) =>
    post<ProductionRecord>('/payroll/production', data),
  updateProduction: (id: number, data: Partial<{ employee_id: number; category_name: string; piece_rate: number; quantity: number; date: string; notes: string }>) =>
    put<ProductionRecord>(`/payroll/production/${id}`, data),
  removeProduction: (id: number) => del<{ message: string }>(`/payroll/production/${id}`),

  // Advances
  getAdvances: (p?: { month?: number; year?: number; employee_id?: number }) =>
    get<AdvanceRecord[]>('/payroll/advances' + buildQS(p)),
  addAdvance:    (data: { employee_id: number; date: string; amount: number; notes?: string }) =>
    post<AdvanceRecord>('/payroll/advances', data),
  updateAdvance: (id: number, data: Partial<{ employee_id: number; date: string; amount: number; notes: string }>) =>
    put<AdvanceRecord>(`/payroll/advances/${id}`, data),
  removeAdvance: (id: number) => del<{ message: string }>(`/payroll/advances/${id}`),

  // Deductions
  getDeductions: (p?: { month?: number; year?: number; employee_id?: number }) =>
    get<DeductionRecord[]>('/payroll/deductions' + buildQS(p)),
  addDeduction:    (data: { employee_id: number; date: string; amount: number; reason?: string }) =>
    post<DeductionRecord>('/payroll/deductions', data),
  updateDeduction: (id: number, data: Partial<{ employee_id: number; date: string; amount: number; reason: string }>) =>
    put<DeductionRecord>(`/payroll/deductions/${id}`, data),
  removeDeduction: (id: number) => del<{ message: string }>(`/payroll/deductions/${id}`),

  // Bonuses
  getBonuses: (p?: { month?: number; year?: number; employee_id?: number }) =>
    get<BonusRecord[]>('/payroll/bonuses' + buildQS(p)),
  addBonus:    (data: { employee_id: number; date: string; amount: number; reason?: string }) =>
    post<BonusRecord>('/payroll/bonuses', data),
  updateBonus: (id: number, data: Partial<{ employee_id: number; date: string; amount: number; reason: string }>) =>
    put<BonusRecord>(`/payroll/bonuses/${id}`, data),
  removeBonus: (id: number) => del<{ message: string }>(`/payroll/bonuses/${id}`),

  // Salary & Report
  getSalary: (month: number, year: number) =>
    get<SalaryRow[]>(`/payroll/salary?month=${month}&year=${year}`),
  getReport:  (month: number, year: number) =>
    get<PayrollReportData>(`/payroll/report?month=${month}&year=${year}`),
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
