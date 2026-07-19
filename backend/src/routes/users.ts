import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { getEffectivePermissionKeys, syncDefaultRbac } from '../services/rbacService';
import { ACTIONS, PERMISSION_MODULES } from '../config/rbac';
import { logAudit } from '../services/auditHelper';

const router = Router();
router.use(authenticate);

type UserPermissionInput = {
  permissions?: string[];
};

async function roleForName(name: string | undefined) {
  return prisma.role.findUnique({ where: { name: name || 'viewer' } });
}

async function applyUserPermissions(userId: number, permissionKeys?: string[]) {
  if (!permissionKeys) return;
  const selected = new Set(permissionKeys);
  const allPermissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  await prisma.userPermission.deleteMany({ where: { user_id: userId } });
  if (!allPermissions.length) return;
  await prisma.userPermission.createMany({
    data: allPermissions.map(permission => ({
      user_id: userId,
      permission_id: permission.id,
      allowed: selected.has(permission.key),
    })),
    skipDuplicates: true,
  });
}

async function userResponse(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      full_name: true,
      role: true,
      role_id: true,
      is_active: true,
      last_login: true,
      created_at: true,
    },
  });
  if (!user) return null;
  return { ...user, permissions: await getEffectivePermissionKeys(user.id) };
}

// GET /api/users/rbac
router.get('/rbac', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await syncDefaultRbac();
    const [roles, permissions] = await Promise.all([
      prisma.role.findMany({
        orderBy: { id: 'asc' },
        include: { role_permissions: { include: { permission: true } } },
      }),
      prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] }),
    ]);
    return res.json({
      roles: roles.map(role => ({
        id: role.id,
        name: role.name,
        display_name: role.display_name,
        description: role.description,
        is_system: role.is_system,
        permissions: role.role_permissions.map(rp => rp.permission.key),
      })),
      permissions,
      modules: PERMISSION_MODULES,
      actions: ACTIONS,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في جلب الصلاحيات' });
  }
});

// GET /api/users
router.get('/', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await syncDefaultRbac();
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        full_name: true,
        role: true,
        role_id: true,
        is_active: true,
        last_login: true,
        created_at: true,
      },
      orderBy: { id: 'asc' },
    });
    const enriched = await Promise.all(users.map(async user => ({
      ...user,
      permissions: await getEffectivePermissionKeys(user.id),
    })));
    return res.json(enriched);
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب المستخدمين' });
  }
});

// POST /api/users
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { username, password, full_name, role, permissions } = req.body as {
      username?: string;
      password?: string;
      full_name?: string;
      role?: string;
    } & UserPermissionInput;

    if (!username || !password || !full_name) {
      return res.status(400).json({ message: 'يرجى إدخال جميع البيانات المطلوبة' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ message: 'اسم المستخدم موجود بالفعل' });

    const targetRole = await roleForName(role);
    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        username,
        password: hashed,
        full_name,
        role: targetRole?.name || role || 'viewer',
        role_id: targetRole?.id,
      },
    });
    await applyUserPermissions(user.id, permissions);

    const response = await userResponse(user.id);
    logAudit({
      user: req.user,
      module: 'Users',
      action: 'CREATE',
      record_id: user.id,
      after_data: response,
      description: `Create user: ${user.username}`,
    });
    return res.status(201).json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إنشاء المستخدم' });
  }
});

// PUT /api/users/:id
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const before = await userResponse(id);
    const { full_name, role, is_active, password, permissions } = req.body as {
      full_name?: string;
      role?: string;
      is_active?: boolean;
      password?: string;
    } & UserPermissionInput;

    if (req.user!.userId === id && is_active === false) {
      return res.status(400).json({ message: 'لا يمكنك تعطيل حسابك الخاص' });
    }

    const updateData: {
      full_name?: string;
      role?: string;
      role_id?: number | null;
      is_active?: boolean;
      password?: string;
    } = {};

    if (full_name !== undefined) updateData.full_name = full_name;
    if (role !== undefined) {
      const targetRole = await roleForName(role);
      updateData.role = targetRole?.name || role;
      updateData.role_id = targetRole?.id ?? null;
    }
    if (is_active !== undefined) updateData.is_active = is_active;
    if (password) {
      if (password.length < 6) return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
      updateData.password = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.update({ where: { id }, data: updateData });
    await applyUserPermissions(id, permissions);

    const response = await userResponse(user.id);
    logAudit({
      user: req.user,
      module: 'Users',
      action: 'UPDATE',
      record_id: id,
      before_data: before,
      after_data: response,
      description: `Update user: ${user.username}`,
    });
    return res.json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تحديث المستخدم' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (req.user!.userId === id) {
      return res.status(400).json({ message: 'لا يمكنك حذف حسابك الخاص' });
    }
    const before = await userResponse(id);
    await prisma.user.delete({ where: { id } });
    logAudit({
      user: req.user,
      module: 'Users',
      action: 'DELETE',
      record_id: id,
      before_data: before,
      description: `Delete user: ${before?.username ?? id}`,
    });
    return res.json({ message: 'تم حذف المستخدم بنجاح' });
  } catch {
    return res.status(500).json({ message: 'خطأ في حذف المستخدم' });
  }
});

export default router;
