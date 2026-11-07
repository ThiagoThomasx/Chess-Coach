import type { Game } from '../../types/domain';
import { DAY_MS } from '../scheduling/srs';

/** Earliest year accepted as a real game date (rejects "0050" and similar placeholders). */
const MIN_GAME_YEAR = 1400;

/**
 * Chronological key of a game: its PGN date (YYYY.MM.DD) when it is a real
 * calendar date not later than the import day; otherwise undefined ("no
 * reliable date"). No date is ever invented from the import time.
 */
export function gameTime(g: Pick<Game, 'headers' | 'importedAt'>): number | undefined {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(g.headers.date ?? '');
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_GAME_YEAR) return undefined;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Date.UTC rolls 2023.13.45 or 2023.02.30 over into another day: not a real date.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return undefined;
  // A game cannot be played after it was imported (one day of slack for time zones).
  if (g.importedAt > 0 && t > g.importedAt + DAY_MS) return undefined;
  return t;
}

/**
 * When the moves of a game happened, for dating its skill evidence (decay,
 * trend, "needs review"): the PGN date; without a reliable one, the import
 * time (the game was played at the latest then). `fallback` covers records
 * without an import time. Never the analysis time: re-analysing an old game
 * must not make its mistakes recent.
 */
export function gameEvidenceTime(g: Pick<Game, 'headers' | 'importedAt'>, fallback: number): number {
  return gameTime(g) ?? (g.importedAt > 0 ? g.importedAt : fallback);
}
