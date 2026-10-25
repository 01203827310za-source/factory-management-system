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
  deposit_receiver: string;
  remaining: number;
  shipping_number: string;
  // Stored values. 'تم الحجز' is DISPLAYED as «يتم التجهيز» — use statusLabel() from utils/orderStatus.ts to show it.
  order_status: 'تم الصرف' | 'لم يتم الصرف' | 'حساب عميل' | 'تم الحجز' | 'تم الإلغاء';
  /** Only for a SHIPPED order that was cancelled: what happened to the goods. */
  cancel_disposition?: 'returned_resalable' | 'not_returned' | 'returned_damaged' | null;
  /** Status the user asked for while the pieces were not available; the order is held as «يتم التجهيز» meanwhile. */
  requested_status?: string | null;
  model1_unreturned_qty?: number | null;
  model2_unreturned_qty?: number | null;
  model3_unreturned_qty?: number | null;
  model4_unreturned_qty?: number | null;
  model5_unreturned_qty?: number | null;
  /** «يتم التجهيز» orders only: units really held in stock vs still to be produced / purchased. */
  fulfillment?: {
    requested: number; reserved: number; pending: number;
    slots: { code: string; color: string; requested: number; reserved: number; pending: number; has_card: boolean }[];
  } | null;
  delivery_method: string;
  mobile: string;
  warehouse: string;
  shipping_collected: number;
  /** YYYY-MM-DD the shipping payout was confirmed; null for orders confirmed before this was recorded. */
  shipping_collected_date?: string | null;
  created_at: string;
}

export interface ExpenseRevenue {
  id: number;
  date: string;
  operation_type: 'راس مالى' | 'مصروف تشغيل' | 'ايراد مبيعات' | 'استلاف' | 'سداد' | 'صدقة';
  statement: string;
  amount_in: number;
  amount_out: number;
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
  reserved_quantity: number;
}

export interface ComputedReadyStock extends ReadyStock {
  new_production: number;
  total_sales: number;
  actual_balance: number;
  total_returns: number;
  reserved_quantity: number;
  available_quantity: number;
  /** Units prepared orders still need produced/purchased for this model+colour. */
  pending_quantity?: number;
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
  cost_per_meter: number;
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
  cost_per_piece: number;
  warehouse_entry_date: string;
  created_at: string;
  parts?: ModelPart[];
}

export interface DebtPayment {
  id: number;
  debt_id: number;
  payment_log_id?: number | null;
  date: string;
  amount: number;
  payment_method: string;
  description: string;
  receiver: string;
  created_by: string;
  created_at: string;
}

export interface Debt {
  id: number;
  date: string;
  name: string;
  total_amount: number;
  amount_paid: number;
  remaining: number;
  created_at: string;
  payments?: DebtPayment[];
}

export interface ClientAccountPayment {
  id: number;
  account_id: number;
  payment_log_id?: number | null;
  date: string;
  amount: number;
  payment_method: string;
  description: string;
  receiver: string;
  created_by: string;
  created_at: string;
}

export interface ClientAccountInvoice {
  id: number;
  account_id: number;
  date: string;
  order_number: string;
  amount: number;
  notes: string;
  created_by: string;
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
  payments?: ClientAccountPayment[];
  invoices?: ClientAccountInvoice[];
}

export interface ReturnItem {
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
}

export interface PaymentLog {
  id: number;
  date: string;
  type: 'client_payment' | 'debt_payment';
  amount: number;
  receiver: string;
  description: string;
  created_at: string;
}

export interface FabricAssetItem {
  material_type: string;
  color: string;
  available_qty: number;
  unit_cost: number;
  total: number;
}

export interface StockAssetItem {
  model_code: string;
  product_name: string;
  color: string;
  actual_qty: number;
  reserved_qty: number;
  available_qty: number;
  unit_cost: number;
  total: number;
  /** Units still needed by «يتم التجهيز» orders for this model+colour (not in stock yet). */
  pending_qty?: number;
}

export interface AccessoriesAssetItem {
  item_name: string;
  qty: number;
  unit_cost: number;
  total: number;
}

export interface CuttingAssetItem {
  cut_number: number;
  cut_description: string;
  material_type: string;
  color: string;
  total_pieces: number;
  used_pieces: number;
  remaining_pieces: number;
  cost_per_meter: number;
  total: number;
}

export interface WipAssetItem {
  model_code: string;
  model_description: string;
  color: string;
  qty_received: number;
  cost_per_piece: number;
  total: number;
  status: string;
}

export interface ReceivableAssetItem {
  source: 'sale' | 'sale_shipping_gap' | 'client_account';
  sale_id?: number;
  stock_status?: 'removed' | 'partly_removed' | 'no_stock_card' | 'possible_mismatch';
  /** Shipped goods that are still (partly) valued in ready stock → counted as inventory AND receivable. */
  inventory_still_in_stock?: boolean;
  /** Same order number also entered as a client-account invoice → debt counted twice. */
  duplicate_in_client_account?: boolean;
  name: string;
  reference: string;
  invoice_total: number;
  paid: number;
  remaining: number;
}

export interface MissingStockSummaryData {
  rows: {
    model_code: string; model_name: string; color: string;
    required: number; reserved: number; missing: number;
    has_card: boolean; physical_stock: number; reserved_for_covered_orders: number; free_stock: number;
    orders: { sale_id: number; order_number: string; client: string; requested: number; reserved: number; missing: number }[];
  }[];
  total_missing_units: number;
  total_rows: number;
  total_orders: number;
}

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
  /** Portion of stock_value that is reserved for orders (still physically in the factory). */
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
    differences: Record<'cash' | 'fabric' | 'stock' | 'accessories' | 'cutting' | 'wip' | 'receivables', number>;
    reconciled: boolean;
  };
  pending_orders?: {
    sale_id: number; order_number: string; client: string; invoice_value: number; deposit_paid: number;
    requested: number; reserved: number; pending: number;
    slots: { code: string; color: string; requested: number; reserved: number; pending: number; has_card: boolean }[];
  }[];
  /** Actual cash in the safe (= the top table's «الصافي»). Separate from cash_available. */
  cash_on_hand?: number;
  cash_items?: { key: string; label: string; amount: number; direction: 'in' | 'out' }[];
  pending_units?: number;
  /** Shortages grouped by model code + colour (same allocation as pending_orders). */
  missing_stock?: MissingStockSummaryData;
  shipping_repayment_due?: number;
  cancelled_orders?: {
    count: number; customer_credit_due: number; shipping_repayment_due: number;
    goods_outside: { orders: number; qty: number; cost: number; not_returned: { orders: number; qty: number; cost: number }; returned_damaged: { orders: number; qty: number; cost: number } };
  };
  receivable_overlap_orders?: number;
  receivable_overlap_amount?: number;
  fabric_items: FabricAssetItem[];
  stock_items: StockAssetItem[];
  accessories_items: AccessoriesAssetItem[];
  cutting_items: CuttingAssetItem[];
  wip_items: WipAssetItem[];
  receivable_items: ReceivableAssetItem[];
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

// ===== ATTENDANCE & PAYROLL =====
export interface Employee {
  id: number;
  name: string;
  phone: string;
  job_title: string;
  monthly_salary: number;
  daily_hours: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'vacation' | 'business_trip';

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  employee: Employee;
  date: string;
  check_in: string;
  check_out: string;
  worked_hours: number;
  overtime_hours: number;
  status: AttendanceStatus;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type AdjustmentType = 'advance' | 'deduction' | 'bonus';

export interface SalaryAdjustmentRecord {
  id: number;
  employee_id: number;
  employee: Employee;
  date: string;
  type: AdjustmentType;
  amount: number;
  reason: string;
  created_at: string;
  updated_at: string;
}

export interface PayrollRow {
  id: number;
  employee_id: number;
  employee: Employee;
  month: number;
  year: number;
  attendance_days: number;
  absent_days: number;
  half_days: number;
  worked_hours: number;
  overtime_hours: number;
  overtime_amount: number;
  advances: number;
  deductions: number;
  bonuses: number;
  base_salary: number;
  net_salary: number;
  generated_at: string;
}

// ===== AUDIT LOG =====
export interface PrintOrder {
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
}

export interface AuditLog {
  id: number;
  timestamp: string;
  user_id: number;
  user_name: string;
  module: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'SHIPPING_PAYOUT_CONFIRMED' | 'SHIPPING_PAYOUT_CORRECTED' | 'SHIPPING_PAYOUT_REVERSED';
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
