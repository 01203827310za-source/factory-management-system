// ============================================
// Audit Log Routes — Read Only
// /api/audit-log
// ============================================

import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { from_date, to_date, user_name, module, action, page = '1', limit = '100' } = req.query;

    const where: Record<string, unknown> = {};

    if (from_date || to_date) {
      where.timestamp = {
        ...(from_date ? { gte: new Date(`${from_date as string}T00:00:00`) } : {}),
        ...(to_date   ? { lte: new Date(`${to_date   as string}T23:59:59`) } : {}),
      };
    }
    if (user_name) where.user_name = { contains: user_name as string, mode: 'insensitive' };
    if (module)    where.module    = module as string;
    if (action)    where.action    = action as string;

    const skip  = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take  = parseInt(limit as string);
    const total = await prisma.auditLog.count({ where });
    const logs  = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip,
      take,
    });

    return res.json({ total, page: parseInt(page as string), limit: take, logs });
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب سجل التعديلات' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const log = await prisma.auditLog.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!log) return res.status(404).json({ message: 'السجل غير موجود' });
    return res.json(log);
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب التفاصيل' });
  }
});

export default router;
