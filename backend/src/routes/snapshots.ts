import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { computeSnapshot } from '../services/snapshotHelper';

const router = Router();
router.use(authenticate);

// POST /api/snapshots/take  — create or refresh today's snapshot
router.post('/take', async (_req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const data  = await computeSnapshot();

    const snapshot = await prisma.financialSnapshot.upsert({
      where:  { snapshot_date: today },
      update: data,
      create: { snapshot_date: today, ...data },
    });

    return res.json(snapshot);
  } catch (err) {
    console.error('Snapshot take error:', err);
    return res.status(500).json({ message: 'خطأ في إنشاء اللقطة المالية' });
  }
});

// GET /api/snapshots  — all snapshots ordered by date (for the line chart)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const snapshots = await prisma.financialSnapshot.findMany({
      orderBy: { snapshot_date: 'asc' },
    });
    return res.json(snapshots);
  } catch (err) {
    console.error('Snapshot list error:', err);
    return res.status(500).json({ message: 'خطأ في جلب اللقطات' });
  }
});

// GET /api/snapshots/profit?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
router.get('/profit', async (req: Request, res: Response) => {
  try {
    const { from_date, to_date } = req.query as { from_date?: string; to_date?: string };

    if (!from_date || !to_date) {
      return res.status(400).json({ message: 'from_date و to_date مطلوبان' });
    }

    const today = new Date().toISOString().slice(0, 10);

    // Starting assets: nearest snapshot at or before from_date
    const startSnap = await prisma.financialSnapshot.findFirst({
      where:   { snapshot_date: { lte: from_date } },
      orderBy: { snapshot_date: 'desc' },
    });

    // Ending assets: live if to_date is today-or-future, else nearest snapshot
    let endAssets:  number;
    let endDate:    string;
    let hasEndData: boolean;

    if (to_date >= today) {
      // Always compute live so the value is up-to-the-second
      const live = await computeSnapshot();
      endAssets  = live.total_current_assets;
      endDate    = today;
      hasEndData = true;
    } else {
      const endSnap = await prisma.financialSnapshot.findFirst({
        where:   { snapshot_date: { lte: to_date } },
        orderBy: { snapshot_date: 'desc' },
      });
      endAssets  = endSnap?.total_current_assets ?? 0;
      endDate    = endSnap?.snapshot_date        ?? to_date;
      hasEndData = endSnap !== null;
    }

    const startAssets   = startSnap?.total_current_assets ?? 0;
    const startDate     = startSnap?.snapshot_date        ?? from_date;
    const hasStartData  = startSnap !== null;

    const profit        = endAssets - startAssets;
    const growthPercent = (hasStartData && startAssets !== 0)
      ? (profit / Math.abs(startAssets)) * 100
      : null;

    return res.json({
      from_date,
      to_date,
      start_date:    startDate,
      end_date:      endDate,
      start_assets:  startAssets,
      end_assets:    endAssets,
      profit,
      growth_percent: growthPercent,
      has_start_data: hasStartData,
      has_end_data:   hasEndData,
    });
  } catch (err) {
    console.error('Profit calc error:', err);
    return res.status(500).json({ message: 'خطأ في حساب الربح' });
  }
});

export default router;
