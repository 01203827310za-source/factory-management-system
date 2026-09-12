import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';
import { ensureInitialSeason } from '../services/seasonContext';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('seasons.view'), async (_req: Request, res: Response) => {
  try {
    await ensureInitialSeason();
    const seasons = await prisma.season.findMany({ orderBy: [{ year: 'desc' }, { id: 'desc' }] });
    return res.json(seasons);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في جلب المواسم' });
  }
});

router.get('/active', requirePermission('seasons.view'), async (_req: Request, res: Response) => {
  try {
    const season = await ensureInitialSeason();
    return res.json(season);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في جلب الموسم الحالي' });
  }
});

router.post('/', requirePermission('seasons.create'), async (req: Request, res: Response) => {
  try {
    const name = String(req.body.name || '').trim();
    const year = Number(req.body.year);
    const type = String(req.body.type || '').trim();
    const activate = Boolean(req.body.activate);

    if (!name || !Number.isInteger(year)) {
      return res.status(400).json({ message: 'اسم الموسم والسنة مطلوبان' });
    }

    const season = await prisma.$transaction(async (tx) => {
      if (activate) {
        await tx.season.updateMany({ where: { is_active: true }, data: { is_active: false, status: 'inactive' } });
      }
      return tx.season.create({
        data: {
          name,
          year,
          type,
          status: activate ? 'active' : 'inactive',
          is_active: activate,
        },
      });
    });

    logAudit({
      user: req.user,
      module: 'Seasons',
      action: 'CREATE',
      record_id: season.id,
      after_data: season,
      description: `Create season: ${season.name}. New season starts empty.`,
    });
    return res.status(201).json(season);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      return res.status(400).json({ message: 'الموسم موجود بالفعل' });
    }
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إنشاء الموسم' });
  }
});

router.put('/:id', requirePermission('seasons.edit'), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const before = await prisma.season.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ message: 'الموسم غير موجود' });

    const data = {
      ...(req.body.name !== undefined ? { name: String(req.body.name).trim() } : {}),
      ...(req.body.year !== undefined ? { year: Number(req.body.year) } : {}),
      ...(req.body.type !== undefined ? { type: String(req.body.type).trim() } : {}),
      ...(req.body.status !== undefined ? { status: String(req.body.status).trim() } : {}),
    };

    const season = await prisma.season.update({ where: { id }, data });
    logAudit({
      user: req.user,
      module: 'Seasons',
      action: 'UPDATE',
      record_id: id,
      before_data: before,
      after_data: season,
      description: `Edit season: ${season.name}`,
    });
    return res.json(season);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تعديل الموسم' });
  }
});

router.post('/:id/activate', requirePermission('seasons.activate'), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const before = await prisma.season.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ message: 'الموسم غير موجود' });

    const season = await prisma.$transaction(async (tx) => {
      await tx.season.updateMany({ where: { is_active: true }, data: { is_active: false, status: 'inactive' } });
      return tx.season.update({ where: { id }, data: { is_active: true, status: 'active' } });
    });

    logAudit({
      user: req.user,
      module: 'Seasons',
      action: 'UPDATE',
      record_id: id,
      before_data: before,
      after_data: season,
      description: `Activate season: ${season.name}`,
    });
    return res.json(season);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تفعيل الموسم' });
  }
});

export default router;
