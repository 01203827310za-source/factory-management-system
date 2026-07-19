export const ACTIONS = ['view', 'create', 'edit', 'delete'] as const;

export type PermissionAction = typeof ACTIONS[number];

export type PermissionModule = {
  key: string;
  label: string;
  actions?: readonly PermissionAction[];
};

export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'dashboard', label: 'Dashboard', actions: ['view'] },
  { key: 'fabric', label: 'Fabric Warehouse' },
  { key: 'fabric_purchases', label: 'Fabric Purchases' },
  { key: 'cutting', label: 'Cutting' },
  { key: 'model_prod', label: 'Model Production' },
  { key: 'ready_stock', label: 'Ready Stock' },
  { key: 'sales', label: 'Sales' },
  { key: 'expenses', label: 'Expenses & Revenues' },
  { key: 'client_accounts', label: 'Client Accounts' },
  { key: 'debts', label: 'Debts' },
  { key: 'accessories', label: 'Accessories Warehouse' },
  { key: 'assets', label: 'Assets' },
  { key: 'reports', label: 'Reports', actions: ['view', 'create'] },
  { key: 'users', label: 'Users' },
  { key: 'ai_assistant', label: 'AI Assistant', actions: ['view', 'create'] },
  { key: 'settings', label: 'Settings' },
  { key: 'audit_log', label: 'Audit Log', actions: ['view'] },
  { key: 'payroll', label: 'Payroll' },
  { key: 'returns', label: 'Returns' },
  { key: 'payment_log', label: 'Payment Log', actions: ['view', 'create', 'delete'] },
  { key: 'marketers', label: 'Marketers', actions: ['view', 'create', 'delete'] },
  { key: 'snapshots', label: 'Snapshots', actions: ['view', 'create'] },
  { key: 'print_orders', label: 'Print Orders', actions: ['view', 'create'] },
  { key: 'financial_center', label: 'Financial Center', actions: ['view'] },
];

export const ALL_PERMISSION_KEYS = PERMISSION_MODULES.flatMap(module =>
  ACTIONS.map(action => `${module.key}.${action}`)
);

const defaultRolePermissionKeys = PERMISSION_MODULES.flatMap(module =>
  (module.actions ?? ACTIONS).map(action => `${module.key}.${action}`)
);

const readOnly = PERMISSION_MODULES.map(module => `${module.key}.view`);

const warehousePermissions = defaultRolePermissionKeys.filter(key =>
  key.startsWith('dashboard.') ||
  key.startsWith('fabric.') ||
  key.startsWith('fabric_purchases.') ||
  key.startsWith('cutting.') ||
  key.startsWith('model_prod.') ||
  key.startsWith('ready_stock.') ||
  key.startsWith('accessories.') ||
  key.startsWith('print_orders.') ||
  key.startsWith('reports.')
);

const salesPermissions = defaultRolePermissionKeys.filter(key =>
  key.startsWith('dashboard.') ||
  key.startsWith('sales.') ||
  key.startsWith('returns.') ||
  key.startsWith('marketers.') ||
  key.startsWith('client_accounts.') ||
  key.startsWith('ready_stock.view') ||
  key.startsWith('reports.')
);

const accountantPermissions = defaultRolePermissionKeys.filter(key =>
  key.startsWith('dashboard.') ||
  key.startsWith('expenses.') ||
  key.startsWith('debts.') ||
  key.startsWith('client_accounts.') ||
  key.startsWith('payment_log.') ||
  key.startsWith('assets.') ||
  key.startsWith('financial_center.') ||
  key.startsWith('reports.') ||
  key.startsWith('audit_log.')
);

export const DEFAULT_ROLES = [
  {
    name: 'admin',
    display_name: 'Administrator',
    description: 'Full system access',
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    name: 'manager',
    display_name: 'Factory Manager',
    description: 'Operational access without user administration',
    permissions: defaultRolePermissionKeys.filter(key => !key.startsWith('users.') && !key.startsWith('settings.')),
  },
  {
    name: 'warehouse',
    display_name: 'Warehouse',
    description: 'Warehouse, cutting, production, and stock operations',
    permissions: warehousePermissions,
  },
  {
    name: 'sales',
    display_name: 'Sales',
    description: 'Sales, returns, marketers, and client account operations',
    permissions: salesPermissions,
  },
  {
    name: 'accountant',
    display_name: 'Accountant',
    description: 'Financial, assets, debts, and report operations',
    permissions: accountantPermissions,
  },
  {
    name: 'viewer',
    display_name: 'Viewer',
    description: 'Read-only access',
    permissions: readOnly,
  },
] as const;

export const LEGACY_ROLE_TO_RBAC_ROLE: Record<string, string> = {
  admin: 'admin',
  manager: 'manager',
  viewer: 'viewer',
};
