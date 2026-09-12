import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { seasonsApi, type SeasonRecord } from '../services/api';

type SeasonContextValue = {
  currentSeason: SeasonRecord | null;
  currentSeasonId: number | null;
  seasons: SeasonRecord[];
  isLoading: boolean;
  switchSeason: (seasonId: number) => void;
  createSeason: (data: { name: string; year: number; type?: string; activate?: boolean }) => Promise<SeasonRecord>;
  activateSeason: (seasonId: number) => Promise<SeasonRecord>;
  refreshSeasons: () => Promise<void>;
};

const SeasonContext = createContext<SeasonContextValue | null>(null);

export function SeasonProvider({ children }: { children: React.ReactNode }) {
  const [seasons, setSeasons] = useState<SeasonRecord[]>([]);
  const [currentSeasonId, setCurrentSeasonId] = useState<number | null>(() => {
    const stored = localStorage.getItem('current_season_id');
    return stored ? Number(stored) : null;
  });
  const [isLoading, setIsLoading] = useState(true);

  const refreshSeasons = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await seasonsApi.getAll();
      setSeasons(list);
      const storedId = Number(localStorage.getItem('current_season_id') || 0);
      const stored = list.find(s => s.id === storedId);
      const active = list.find(s => s.is_active) ?? list[0] ?? null;
      const next = stored ?? active;
      if (next) {
        localStorage.setItem('current_season_id', String(next.id));
        setCurrentSeasonId(next.id);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('auth_token')) {
      setIsLoading(false);
      return;
    }
    refreshSeasons().catch(() => setIsLoading(false));
  }, [refreshSeasons]);

  const switchSeason = useCallback((seasonId: number) => {
    localStorage.setItem('current_season_id', String(seasonId));
    setCurrentSeasonId(seasonId);
  }, []);

  const createSeason = useCallback(async (data: { name: string; year: number; type?: string; activate?: boolean }) => {
    const season = await seasonsApi.create(data);
    await refreshSeasons();
    if (data.activate) switchSeason(season.id);
    return season;
  }, [refreshSeasons, switchSeason]);

  const activateSeason = useCallback(async (seasonId: number) => {
    const season = await seasonsApi.activate(seasonId);
    await refreshSeasons();
    switchSeason(season.id);
    return season;
  }, [refreshSeasons, switchSeason]);

  const currentSeason = seasons.find(s => s.id === currentSeasonId) ?? null;

  const value = useMemo(() => ({
    currentSeason,
    currentSeasonId,
    seasons,
    isLoading,
    switchSeason,
    createSeason,
    activateSeason,
    refreshSeasons,
  }), [activateSeason, createSeason, currentSeason, currentSeasonId, isLoading, refreshSeasons, seasons, switchSeason]);

  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>;
}

export function useSeason() {
  const ctx = useContext(SeasonContext);
  if (!ctx) throw new Error('useSeason must be used inside SeasonProvider');
  return ctx;
}
