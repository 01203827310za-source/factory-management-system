// Types for the Factory Management System

export interface Sale {
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
  deposit_receiver: 'حاتم' | 'ميدو' | '';
  remaining: number;
  shipping_number: string;
  order_status: 'تم الصرف' | 'لم يتم الصرف' | 'حساب عميل' | 'تم الحجز' | 'تم الإلغاء';
  delivery_method: string;
  mobile: string;
  warehouse: string;
  shipping_collected: number;
  created_at: string;
}

export interface ExpenseRevenue {
  id: number;
  date: string;
  operation_type: 'راس مالى' | 'مصروف تشغيل' | 'ايراد مبيعات' | 'استلاف' | 'سداد';
  statement: string;
  hatem_in: number;
  hatem_out: number;
  mido_in: number;
  mido_out: number;
  created_at: string;
}

export interface ReadyStock {
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
}

export interface ComputedReadyStock extends ReadyStock {
  new_production: number;
  total_sales: number;
  actual_balance: number;
  total_returns: number;
  reserved_quantity: number;
  available_quantity: number;
}

export interface FabricWarehouse {
  id: number;
  date: string;
  material_type: string;
  color: string;
  qty_in: number;
  cost_per_kg: number;
  avg_cost_per_kg: number;
  last_purchase_price: number;
  created_at: string;
}

export interface ComputedFabric extends FabricWarehouse {
  qty_consumed: number;
  available_balance: number;
}

export interface AccessoriesWarehouse {
  id: number;
  date: string;
  item_name: string;
  qty_in: number;
  qty_consumed: number;
  cost: number;
  created_at: string;
}

export interface ComputedAccessories extends AccessoriesWarehouse {
  available_balance: number;
}

export interface CuttingOrder {
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
  remaining_pieces?: number;
}

export interface ModelPart {
  id: number;
  model_id: number;
  part_type: string;
  cut_number: number;
  color: string;
  created_at: string;
}

export interface ModelProduction {
  id: number;
  date: string;
  cut_number: number; // mirrors first part's cut_number — kept for backward compatibility
  model_code: string;
  qty_from_cutting: number;
  model_description: string;
  color: string;
  sizes: string;
  status: 'قيد التشغيل' | 'تام' | 'هالك';
  wastage: number;
  qty_received: number;
  warehouse_entry_date: string;
  created_at: string;
  parts?: ModelPart[];
}

export interface Debt {
  id: number;
  date: string;
  name: string;
  total_amount: number;
  amount_paid: number;
  remaining: number;
  created_at: string;
}

export interface ClientAccount {
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
}

export interface ReturnItem {
  id: number;
  date: string;
  order_number: string;
  client_name: string;
  returned_by: 'حاتم' | 'ميدو' | '';
  paid_by: 'حاتم' | 'ميدو' | '';
  model_code: string;
  model_qty: number;
  model_color: string;
  refund_amount: number;
  notes: string;
  created_at: string;
}

export interface PaymentLog {
  id: number;
  date: string;
  type: 'client_payment' | 'debt_payment';
  amount: number;
  receiver: 'حاتم' | 'ميدو' | '';
  description: string;
  created_at: string;
}

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

// ===== NEW: User Types =====
export type UserRole = 'admin' | 'manager' | 'viewer';

export interface AppUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login?: string;
  created_at: string;
}

export type Page = 'dashboard' | 'sales' | 'expenses' | 'readyStock' | 'fabric' | 'accessories' | 'cutting' | 'modelProd' | 'clientAccts' | 'debts' | 'financialCenter' | 'fixedAssets' | 'reports' | 'payroll' | 'auditLog' | 'aiAssistant';

// ===== PAYROLL =====
export interface PieceRateItem {
  id: number;
  employee_id: number;
  category_name: string;
  piece_rate: number;
  created_at: string;
}

export interface Employee {
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
  piece_rates: PieceRateItem[];
}

export interface ProductionRecord {
  id: number;
  employee_id: number;
  employee: Employee;
  category_name: string;
  piece_rate: number;
  quantity: number;
  production_value: number;
  date: string;
  notes: string;
  created_at: string;
}

export interface AdvanceRecord {
  id: number;
  employee_id: number;
  employee: Employee;
  date: string;
  amount: number;
  notes: string;
  created_at: string;
}

export interface DeductionRecord {
  id: number;
  employee_id: number;
  employee: Employee;
  date: string;
  amount: number;
  reason: string;
  created_at: string;
}

export interface BonusRecord {
  id: number;
  employee_id: number;
  employee: Employee;
  date: string;
  amount: number;
  reason: string;
  created_at: string;
}

export interface SalaryRow {
  employee: Employee;
  production_value: number;
  total_advances: number;
  total_deductions: number;
  total_bonuses: number;
  net_salary: number;
  productions: ProductionRecord[];
}

export interface PayrollReportData {
  month: number;
  year: number;
  total_employees: number;
  total_fixed_employees: number;
  total_piecework_employees: number;
  total_fixed_salaries: number;
  total_piecework_salaries: number;
  total_advances: number;
  total_deductions: number;
  total_bonuses: number;
  total_payroll_cost: number;
  rows: SalaryRow[];
}

// ===== AUDIT LOG =====
export interface AuditLog {
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
}

export interface AuditLogResponse {
  total: number;
  page: number;
  limit: number;
  logs: AuditLog[];
}
