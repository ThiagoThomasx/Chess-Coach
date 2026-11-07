import type { Attempt, Exercise, Game, GameAnalysis, MoveClass, OpeningAttempt, Theme } from '../../types/domain';
import { matchOpening } from '../openings/library';
import { errorThemes, type AnalyzedGameInput, type ErrorPattern } from '../recommendations/recommend';
import { replyLinesOf } from '../analysis/gameAnalyzer';
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

export function toAnalyzedInputs(games: readonly Game[], analyses: readonly GameAnalysis[]): AnalyzedGameInput[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  return analyses
    .filter((a) => a.status === 'complete' && byId.has(a.gameId))
    .map((a) => {
      const g = byId.get(a.gameId) as Game;
      const at = gameTime(g);
      return { gameId: a.gameId, ...(at !== undefined ? { at } : {}), importedAt: g.importedAt, ...(g.userColor ? { userColor: g.userColor } : {}), reviews: a.reviews, replyLines: replyLinesOf(a) };
    });
}

export interface AttemptStats {
  total: number;
  correct: number;
  independent: number;
  assisted: number;
  revealed: number;
  independentRate: number | null;
}

/** "Taxa de acerto independente" = attempts solved without hints or revealing ÷ all attempts. */
export function attemptStats(attempts: readonly Attempt[]): AttemptStats {
  const total = attempts.length;
  const independent = attempts.filter((a) => a.correct && a.hintsUsed === 0 && !a.revealed).length;
  const assisted = attempts.filter((a) => a.correct && a.hintsUsed > 0 && !a.revealed).length;
  return {
    total,
    correct: attempts.filter((a) => a.correct && !a.revealed).length,
    independent,
    assisted,
    revealed: attempts.filter((a) => a.revealed).length,
    independentRate: total ? independent / total : null,
  };
}

/** Local calendar day (YYYY-MM-DD), so a late-evening session is not attributed to the next UTC day. */
export const dayKey = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Attempts grouped by day: independent rate per day (only days with attempts). */
export function dailyPerformance(attempts: readonly Attempt[]): { day: string; attempts: number; independentRate: number; assistedRate: number }[] {
  const map = new Map<string, Attempt[]>();
  for (const a of attempts) map.set(dayKey(a.at), [...(map.get(dayKey(a.at)) ?? []), a]);
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => {
      const s = attemptStats(list);
      return { day, attempts: list.length, independentRate: Math.round((s.independent / list.length) * 100), assistedRate: Math.round((s.assisted / list.length) * 100) };
    });
}

export function analysesOverTime(analyses: readonly GameAnalysis[]): { day: string; count: number }[] {
  const map = new Map<string, number>();
  for (const a of analyses.filter((x) => x.status === 'complete')) map.set(dayKey(a.updatedAt), (map.get(dayKey(a.updatedAt)) ?? 0) + 1);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
}

/**
 * Distribution of move classes on the user's side across analyzed games.
 * Games without a user color are left out: their moves cannot be attributed.
 */
export function errorDistribution(inputs: readonly AnalyzedGameInput[]): Record<MoveClass, number> {
  const out: Record<MoveClass, number> = { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, inconclusive: 0, book: 0 };
  for (const g of inputs) {
    if (!g.userColor) continue;
    for (const r of g.reviews) if (r.color === g.userColor) out[r.classification]++;
  }
  return out;
}

/** Recurring verified error patterns (theme + side), most frequent first. */
export function themeCounts(inputs: readonly AnalyzedGameInput[]): (ErrorPattern & { count: number })[] {
  return [...errorThemes(inputs).values()].map((p) => ({ ...p, count: p.refs.length })).sort((a, b) => b.count - a.count);
}

/** Exercise success per theme (independent rate), for "temas com melhor desempenho". */
export function themePerformance(exercises: readonly Exercise[], attempts: readonly Attempt[]): { theme: Theme; attempts: number; independentRate: number }[] {
  const byEx = new Map(exercises.map((e) => [e.id, e]));
  const map = new Map<Theme, Attempt[]>();
  for (const a of attempts) {
    const ex = byEx.get(a.exerciseId);
    if (ex) map.set(ex.theme, [...(map.get(ex.theme) ?? []), a]);
  }
  return [...map.entries()].map(([theme, list]) => ({ theme, attempts: list.length, independentRate: attemptStats(list).independentRate ?? 0 })).sort((a, b) => b.independentRate - a.independentRate);
}

export function openingStudy(attempts: readonly OpeningAttempt[]): { openingId: string; attempts: number; correctRate: number }[] {
  const map = new Map<string, OpeningAttempt[]>();
  for (const a of attempts) map.set(a.openingId, [...(map.get(a.openingId) ?? []), a]);
  return [...map.entries()].map(([openingId, list]) => ({ openingId, attempts: list.length, correctRate: list.filter((a) => a.correct).length / list.length })).sort((a, b) => b.attempts - a.attempts);
}

/** Per-opening results in the user's own games (games where the user color is known). */
export function openingResults(games: readonly Game[]): { name: string; games: number; score: number }[] {
  const map = new Map<string, { games: number; points: number }>();
  for (const g of games) {
    if (!g.userColor || !['1-0', '0-1', '1/2-1/2'].includes(g.headers.result)) continue;
    const name = matchOpening(g.moves)?.opening.name ?? g.headers.opening ?? (g.headers.eco ? `ECO ${g.headers.eco}` : 'Não identificada');
    const pts = g.headers.result === '1/2-1/2' ? 0.5 : (g.headers.result === '1-0') === (g.userColor === 'w') ? 1 : 0;
    const cur = map.get(name) ?? { games: 0, points: 0 };
    map.set(name, { games: cur.games + 1, points: cur.points + pts });
  }
  return [...map.entries()].map(([name, v]) => ({ name, games: v.games, score: v.points / v.games })).sort((a, b) => b.games - a.games);
}
