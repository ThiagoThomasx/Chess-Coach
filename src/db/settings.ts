import type { Settings } from '../types/domain';
import { DEFAULT_THRESHOLDS } from '../services/analysis/classify';
import { DEFAULT_INTERVALS_DAYS } from '../services/scheduling/srs';
import { DEFAULT_TOLERANCE } from '../services/exercises/generate';
import { getDb } from './database';

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  analysisDepth: 16,
  quickDepth: 11,
  multiPv: 3,
  playerNames: [],
  boardOrientation: 'auto',
  appTheme: 'dark',
  boardTheme: 'slate',
  showCoordinates: true,
  animationMs: 180,
  thresholds: DEFAULT_THRESHOLDS,
  exerciseTolerance: DEFAULT_TOLERANCE,
  maxExercisesPerGame: 4,
  srsIntervalsDays: DEFAULT_INTERVALS_DAYS,
  dailyGoal: 10,
};

/** Merges stored settings over defaults so new fields get sane values after upgrades. */
export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    id: 'app',
    thresholds: { ...DEFAULT_THRESHOLDS, ...(raw?.thresholds ?? {}) },
    srsIntervalsDays: raw?.srsIntervalsDays?.length ? raw.srsIntervalsDays : DEFAULT_INTERVALS_DAYS,
  };
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await getDb().settings.get('app'));
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await getDb().settings.put(next);
  return next;
}
