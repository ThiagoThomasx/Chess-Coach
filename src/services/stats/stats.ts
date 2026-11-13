import type { Attempt, Exercise, Game, GameAnalysis, MoveClass, OpeningAttempt, SkillEvent, Theme } from '../../types/domain';
import { matchOpening } from '../openings/library';
import { errorThemes, recentGames, type AnalyzedGameInput, type ErrorPattern } from '../recommendations/recommend';
import { replyLinesOf } from '../analysis/gameAnalyzer';
import { gameTime, isUtcCalendarDate } from '../games/gameDate';

export { gameTime };

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

/**
 * Calendar day of a skill event. Game evidence dated by the PGN carries the
 * game's calendar date, stored as 00:00 UTC: read in UTC, or west of Greenwich
 * (Brazil) it would show the day before (Sprint 4.5, P3-1). Game evidence dated
 * by the import time (no PGN date) and all other evidence happened at a real
 * instant and use the local day (audit FA-3, Sprint 4.6).
 */
export function evidenceDayKey(e: Pick<SkillEvent, 'at' | 'source'>): string {
  if (e.source !== 'game' || !isUtcCalendarDate(e.at)) return dayKey(e.at);
  const d = new Date(e.at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Month and year (MM/YYYY): in UTC for a PGN calendar date, on the local calendar for a real instant (audit FA-3). */
export function calendarMonthYear(t: number): string {
  return new Date(t).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric', ...(isUtcCalendarDate(t) ? { timeZone: 'UTC' } : {}) });
}

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

/** Below this many games with the user color, no comparison is shown (Sprint 4.6, B3). */
export const TREND_MIN_GAMES = 6;
/** Games per window once there are at least 2 × TREND_WINDOW. */
export const TREND_WINDOW = 10;
/** Smallest change in serious errors per game called an improvement or a decline. */
export const TREND_THRESHOLD = 0.3;

export type SeriousErrorTrend =
  | { kind: 'insufficient'; games: number }
  | {
      kind: 'compared';
      /** Games in each window. */
      window: number;
      recentGames: number;
      previousGames: number;
      /** Mean serious errors (user mistakes + blunders) per game in each window. */
      recent: number;
      previous: number;
      /** recent − previous, rounded to 3 decimals: negative means fewer errors. */
      difference: number;
      direction: 'better' | 'worse' | 'stable';
      /**
       * One error more or less in a window already moves its mean by at least the threshold
       * (1 / window ≥ TREND_THRESHOLD, i.e. 3 games per window): the direction rests on a single
       * error, so it must not be presented as an improvement or a decline (review M1).
       */
      singleErrorDecides: boolean;
      /**
       * Compared games without a reliable PGN date. They are placed as the oldest; if they are in
       * fact recent, the direction may be inverted, so it is shown as uncertain (audit AC-5).
       */
      undatedGames: number;
    };

const seriousErrors = (g: AnalyzedGameInput): number => g.reviews.filter((r) => r.color === g.userColor && (r.classification === 'mistake' || r.classification === 'blunder')).length;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * "Minhas partidas estão melhorando?" (Sprint 4.6, B3; docs/METHODOLOGY.md): serious errors
 * per game (the user's own moves classified mistake or blunder) in the most recent games
 * against the games right before them. Only analysed games with the user color count. Games
 * are ordered by game date with undated games first, as in `recentGames` (the import time only
 * breaks ties). Window: 10 games from 20 games on, otherwise half the total rounded down (the
 * oldest game is left out when the total is odd); fewer than 6 games give no comparison.
 */
export function seriousErrorTrend(inputs: readonly AnalyzedGameInput[]): SeriousErrorTrend {
  const valid = inputs.filter((g) => g.userColor);
  if (valid.length < TREND_MIN_GAMES) return { kind: 'insufficient', games: valid.length };
  const ordered = recentGames(valid, valid.length);
  const window = valid.length >= 2 * TREND_WINDOW ? TREND_WINDOW : Math.floor(valid.length / 2);
  const recentSet = ordered.slice(-window);
  const previousSet = ordered.slice(-2 * window, -window);
  const mean = (list: readonly AnalyzedGameInput[]) => round3(list.reduce((s, g) => s + seriousErrors(g), 0) / list.length);
  const recent = mean(recentSet);
  const previous = mean(previousSet);
  const difference = round3(recent - previous);
  const direction = Math.abs(difference) < TREND_THRESHOLD ? 'stable' : difference < 0 ? 'better' : 'worse';
  const undatedGames = [...previousSet, ...recentSet].filter((g) => g.at === undefined).length;
  return { kind: 'compared', window, recentGames: recentSet.length, previousGames: previousSet.length, recent, previous, difference, direction, singleErrorDecides: 1 / window >= TREND_THRESHOLD, undatedGames };
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
