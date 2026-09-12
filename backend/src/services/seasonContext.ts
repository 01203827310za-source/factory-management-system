import { Request } from 'express';
import prisma from '../lib/prisma';

export const INITIAL_SEASON = {
  name: 'Summer 2026',
  year: 2026,
  type: 'Summer',
};

export async function ensureInitialSeason() {
  const existing = await prisma.season.findFirst({ where: { is_active: true } });
  if (existing) return existing;

  const season = await prisma.season.upsert({
    where: { name_year: { name: INITIAL_SEASON.name, year: INITIAL_SEASON.year } },
    update: { status: 'active', is_active: true },
    create: { ...INITIAL_SEASON, status: 'active', is_active: true },
  });
  return season;
}

export async function getSeasonId(req: Request): Promise<number> {
  const raw = req.header('x-season-id') || (req.query.season_id as string | undefined);
  const id = raw ? Number(raw) : 0;
  if (Number.isInteger(id) && id > 0) {
    const season = await prisma.season.findUnique({ where: { id } });
    if (season) return season.id;
  }

  const active = await prisma.season.findFirst({ where: { is_active: true } });
  return (active ?? await ensureInitialSeason()).id;
}

export function seasonWhere(seasonId: number) {
  return { season_id: seasonId };
}

export function withSeason<T extends Record<string, unknown>>(data: T, seasonId: number): T & { season_id: number } {
  return { ...data, season_id: seasonId };
}
