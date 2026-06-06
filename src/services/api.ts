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
  hatem_in: number; hatem_out: number;
  mido_in: number; mido_out: number;
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
  mido_stock: number;
  hatem_stock: number;
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

export type ModelProdRecord = {
  id: number;
  date: string;
  cut_number: number;
  model_code: string;
  qty_from_cutting: number;
  model_description: string;
  color: string;
  sizes: string;
  status: string;
  wastage: number;
  qty_received: number;
  warehouse_entry_date: string;
  created_at: string;
};

// ===== DEBTS =====
export const debtsApi = {
  getAll: () => get<DebtRecord[]>('/debts'),
  add: (data: Omit<DebtRecord, 'id' | 'created_at'>) => post<DebtRecord>('/debts', data),
  update: (id: number, data: Partial<DebtRecord>) => put<DebtRecord>(`/debts/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/debts/${id}`),
};

export type DebtRecord = {
  id: number;
  date: string;
  name: string;
  total_amount: number;
  amount_paid: number;
  remaining: number;
  created_at: string;
};

// ===== CLIENT ACCOUNTS =====
export const clientAccountsApi = {
  getAll: () => get<ClientAccountRecord[]>('/client-accounts'),
  add: (data: Omit<ClientAccountRecord, 'id' | 'created_at'>) => post<ClientAccountRecord>('/client-accounts', data),
  update: (id: number, data: Partial<ClientAccountRecord>) => put<ClientAccountRecord>(`/client-accounts/${id}`, data),
  remove: (id: number) => del<{ message: string }>(`/client-accounts/${id}`),
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
  hatem_total_in: number;
  hatem_total_out: number;
  hatem_net: number;
  mido_total_in: number;
  mido_total_out: number;
  mido_net: number;
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
export interface EmployeeTransaction {
  date: string;
  type: string;
  description: string;
  client: string;
  amount: number;
  employee: string;
  direction: 'in' | 'out';
}

export interface EmployeeMovementsData {
  employee: string;
  from_date: string;
  to_date: string;
  summary: {
    total_received: number;
    total_paid: number;
    net_balance: number;
    transaction_count: number;
  };
  expenses_breakdown: Record<string, { exp_in: number; exp_out: number }>;
  transactions: EmployeeTransaction[];
}

export const employeeMovementsApi = {
  get: (employee: string, from_date: string, to_date: string) =>
    get<EmployeeMovementsData>(`/reports/employee-movements?employee=${encodeURIComponent(employee)}&from_date=${from_date}&to_date=${to_date}`),
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

export interface PartnerSummary {
  hatem_total_in: number;
  hatem_total_out: number;
  hatem_net: number;
  mido_total_in: number;
  mido_total_out: number;
  mido_net: number;
  total_in: number;
  total_out: number;
  total_net: number;
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
  partner_summary: PartnerSummary;
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
export type EmployeeRecord = {
  id: number;
  employee_code: string;
  employee_name: string;
  department: string;
  job_title: string;
  employee_type: 'fixed' | 'piecework';
  base_salary: number;
  piece_category: string;
  piece_rate: number;
  status: 'active' | 'inactive';
  notes: string;
  created_at: string;
  updated_at: string;
};

export type PayrollRecordFull = {
  id: number;
  employee_id: number;
  employee: EmployeeRecord;
  employee_type: string;
  month: number;
  year: number;
  attendance_days: number;
  absence_days: number;
  absence_deduction: number;
  advances: number;
  additional_deductions: number;
  bonus: number;
  produced_qty: number;
  production_bonus: number;
  piece_income: number;
  net_salary: number;
  created_at: string;
  updated_at: string;
};

export type PayrollReportData = {
  total_salaries: number;
  total_advances: number;
  total_deductions: number;
  total_bonuses: number;
  net_payroll: number;
  records: PayrollRecordFull[];
};

export const payrollApi = {
  // Employees
  getEmployees: () => get<EmployeeRecord[]>('/payroll/employees'),
  addEmployee: (data: Omit<EmployeeRecord, 'id' | 'created_at' | 'updated_at'>) =>
    post<EmployeeRecord>('/payroll/employees', data),
  updateEmployee: (id: number, data: Partial<Omit<EmployeeRecord, 'id' | 'created_at' | 'updated_at'>>) =>
    put<EmployeeRecord>(`/payroll/employees/${id}`, data),
  removeEmployee: (id: number) => del<{ message: string }>(`/payroll/employees/${id}`),
  // Payroll records
  getRecords: (params?: { month?: number; year?: number; employee_id?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month)       qs.set('month',       String(params.month));
    if (params?.year)        qs.set('year',         String(params.year));
    if (params?.employee_id) qs.set('employee_id',  String(params.employee_id));
    const q = qs.toString();
    return get<PayrollRecordFull[]>(`/payroll${q ? '?' + q : ''}`);
  },
  generate: (month: number, year: number) =>
    post<{ generated: number; records: PayrollRecordFull[] }>('/payroll/generate', { month, year }),
  updateRecord: (id: number, data: Partial<PayrollRecordFull>) =>
    put<PayrollRecordFull>(`/payroll/${id}`, data),
  deleteRecord: (id: number) => del<{ message: string }>(`/payroll/${id}`),
  getReport: (params?: { month?: number; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year)  qs.set('year',  String(params.year));
    const q = qs.toString();
    return get<PayrollReportData>(`/payroll/report${q ? '?' + q : ''}`);
  },
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
