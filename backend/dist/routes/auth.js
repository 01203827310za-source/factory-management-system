"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const rbacService_1 = require("../services/rbacService");
const router = (0, express_1.Router)();
// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
        }
        const user = await prisma_1.default.user.findUnique({ where: { username: username.trim() } });
        if (!user || !user.is_active) {
            return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        const isValid = await bcryptjs_1.default.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        // Update last login
        await prisma_1.default.user.update({
            where: { id: user.id },
            data: { last_login: new Date() },
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
        const permissions = await (0, rbacService_1.getEffectivePermissionKeys)(user.id);
        return res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role,
                permissions,
            },
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'خطأ في الخادم' });
    }
});
// GET /api/auth/me
router.get('/me', auth_1.authenticate, async (req, res) => {
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: req.user.userId },
            select: { id: true, username: true, full_name: true, role: true, last_login: true },
        });
        if (!user)
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        return res.json({ ...user, permissions: await (0, rbacService_1.getEffectivePermissionKeys)(user.id) });
    }
    catch (err) {
        return res.status(500).json({ message: 'خطأ في الخادم' });
    }
});
// POST /api/auth/change-password
router.post('/change-password', auth_1.authenticate, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ message: 'يرجى إدخال كلمة المرور الحالية والجديدة' });
        }
        if (new_password.length < 6) {
            return res.status(400).json({ message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
        }
        const user = await prisma_1.default.user.findUnique({ where: { id: req.user.userId } });
        if (!user)
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        const isValid = await bcryptjs_1.default.compare(current_password, user.password);
        if (!isValid)
            return res.status(401).json({ message: 'كلمة المرور الحالية غير صحيحة' });
        const hashed = await bcryptjs_1.default.hash(new_password, 12);
        await prisma_1.default.user.update({ where: { id: user.id }, data: { password: hashed } });
        return res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
    }
    catch (err) {
        return res.status(500).json({ message: 'خطأ في الخادم' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map