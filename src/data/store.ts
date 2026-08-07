// ============================================
// store.ts - Updated: Uses API instead of localStorage
// All functions are now ASYNC and call the backend
// ============================================

import {
  salesApi, expensesApi, readyStockApi, fabricApi, accessoriesApi,
  cuttingApi, modelProdApi, debtsApi, clientAccountsApi, returnsApi,
  paymentLogApi, marketersApi, dashboardApi,
  debtPaymentsApi, clientAccountPaymentsApi, clientAccountInvoicesApi,
  type SaleRecord, type ExpenseRecord, type ReadyStockRecord,
  type FabricRecord, type AccessoriesRecord, type CuttingRecord,
  type ModelProdRecord, type DebtRecord, type ClientAccountRecord,
  type ReturnRecord, type PaymentLogRecord, type DashboardMetrics,
  type PaymentHistoryRecord, type ClientAccountInvoiceRecord,
} from '../services/api';

import type {
  Sale, ExpenseRevenue, ReadyStock, ComputedReadyStock,
  FabricWarehouse, ComputedFabric, AccessoriesWarehouse, ComputedAccessories,
  CuttingOrder, ModelProduction, Debt, ClientAccount, ReturnItem, PaymentLog,
  DebtPayment, ClientAccountPayment, ClientAccountInvoice,
} from '../types';

// Type aliases - API types match our app types exactly
export type { SaleRecord as Sale };

// ===== SALES =====
export const salesStore = {
  getAll: (): Promise<Sale[]> => salesApi.getAll() as Promise<Sale[]>,
  add: (item: Omit<Sale, 'id' | 'remaining' | 'created_at'>): Promise<Sale> =>
    salesApi.add(item as Omit<SaleRecord, 'id' | 'created_at'>) as Promise<Sale>,
  update: (id: number, data: Partial<Sale>): Promise<Sale | null> =>
    salesApi.update(id, data as Partial<SaleRecord>) as Promise<Sale>,
  remove: (id: number): Promise<void> => salesApi.remove(id).then(() => void 0),
};

// ===== EXPENSES =====
export const expensesStore = {
  getAll: (): Promise<ExpenseRevenue[]> => expensesApi.getAll() as Promise<ExpenseRevenue[]>,
  add: (item: Omit<ExpenseRevenue, 'id' | 'created_at'>): Promise<ExpenseRevenue> =>
    expensesApi.add(item as Omit<ExpenseRecord, 'id' | 'created_at'>) as Promise<ExpenseRevenue>,
  update: (id: number, data: Partial<ExpenseRevenue>): Promise<ExpenseRevenue> =>
    expensesApi.update(id, data as Partial<ExpenseRecord>) as Promise<ExpenseRevenue>,
  remove: (id: number): Promise<void> => expensesApi.remove(id).then(() => void 0),
};

// ===== READY STOCK =====
export const readyStockStore = {
  getAll: (): Promise<ReadyStock[]> => readyStockApi.getAll() as Promise<ReadyStock[]>,
  add: (item: Omit<ReadyStock, 'id'>): Promise<ReadyStock> =>
    readyStockApi.add(item as Omit<ReadyStockRecord, 'id'>) as Promise<ReadyStock>,
  update: (id: number, data: Partial<ReadyStock>): Promise<ReadyStock> =>
    readyStockApi.update(id, data as Partial<ReadyStockRecord>) as Promise<ReadyStock>,
  remove: (id: number): Promise<void> => readyStockApi.remove(id).then(() => void 0),

  // Computed values use optional cross-module data only when the user may view it.
  getComputed: async (options?: {
    includeSales?: boolean;
    includeModelProd?: boolean;
    includeReturns?: boolean;
  }): Promise<ComputedReadyStock[]> => {
    const [stock, sales, modelProds, returns_] = await Promise.all([
      readyStockApi.getAll(),
      options?.includeSales ? salesApi.getAll() : Promise.resolve([]),
      options?.includeModelProd ? modelProdApi.getAll() : Promise.resolve([]),
      options?.includeReturns ? returnsApi.getAll() : Promise.resolve([]),
    ]);

    const newProd: Record<string, number> = {};
    modelProds.forEach(mp => {
      const k = `${mp.model_code}|${mp.color || ''}`;
      newProd[k] = (newProd[k] || 0) + mp.qty_received;
    });

    // Only deduct stock for dispatched/pending sales — NOT reservations or cancelled orders
    const totalSales: Record<string, number> = {};
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
          if (code && qty > 0) {
            const k = `${code}|${color || ''}`;
            totalSales[k] = (totalSales[k] || 0) + qty;
          }
        });
      });

    const returnQty: Record<string, number> = {};
    returns_.forEach(r => {
      if (r.model_code) {
        const k = `${r.model_code}|${r.model_color || ''}`;
        returnQty[k] = (returnQty[k] || 0) + r.model_qty;
      }
    });

    return stock.map(item => {
      const k = `${item.model_code}|${item.color || ''}`;
      const actualBalance =
        item.opening_balance +
        (newProd[k] || 0) -
        (totalSales[k] || 0) +
        (returnQty[k] || 0);
      // reserved_quantity is persisted in the DB by the reservation workflow — read it directly
      const reserved = item.reserved_quantity || 0;
      return {
        ...item,
        new_production: newProd[k] || 0,
        total_sales: totalSales[k] || 0,
        actual_balance: actualBalance,
        total_returns: returnQty[k] || 0,
        reserved_quantity: reserved,
        available_quantity: actualBalance - reserved,
      };
    }) as ComputedReadyStock[];
  },
};

// ===== FABRIC =====
export const fabricStore = {
  getAll: (): Promise<FabricWarehouse[]> => fabricApi.getAll() as Promise<FabricWarehouse[]>,
  add: (item: Omit<FabricWarehouse, 'id' | 'created_at'>): Promise<FabricWarehouse> =>
    fabricApi.add(item as Omit<FabricRecord, 'id' | 'created_at'>) as Promise<FabricWarehouse>,
  update: (id: number, data: Partial<FabricWarehouse>): Promise<FabricWarehouse> =>
    fabricApi.update(id, data as Partial<FabricRecord>) as Promise<FabricWarehouse>,
  remove: (id: number): Promise<void> => fabricApi.remove(id).then(() => void 0),

  getComputed: async (): Promise<ComputedFabric[]> => {
    const [fabric, cutting] = await Promise.all([fabricApi.getAll(), cuttingApi.getAll()]);
    const consumed: Record<string, number> = {};
    cutting.forEach(c => {
      const key = `${c.material_type}|${c.color}`;
      consumed[key] = (consumed[key] || 0) + c.kg_consumed;
    });
    return fabric.map(f => ({
      ...f,
      qty_consumed: consumed[`${f.material_type}|${f.color}`] || 0,
      available_balance: f.qty_in - (consumed[`${f.material_type}|${f.color}`] || 0),
    })) as ComputedFabric[];
  },
};

// ===== ACCESSORIES =====
export const accessoriesStore = {
  getAll: (): Promise<AccessoriesWarehouse[]> => accessoriesApi.getAll() as Promise<AccessoriesWarehouse[]>,
  add: (item: Omit<AccessoriesWarehouse, 'id' | 'created_at'>): Promise<AccessoriesWarehouse> =>
    accessoriesApi.add(item as Omit<AccessoriesRecord, 'id' | 'created_at'>) as Promise<AccessoriesWarehouse>,
  update: (id: number, data: Partial<AccessoriesWarehouse>): Promise<AccessoriesWarehouse> =>
    accessoriesApi.update(id, data as Partial<AccessoriesRecord>) as Promise<AccessoriesWarehouse>,
  remove: (id: number): Promise<void> => accessoriesApi.remove(id).then(() => void 0),

  getComputed: async (): Promise<ComputedAccessories[]> => {
    const items = await accessoriesApi.getAll();
    return items.map(a => ({ ...a, available_balance: a.qty_in - a.qty_consumed })) as ComputedAccessories[];
  },
};

// ===== CUTTING =====
export const cuttingStore = {
  getAll: (): Promise<CuttingOrder[]> => cuttingApi.getAll() as Promise<CuttingOrder[]>,
  getColors: (cutNumber: number): Promise<string[]> => cuttingApi.getColors(cutNumber),
  add: (item: Omit<CuttingOrder, 'id' | 'created_at'>): Promise<CuttingOrder> =>
    cuttingApi.add(item as Omit<CuttingRecord, 'id' | 'created_at'>) as Promise<CuttingOrder>,
  update: (id: number, data: Partial<CuttingOrder>): Promise<CuttingOrder> =>
    cuttingApi.update(id, data as Partial<CuttingRecord>) as Promise<CuttingOrder>,
  remove: (id: number): Promise<void> => cuttingApi.remove(id).then(() => void 0),
};

// ===== MODEL PRODUCTION =====
export const modelProdStore = {
  getAll: (): Promise<ModelProduction[]> => modelProdApi.getAll() as Promise<ModelProduction[]>,
  add: (item: Omit<ModelProduction, 'id' | 'created_at'>): Promise<ModelProduction> =>
    modelProdApi.add(item as Omit<ModelProdRecord, 'id' | 'created_at'>) as Promise<ModelProduction>,
  update: (id: number, data: Partial<ModelProduction>): Promise<ModelProduction> =>
    modelProdApi.update(id, data as Partial<ModelProdRecord>) as Promise<ModelProduction>,
  remove: (id: number): Promise<void> => modelProdApi.remove(id).then(() => void 0),
};

// ===== DEBTS =====
export const debtsStore = {
  getAll: (): Promise<Debt[]> => debtsApi.getAll() as Promise<Debt[]>,
  add: (item: Omit<Debt, 'id' | 'remaining' | 'created_at'>): Promise<Debt> =>
    debtsApi.add(item as Omit<DebtRecord, 'id' | 'created_at'>) as Promise<Debt>,
  update: (id: number, data: Partial<Debt>): Promise<Debt> =>
    debtsApi.update(id, data as Partial<DebtRecord>) as Promise<Debt>,
  remove: (id: number): Promise<void> => debtsApi.remove(id).then(() => void 0),
};

// ===== CLIENT ACCOUNTS =====
export const clientAcctsStore = {
  getAll: (): Promise<ClientAccount[]> => clientAccountsApi.getAll() as Promise<ClientAccount[]>,
  add: (item: Omit<ClientAccount, 'id' | 'remaining' | 'created_at'>): Promise<ClientAccount> =>
    clientAccountsApi.add(item as Omit<ClientAccountRecord, 'id' | 'created_at'>) as Promise<ClientAccount>,
  update: (id: number, data: Partial<ClientAccount>): Promise<ClientAccount> =>
    clientAccountsApi.update(id, data as Partial<ClientAccountRecord>) as Promise<ClientAccount>,
  remove: (id: number): Promise<void> => clientAccountsApi.remove(id).then(() => void 0),
};

// ===== DEBT PAYMENTS =====
export const debtPaymentsStore = {
  add: (debtId: number, data: Omit<DebtPayment, 'id' | 'debt_id' | 'payment_log_id' | 'created_at' | 'created_by'>): Promise<DebtPayment> =>
    debtPaymentsApi.add(debtId, data as Omit<PaymentHistoryRecord, 'id' | 'created_at' | 'created_by'>) as Promise<DebtPayment>,
  update: (debtId: number, pid: number, data: Partial<Omit<DebtPayment, 'id' | 'debt_id' | 'payment_log_id' | 'created_at' | 'created_by'>>): Promise<DebtPayment> =>
    debtPaymentsApi.update(debtId, pid, data as Partial<Omit<PaymentHistoryRecord, 'id' | 'created_at' | 'created_by'>>) as Promise<DebtPayment>,
  remove: (debtId: number, pid: number): Promise<void> =>
    debtPaymentsApi.remove(debtId, pid).then(() => void 0),
};

// ===== CLIENT ACCOUNT PAYMENTS =====
export const clientAccountPaymentsStore = {
  add: (accountId: number, data: Omit<ClientAccountPayment, 'id' | 'account_id' | 'payment_log_id' | 'created_at' | 'created_by'>): Promise<ClientAccountPayment> =>
    clientAccountPaymentsApi.add(accountId, data as Omit<PaymentHistoryRecord, 'id' | 'created_at' | 'created_by'>) as Promise<ClientAccountPayment>,
  update: (accountId: number, pid: number, data: Partial<Omit<ClientAccountPayment, 'id' | 'account_id' | 'payment_log_id' | 'created_at' | 'created_by'>>): Promise<ClientAccountPayment> =>
    clientAccountPaymentsApi.update(accountId, pid, data as Partial<Omit<PaymentHistoryRecord, 'id' | 'created_at' | 'created_by'>>) as Promise<ClientAccountPayment>,
  remove: (accountId: number, pid: number): Promise<void> =>
    clientAccountPaymentsApi.remove(accountId, pid).then(() => void 0),
};

// ===== CLIENT ACCOUNT INVOICES =====
export const clientAccountInvoicesStore = {
  add: (accountId: number, data: Omit<ClientAccountInvoice, 'id' | 'account_id' | 'created_at' | 'created_by'>): Promise<ClientAccountInvoice> =>
    clientAccountInvoicesApi.add(accountId, data as Omit<ClientAccountInvoiceRecord, 'id' | 'account_id' | 'created_at' | 'created_by'>) as Promise<ClientAccountInvoice>,
};

// ===== RETURNS =====
export const returnsStore = {
  getAll: (): Promise<ReturnItem[]> => returnsApi.getAll() as Promise<ReturnItem[]>,
  add: (item: Omit<ReturnItem, 'id' | 'created_at'>): Promise<ReturnItem> =>
    returnsApi.add(item as Omit<ReturnRecord, 'id' | 'created_at'>) as Promise<ReturnItem>,
  update: (id: number, data: Partial<ReturnItem>): Promise<ReturnItem> =>
    returnsApi.update(id, data as Partial<ReturnRecord>) as Promise<ReturnItem>,
  remove: (id: number): Promise<void> => returnsApi.remove(id).then(() => void 0),
};

// ===== PAYMENT LOG =====
export const paymentLogStore = {
  getAll: (): Promise<PaymentLog[]> => paymentLogApi.getAll() as Promise<PaymentLog[]>,
  add: (item: Omit<PaymentLog, 'id' | 'created_at'>): Promise<PaymentLog> =>
    paymentLogApi.add(item as Omit<PaymentLogRecord, 'id' | 'created_at'>) as Promise<PaymentLog>,
  remove: (id: number): Promise<void> => paymentLogApi.remove(id).then(() => void 0),
};

// ===== MARKETERS =====
export const marketersStore = {
  getAll: (): Promise<string[]> => marketersApi.getAll(),
  add: (name: string): Promise<string[]> => marketersApi.add(name),
  remove: (name: string): Promise<string[]> => marketersApi.remove(name),
};

// ===== DASHBOARD =====
export const getDashboardMetrics = (): Promise<DashboardMetrics> => dashboardApi.getMetrics();

// Legacy no-op exports (were used for localStorage seeding - no longer needed)
export const seedData = () => {};
export const resetData = () => {};
export const isSeeded = () => true;
