"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const rbacService_1 = require("../services/rbacService");
const rbac_1 = require("../config/rbac");
const auditHelper_1 = require("../services/auditHelper");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
const ADMIN_ROLE_NAME = 'admin';
async function roleForName(name) {
    return prisma_1.default.role.findUnique({ where: { name: name || 'viewer' } });
}
async function applyUserPermissions(userId, permissionKeys) {
    if (!permissionKeys)
        return;
    const user = await prisma_1.default.user.findUnique({
        where: { id: userId },
        select: { role: true, role_ref: { select: { name: true } } },
    });
    if (user?.role === ADMIN_ROLE_NAME || user?.role_ref?.name === ADMIN_ROLE_NAME) {
        await prisma_1.default.userPermission.deleteMany({ where: { user_id: userId } });
        return;
    }
    const selected = new Set(permissionKeys);
    const allPermissions = await prisma_1.default.permission.findMany({ select: { id: true, key: true } });
    await prisma_1.default.userPermission.deleteMany({ where: { user_id: userId } });
    if (!allPermissions.length)
        return;
    await prisma_1.default.userPermission.createMany({
        data: allPermissions.map(permission => ({
            user_id: userId,
            permission_id: permission.id,
            allowed: selected.has(permission.key),
        })),
        skipDuplicates: true,
    });
}
async function userResponse(userId) {
    const user = await prisma_1.default.user.findUnique({
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
    if (!user)
        return null;
    return { ...user, permissions: await (0, rbacService_1.getEffectivePermissionKeys)(user.id) };
}
// GET /api/users/rbac
router.get('/rbac', auth_1.requireAdmin, async (_req, res) => {
    try {
        await (0, rbacService_1.syncDefaultRbac)();
        const [roles, permissions] = await Promise.all([
            prisma_1.default.role.findMany({
                orderBy: { id: 'asc' },
                include: { role_permissions: { include: { permission: true } } },
            }),
            prisma_1.default.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] }),
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
            modules: rbac_1.PERMISSION_MODULES,
            actions: rbac_1.ACTIONS,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في جلب الصلاحيات' });
    }
});
// GET /api/users
router.get('/', auth_1.requireAdmin, async (_req, res) => {
    try {
        await (0, rbacService_1.syncDefaultRbac)();
        const users = await prisma_1.default.user.findMany({
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
        const enriched = await Promise.all(users.map(async (user) => ({
            ...user,
            permissions: await (0, rbacService_1.getEffectivePermissionKeys)(user.id),
        })));
        return res.json(enriched);
    }
    catch {
        return res.status(500).json({ message: 'خطأ في جلب المستخدمين' });
    }
});
// POST /api/users
router.post('/', auth_1.requireAdmin, async (req, res) => {
    try {
        const { username, password, full_name, role, permissions } = req.body;
        if (!username || !password || !full_name) {
            return res.status(400).json({ message: 'يرجى إدخال جميع البيانات المطلوبة' });
        }
        if (password.length < 6) {
            return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }
        const existing = await prisma_1.default.user.findUnique({ where: { username } });
        if (existing)
            return res.status(400).json({ message: 'اسم المستخدم موجود بالفعل' });
        const targetRole = await roleForName(role);
        const hashed = await bcryptjs_1.default.hash(password, 12);
        const user = await prisma_1.default.user.create({
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
        (0, auditHelper_1.logAudit)({
            user: req.user,
            module: 'Users',
            action: 'CREATE',
            record_id: user.id,
            after_data: response,
            description: `Create user: ${user.username}`,
        });
        return res.status(201).json(response);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في إنشاء المستخدم' });
    }
});
// PUT /api/users/:id
router.put('/:id', auth_1.requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const before = await userResponse(id);
        const { full_name, role, is_active, password, permissions } = req.body;
        if (req.user.userId === id && is_active === false) {
            return res.status(400).json({ message: 'لا يمكنك تعطيل حسابك الخاص' });
        }
        const updateData = {};
        if (full_name !== undefined)
            updateData.full_name = full_name;
        if (role !== undefined) {
            const targetRole = await roleForName(role);
            updateData.role = targetRole?.name || role;
            updateData.role_id = targetRole?.id ?? null;
        }
        if (is_active !== undefined)
            updateData.is_active = is_active;
        if (password) {
            if (password.length < 6)
                return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
            updateData.password = await bcryptjs_1.default.hash(password, 12);
        }
        const user = await prisma_1.default.user.update({ where: { id }, data: updateData });
        await applyUserPermissions(id, permissions);
        const response = await userResponse(user.id);
        (0, auditHelper_1.logAudit)({
            user: req.user,
            module: 'Users',
            action: 'UPDATE',
            record_id: id,
            before_data: before,
            after_data: response,
            description: `Update user: ${user.username}`,
        });
        return res.json(response);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في تحديث المستخدم' });
    }
});
// DELETE /api/users/:id
router.delete('/:id', auth_1.requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (req.user.userId === id) {
            return res.status(400).json({ message: 'لا يمكنك حذف حسابك الخاص' });
        }
        const before = await userResponse(id);
        await prisma_1.default.user.delete({ where: { id } });
        (0, auditHelper_1.logAudit)({
            user: req.user,
            module: 'Users',
            action: 'DELETE',
            record_id: id,
            before_data: before,
            description: `Delete user: ${before?.username ?? id}`,
        });
        return res.json({ message: 'تم حذف المستخدم بنجاح' });
    }
    catch {
        return res.status(500).json({ message: 'خطأ في حذف المستخدم' });
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map