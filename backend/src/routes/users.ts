import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /api/users
router.get('/', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, full_name: true, role: true, is_active: true, last_login: true, created_at: true },
      orderBy: { id: 'asc' },
    });
    return res.json(users);
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب المستخدمين' });
  }
});

// POST /api/users
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { username, password, full_name, role } = req.body;
    if (!username || !password || !full_name) {
      return res.status(400).json({ message: 'يرجى إدخال جميع البيانات المطلوبة' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ message: 'اسم المستخدم موجود بالفعل' });

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, password: hashed, full_name, role: role || 'viewer' },
      select: { id: true, username: true, full_name: true, role: true, is_active: true, created_at: true },
    });
    return res.status(201).json(user);
  } catch {
    return res.status(500).json({ message: 'خطأ في إنشاء المستخدم' });
  }
});

// PUT /api/users/:id
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { full_name, role, is_active, password } = req.body;

    // Prevent disabling your own admin account
    if (req.user!.userId === id && is_active === false) {
      return res.status(400).json({ message: 'لا يمكنك تعطيل حسابك الخاص' });
    }

    const updateData: Record<string, unknown> = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (role !== undefined) updateData.role = role;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (password) {
      if (password.length < 6) return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
      updateData.password = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, username: true, full_name: true, role: true, is_active: true, created_at: true },
    });
    return res.json(user);
  } catch {
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
    await prisma.user.delete({ where: { id } });
    return res.json({ message: 'تم حذف المستخدم بنجاح' });
  } catch {
    return res.status(500).json({ message: 'خطأ في حذف المستخدم' });
  }
});

export default router;
