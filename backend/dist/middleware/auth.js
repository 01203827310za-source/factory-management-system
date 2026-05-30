"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireManager = exports.requireAdmin = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../lib/prisma"));
// ===== Verify JWT =====
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'يجب تسجيل الدخول أولاً' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        // Check user still active
        const user = await prisma_1.default.user.findUnique({ where: { id: decoded.userId } });
        if (!user || !user.is_active) {
            return res.status(401).json({ message: 'الحساب غير نشط أو غير موجود' });
        }
        req.user = decoded;
        next();
    }
    catch {
        return res.status(401).json({ message: 'جلسة منتهية، يرجى تسجيل الدخول مجدداً' });
    }
};
exports.authenticate = authenticate;
// ===== Role Guards =====
const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'هذه العملية تتطلب صلاحية مدير النظام' });
    }
    next();
};
exports.requireAdmin = requireAdmin;
const requireManager = (req, res, next) => {
    if (req.user?.role === 'viewer') {
        return res.status(403).json({ message: 'ليس لديك صلاحية تعديل البيانات' });
    }
    next();
};
exports.requireManager = requireManager;
//# sourceMappingURL=auth.js.map