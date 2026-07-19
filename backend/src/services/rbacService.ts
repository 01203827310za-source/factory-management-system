import prisma from '../lib/prisma';
import {
  ACTIONS,
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLES,
  LEGACY_ROLE_TO_RBAC_ROLE,
  PERMISSION_MODULES,
  type PermissionAction,
} from '../config/rbac';

const ADMIN_ROLE_NAME = 'admin';

export async function syncDefaultRbac() {
  const permissions = new Map<string, { id: number }>();

  for (const module of PERMISSION_MODULES) {
    for (const action of module.actions ?? ACTIONS) {
      const key = `${module.key}.${action}`;
      const permission = await prisma.permission.upsert({
        where: { key },
        update: {
          module: module.key,
          action,
          label: `${module.label} ${action}`,
        },
        create: {
          key,
          module: module.key,
          action,
          label: `${module.label} ${action}`,
        },
        select: { id: true, key: true },
      });
      permissions.set(permission.key, permission);
    }
  }

  for (const roleDef of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: {
        display_name: roleDef.display_name,
        description: roleDef.description,
      },
      create: {
        name: roleDef.name,
        display_name: roleDef.display_name,
        description: roleDef.description,
      },
      select: { id: true, name: true },
    });

    const permissionIds = roleDef.permissions
      .map(key => permissions.get(key)?.id)
      .filter((id): id is number => id !== undefined);

    await prisma.rolePermission.deleteMany({ where: { role_id: role.id } });
    if (permissionIds.length) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map(permission_id => ({ role_id: role.id, permission_id })),
        skipDuplicates: true,
      });
    }
  }

  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  const roleByName = new Map(roles.map(role => [role.name, role.id]));
  const adminRoleId = roleByName.get(ADMIN_ROLE_NAME);
  const users = await prisma.user.findMany({ select: { id: true, role: true, role_id: true, username: true } });

  for (const user of users) {
    const targetRoleName = LEGACY_ROLE_TO_RBAC_ROLE[user.role] ?? user.role ?? 'viewer';
    const roleId = roleByName.get(targetRoleName) ?? roleByName.get('viewer');
    if (roleId && user.role_id !== roleId) {
      await prisma.user.update({ where: { id: user.id }, data: { role_id: roleId } });
    }
  }

  if (adminRoleId) {
    const adminUsers = await prisma.user.findMany({
      where: {
        OR: [
          { role_id: adminRoleId },
          { role: ADMIN_ROLE_NAME },
        ],
      },
      select: { id: true },
    });

    if (adminUsers.length) {
      await prisma.userPermission.deleteMany({
        where: { user_id: { in: adminUsers.map(user => user.id) } },
      });
    }
  }
}

export async function getEffectivePermissionKeys(userId: number): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      role_ref: {
        select: {
          name: true,
          role_permissions: {
            select: { permission: { select: { key: true } } },
          },
        },
      },
      user_permissions: {
        select: { allowed: true, permission: { select: { key: true } } },
      },
    },
  });

  if (!user) return [];
  if (user.role === ADMIN_ROLE_NAME && !user.role_ref) return ALL_PERMISSION_KEYS;

  const permissions = new Set<string>();
  user.role_ref?.role_permissions.forEach(rp => permissions.add(rp.permission.key));

  if (user.role_ref?.name !== ADMIN_ROLE_NAME) {
    for (const override of user.user_permissions) {
      if (override.allowed) permissions.add(override.permission.key);
      else permissions.delete(override.permission.key);
    }
  }

  return [...permissions].sort();
}

const actionByMethod: Record<string, PermissionAction> = {
  GET: 'view',
  POST: 'create',
  PUT: 'edit',
  PATCH: 'edit',
  DELETE: 'delete',
};

const apiModuleBySegment: Record<string, string> = {
  dashboard: 'dashboard',
  sales: 'sales',
  expenses: 'expenses',
  'ready-stock': 'ready_stock',
  fabric: 'fabric',
  accessories: 'accessories',
  cutting: 'cutting',
  'model-prod': 'model_prod',
  debts: 'debts',
  'client-accounts': 'client_accounts',
  returns: 'returns',
  'payment-log': 'payment_log',
  marketers: 'marketers',
  'fixed-assets': 'assets',
  'fabric-purchases': 'fabric_purchases',
  'print-orders': 'print_orders',
  reports: 'reports',
  'financial-center': 'financial_center',
  payroll: 'payroll',
  'audit-log': 'audit_log',
  'ai-assistant': 'ai_assistant',
  snapshots: 'snapshots',
  users: 'users',
};

export function permissionForRequest(method: string, path: string): string | null {
  const [, rawSegment, ...rest] = path.split('/');
  const segment = rawSegment || '';
  const module = apiModuleBySegment[segment];
  if (!module) return null;

  if (segment === 'sales' && rest[1]?.includes('reservation')) return 'sales.edit';
  if ((segment === 'debts' || segment === 'client-accounts') && rest.includes('payments')) {
    const action = actionByMethod[method] ?? 'view';
    return `${module}.${action}`;
  }
  if (segment === 'fabric-purchases' && rest[0] === 'rebuild') return 'fabric_purchases.edit';
  if (segment === 'snapshots' && rest[0] === 'profit') return 'snapshots.view';
  if (segment === 'ai-assistant' && method === 'POST') return 'ai_assistant.create';

  const action = actionByMethod[method] ?? 'view';
  return `${module}.${action}`;
}
