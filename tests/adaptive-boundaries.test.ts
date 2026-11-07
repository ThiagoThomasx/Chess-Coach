import { describe, expect, it } from 'vitest';
import { DUE_FIRST_THRESHOLD, nextTraining, rankPatterns, recentGames, type AnalyzedGameInput } from '../src/services/recommendations/recommend';
import { MIN_THEME_SAMPLE, PRIORITY_FACTOR, stateOf, themePerformanceByKey, THEME_MASTERY_RATE } from '../src/services/recommendations/themeEvidence';
import { MASTERY_DISTINCT_EXERCISES } from '../src/services/adaptation/skills';
import { applyUci } from '../src/services/chess/position';
import { DAY_MS } from '../src/services/scheduling/srs';
import { gameTime, toAnalyzedInputs } from '../src/services/stats/stats';
import type { Attempt, Exercise, Game, GameAnalysis, MoveReview } from '../src/types/domain';
import { mkAttempt, mkExercise, type Kind } from './support/training';

// Sprint 4.1.1 audit: boundary cases of the adaptive recommendation and of game dates.

const hangFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const hanging: MoveReview = {
  ply: 5, san: 'Nd4', uci: 'f3d4', color: 'w', fenBefore: hangFen, fenAfter: applyUci(hangFen, 'f3d4')!, evalBefore: { kind: 'cp', value: 40 }, evalAfter: { kind: 'cp', value: -290 },
  bestLine: ['f1c4'], winBefore: 53, winAfter: 25, winLoss: 28, classification: 'blunder', flags: [], depth: 16,
};
const forkFen = '3qk3/8/8/8/3n4/8/2Q5/R3K3 w Q - 0 1';
const allowedFork: MoveReview = {
  ply: 31, san: 'Qh2', uci: 'c2h2', color: 'w', fenBefore: forkFen, fenAfter: applyUci(forkFen, 'c2h2')!, evalBefore: { kind: 'cp', value: 0 }, evalAfter: { kind: 'cp', value: -900 },
  bestLine: ['e1f1'], winBefore: 50, winAfter: 3, winLoss: 47, classification: 'blunder', flags: [], depth: 16,
};
const replies = { 5: ['e5d4', 'c2c3'], 31: ['d4f3', 'e1f1', 'f3h2', 'f1g2', 'h2g4', 'a1a7'] };
const game = (gameId: string, at: number | undefined, reviews: MoveReview[]): AnalyzedGameInput => ({ gameId, ...(at !== undefined ? { at } : {}), userColor: 'w', reviews, replyLines: replies });
const fork = { theme: 'fork' as const, motifSide: 'opponent' as const, skill: 'threats' as const };
const base = { dueReviews: 0, totalGames: 20, profile: [] };

function evidence(prefix: string, kinds: Kind[], over: Partial<Exercise> = {}, difficulties?: number[]): { exercises: Exercise[]; attempts: Attempt[] } {
  return {
    exercises: kinds.map((_, i) => mkExercise(`${prefix}${i}`, { ...over, ...(difficulties ? { difficulty: difficulties[i]! } : {}) })),
    attempts: kinds.map((k, i) => mkAttempt(`${prefix}${i}`, 1000 + i, k)),
  };
}
const stateFor = (ev: { exercises: Exercise[]; attempts: Attempt[] }, key = 'hanging_piece') => themePerformanceByKey(ev.exercises, ev.attempts).get(key)?.state;
const indep = (n: number): Kind[] => Array<Kind>(n).fill('independent');

describe('theme state boundaries', () => {
  it('2 versus 3 exercises: two are never enough to conclude, three are', () => {
    expect(MIN_THEME_SAMPLE).toBe(3);
    expect(stateFor(evidence('a', ['fail', 'fail']))).toBe('insufficient');
    expect(stateFor(evidence('a', indep(2)))).toBe('insufficient');
    expect(stateFor(evidence('a', ['fail', 'fail', 'fail']))).toBe('struggling');
    expect(stateFor(evidence('a', indep(3)))).toBe('developing');
  });

  it('4 versus 5 exercises: mastery needs the same distinct sample as the skill profile', () => {
    expect(MASTERY_DISTINCT_EXERCISES).toBe(5);
    expect(stateFor(evidence('a', indep(4)))).toBe('developing');
    expect(stateFor(evidence('a', indep(5)))).toBe('mastered');
  });

  it('79% versus 80% independent solves', () => {
    expect(THEME_MASTERY_RATE).toBe(0.8);
    // Pure rule at the exact boundary.
    expect(stateOf(100, 79, 2)).toBe('developing');
    expect(stateOf(100, 80, 2)).toBe('mastered');
    // Real evidence (window of 10): 8/10 reaches it, 7/10 does not.
    expect(stateFor(evidence('a', [...indep(8), 'fail', 'fail']))).toBe('mastered');
    expect(stateFor(evidence('a', [...indep(7), 'fail', 'fail', 'fail']))).toBe('developing');
  });

  it('fewer than 2 versus 2 independent solves at difficulty ≥ 2', () => {
    expect(stateFor(evidence('a', indep(5), {}, [1, 1, 1, 1, 2]))).toBe('developing');
    expect(stateFor(evidence('a', indep(5), {}, [1, 1, 1, 2, 2]))).toBe('mastered');
    // A harder exercise solved with hints does not count toward mastery.
    expect(stateFor(evidence('a', [...indep(4), 'assisted'], {}, [1, 1, 1, 2, 2]))).toBe('developing');
  });

  it('one more exercise moves the priority factor by at most ×1.5 or ×0.5, and only past the minimum sample', () => {
    const factors = Object.values(PRIORITY_FACTOR);
    expect(Math.max(...factors)).toBe(1.5);
    expect(Math.min(...factors)).toBe(0.5);
    for (let n = 0; n < MIN_THEME_SAMPLE - 1; n++) {
      for (const k of ['fail', 'independent'] as const) expect(PRIORITY_FACTOR[stateOf(n + 1, k === 'independent' ? n + 1 : 0, n + 1)]).toBe(1);
    }
  });
});

describe('recommendation boundaries', () => {
  const hangGames = [game('g1', 1, [hanging]), game('g2', 2, [hanging])];

  it('a mastered competence with old evidence stays mastered (exercise window, not time) but is not erased', () => {
    // Attempts at t ≈ 1 s since epoch: the window counts exercises, not age.
    const ev = evidence('a', indep(5));
    const rec = nextTraining({ ...base, games: hangGames, ...ev });
    expect(rec.performance?.state).toBe('mastered');
    expect(rec.kind).toBe('theme');
    expect(rec.message).toContain('o foco agora é reconhecê-lo durante a partida');
  });

  it('low sample: the competence keeps its game-based priority and the message says the sample is small', () => {
    const rec = nextTraining({ ...base, games: hangGames, ...evidence('a', ['fail']) });
    expect(rec.performance?.state).toBe('insufficient');
    expect(rec.message).toContain('Ainda são poucos exercícios');
  });

  it('weak competence with 4 due reviews: the competence leads, the reviews are mentioned', () => {
    const ev = evidence('a', ['fail', 'fail', 'fail']);
    const rec = nextTraining({ ...base, games: hangGames, ...ev, dueReviews: DUE_FIRST_THRESHOLD - 1 });
    expect(rec.kind).toBe('theme');
    expect(rec.message).toContain('Você tem 4 revisão(ões) vencida(s).');
  });

  it('weak competence with 5 due reviews: reviews first, then the weak competence as focus', () => {
    const ev = evidence('a', ['fail', 'fail', 'fail']);
    const rec = nextTraining({ ...base, games: hangGames, ...ev, dueReviews: DUE_FIRST_THRESHOLD });
    expect(rec.kind).toBe('reviews');
    expect(rec.focus).toMatchObject({ key: 'hanging_piece' });
  });

  it('mastered competence with a single due review: the review comes first, with no mastered focus', () => {
    const rec = nextTraining({ ...base, games: hangGames, ...evidence('a', indep(5)), dueReviews: 1 });
    expect(rec.kind).toBe('reviews');
    expect(rec.focus).toBeUndefined();
  });

  it('tied scores: more recent occurrences win, otherwise the order is by game date, not array order', () => {
    // fork: 2 × 1.5 (struggling) = 3; hanging: 3 × 1 = 3 → more occurrences first.
    const games = [game('f1', 1, [allowedFork]), game('f2', 2, [allowedFork]), game('h1', 3, [hanging]), game('h2', 4, [hanging]), game('h3', 5, [hanging])];
    const ev = evidence('f', ['fail', 'fail', 'fail'], fork);
    const ranked = rankPatterns(games, themePerformanceByKey(ev.exercises, ev.attempts));
    expect(ranked.map((p) => [p.key, p.score])).toEqual([['hanging_piece', 3], ['fork:opponent', 3]]);
    // Complete tie: the pattern seen first in chronological order, whatever the array order.
    const tie = [game('h1', 3, [hanging]), game('h2', 4, [hanging]), game('f1', 1, [allowedFork]), game('f2', 2, [allowedFork])];
    expect(nextTraining({ ...base, games: tie }).focus).toMatchObject({ key: 'fork:opponent' });
    expect(nextTraining({ ...base, games: [...tie].reverse() }).focus).toMatchObject({ key: 'fork:opponent' });
  });

  it('no analyzed games: no pattern is invented; due reviews or analysis are suggested', () => {
    expect(nextTraining({ ...base, games: [] })).toMatchObject({ kind: 'explore', title: 'Analise uma partida' });
    expect(nextTraining({ ...base, games: [], dueReviews: 2 }).kind).toBe('reviews');
  });
});

describe('game dates (audit: undated games must not count as recent)', () => {
  const IMPORTED = Date.UTC(2026, 9, 15);
  const g = (id: string, date: string | undefined, importedAt = IMPORTED): Game => ({
    id, hash: id, headers: { white: 'a', black: 'b', result: '*', ...(date !== undefined ? { date } : {}) }, rawHeaders: {}, startFen: '', moves: [], pgn: '', userColor: 'w', importId: 'i', importedAt, warnings: [],
  });

  it('a valid date inside the window is used as is; an old date is kept', () => {
    expect(gameTime(g('a', '2026.10.01'))).toBe(Date.UTC(2026, 9, 1));
    expect(gameTime(g('a', '1985.03.07'))).toBe(Date.UTC(1985, 2, 7));
  });

  it('missing, incomplete, invalid and future dates are "no reliable date", never a made-up one', () => {
    expect(gameTime(g('a', undefined))).toBeUndefined();
    expect(gameTime(g('a', '????.??.??'))).toBeUndefined();
    expect(gameTime(g('a', '2026.??.??'))).toBeUndefined();
    expect(gameTime(g('a', '2023.13.45'))).toBeUndefined();
    expect(gameTime(g('a', '2023.02.30'))).toBeUndefined();
    expect(gameTime(g('a', '0050.01.01'))).toBeUndefined();
    // Played after it was imported: impossible, so not trusted.
    expect(gameTime(g('a', '2099.01.01'))).toBeUndefined();
    // The import day itself (time zones) is fine.
    expect(gameTime(g('a', '2026.10.15'))).toBe(IMPORTED);
  });

  it('undated games count as older than every dated game and the message says how many are in the window', () => {
    const a = (gameId: string) => ({ gameId, status: 'complete', reviews: gameId.startsWith('u') ? [hanging] : [], positions: [], updatedAt: 0 }) as unknown as GameAnalysis;
    // Two undated games imported last must not push the dated ones out of a window of 2.
    const games = [g('d1', '2026.10.01', IMPORTED), g('d2', '2026.10.02', IMPORTED + 1), g('u1', '????.??.??', IMPORTED + 900), g('u2', '2023.13.45', IMPORTED + 901)];
    // The fake analyses have no positions, so the engine reply lines are supplied directly.
    const inputs = toAnalyzedInputs(games, games.map((x) => a(x.id))).map((x) => ({ ...x, replyLines: replies }));
    expect(inputs.find((x) => x.gameId === 'u1')?.at).toBeUndefined();
    expect(recentGames(inputs, 2).map((x) => x.gameId)).toEqual(['d1', 'd2']);
    // Inside the default window they still count, and the message is explicit about it.
    const rec = nextTraining({ ...base, games: inputs });
    expect(rec.theme).toBe('hanging_piece');
    expect(rec.message).toContain('2 delas sem data válida no PGN');
  });

  it('ordering: undated games among themselves follow import time, and always come before dated ones', () => {
    const x = (gameId: string, at: number | undefined, importedAt: number): AnalyzedGameInput => ({ ...game(gameId, at, []), importedAt });
    const games = [x('dated-old', 5, 1), x('undated-late', undefined, 300), x('undated-early', undefined, 200), x('dated-new', 9, 2)];
    expect(recentGames(games, 4).map((g) => g.gameId)).toEqual(['undated-early', 'undated-late', 'dated-old', 'dated-new']);
    expect(recentGames([...games].reverse(), 4).map((g) => g.gameId)).toEqual(['undated-early', 'undated-late', 'dated-old', 'dated-new']);
  });

  it('when every game has a reliable date nothing extra is said', () => {
    const rec = nextTraining({ ...base, games: [game('a', DAY_MS, [hanging]), game('b', 2 * DAY_MS, [hanging])] });
    expect(rec.message).not.toContain('sem data');
  });
});
