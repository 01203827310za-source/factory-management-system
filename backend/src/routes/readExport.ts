/**
 * Read-only data export (GET only).
 *
 * Disabled unless the env var READ_EXPORT_KEY is set (min 32 chars).
 * The key is sent as header `x-read-key` or query `?key=`.
 * It never writes to the database, and never returns the User table
 * or any role/permission tables.
 *
 *   GET /api/read-export                      -> tables list + row counts + seasons
 *   GET /api/read-export/:table?season_id=&limit=&offset=
 *        season_id: a season id, or omit for all seasons
 *        limit: 1..1000 (default 500), offset: default 0
 */
import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

const router = Router();

// Tables that must never be exported.
const BLOCKED = new Set(['User', 'Role', 'Permission', 'RolePermission', 'UserPermission']);

const models = Prisma.dmmf.datamodel.models.filter(m => !BLOCKED.has(m.name));
const byName = new Map(models.map(m => [m.name.toLowerCase(), m]));

const delegateFor = (modelName: string): any =>
  (prisma as any)[modelName.charAt(0).toLowerCase() + modelName.slice(1)];

const hasSeason = (m: (typeof models)[number]) => m.fields.some(f => f.name === 'season_id');

function requireReadKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.READ_EXPORT_KEY || '';
  if (expected.length < 32) return res.status(404).json({ message: 'Not found' });

  const given = String(req.header('x-read-key') || req.query.key || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ message: 'Invalid key' });
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
}

router.use(requireReadKey);

// Only GET is allowed on this router.
router.use((req, res, next) => (req.method === 'GET' ? next() : res.status(405).json({ message: 'Read only' })));

const send = (res: Response, data: unknown) =>
  res.type('application/json').send(
    JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );

router.get('/', async (_req, res, next) => {
  try {
    const counts = await Promise.all(
      models.map(async m => ({ table: m.name, rows: await delegateFor(m.name).count(), by_season: hasSeason(m) })),
    );
    const seasons = await prisma.season.findMany({ orderBy: { id: 'asc' } });
    send(res, { generated_at: new Date().toISOString(), seasons, tables: counts });
  } catch (err) {
    next(err);
  }
});

router.get('/:table', async (req, res, next) => {
  try {
    const model = byName.get(String(req.params.table).toLowerCase());
    if (!model) return res.status(404).json({ message: 'Unknown table', tables: models.map(m => m.name) });

    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const seasonId = Number(req.query.season_id);
    const where = hasSeason(model) && Number.isInteger(seasonId) && seasonId > 0 ? { season_id: seasonId } : {};
    const orderBy = model.fields.some(f => f.name === 'id') ? { id: 'asc' as const } : undefined;

    const d = delegateFor(model.name);
    const [total, rows] = await Promise.all([
      d.count({ where }),
      d.findMany({ where, orderBy, skip: offset, take: limit }),
    ]);
    send(res, { table: model.name, total, offset, limit, rows });
  } catch (err) {
    next(err);
  }
});

export default router;
