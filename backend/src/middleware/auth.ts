import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

export interface AuthPayload {
  userId: number;
  username: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// ===== Verify JWT =====
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'يجب تسجيل الدخول أولاً' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    // Check user still active
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'الحساب غير نشط أو غير موجود' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'جلسة منتهية، يرجى تسجيل الدخول مجدداً' });
  }
};

// ===== Role Guards =====
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'هذه العملية تتطلب صلاحية مدير النظام' });
  }
  next();
};

export const requireManager = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role === 'viewer') {
    return res.status(403).json({ message: 'ليس لديك صلاحية تعديل البيانات' });
  }
  next();
};
