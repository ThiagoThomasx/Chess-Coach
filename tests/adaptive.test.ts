import { describe, expect, it } from 'vitest';
import { DUE_FIRST_THRESHOLD, nextTraining, rankPatterns, recentGames, RECENT_GAMES, type AnalyzedGameInput } from '../src/services/recommendations/recommend';
import { themePerformanceByKey, stateOf, MIN_THEME_SAMPLE } from '../src/services/recommendations/themeEvidence';
import { applyUci } from '../src/services/chess/position';
import type { Attempt, Exercise, MoveReview } from '../src/types/domain';
import { mkAttempt, mkExercise, type Kind } from './support/training';
import { isDueReview } from '../src/services/scheduling/srs';
import { toAnalyzedInputs } from '../src/services/stats/stats';
import type { Game, GameAnalysis } from '../src/types/domain';

// 3.Nd4?? leaves the knight hanging (pattern "hanging_piece").
const hangFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const hanging: MoveReview = {
  ply: 5, san: 'Nd4', uci: 'f3d4', color: 'w', fenBefore: hangFen, fenAfter: applyUci(hangFen, 'f3d4')!, evalBefore: { kind: 'cp', value: 40 }, evalAfter: { kind: 'cp', value: -290 },
  bestLine: ['f1c4'], winBefore: 53, winAfter: 25, winLoss: 28, classification: 'blunder', flags: [], depth: 16,
};
// 1.Qh2?? allows 1…Nf3+ (pattern "fork:opponent").
const forkFen = '3qk3/8/8/8/3n4/8/2Q5/R3K3 w Q - 0 1';
const allowedFork: MoveReview = {
  ply: 31, san: 'Qh2', uci: 'c2h2', color: 'w', fenBefore: forkFen, fenAfter: applyUci(forkFen, 'c2h2')!, evalBefore: { kind: 'cp', value: 0 }, evalAfter: { kind: 'cp', value: -900 },
  bestLine: ['e1f1'], winBefore: 50, winAfter: 3, winLoss: 47, classification: 'blunder', flags: [], depth: 16,
};
const replies = { 5: ['e5d4', 'c2c3'], 31: ['d4f3', 'e1f1', 'f3h2', 'f1g2', 'h2g4', 'a1a7'] };

const game = (gameId: string, at: number, reviews: MoveReview[]): AnalyzedGameInput => ({ gameId, at, userColor: 'w', reviews, replyLines: replies });
const clean = (gameId: string, at: number) => game(gameId, at, []);

/** n exercises of a pattern with the given latest outcomes. */
function themeExercises(prefix: string, kinds: Kind[], over: Partial<Exercise> = {}, start = 1000): { exercises: Exercise[]; attempts: Attempt[] } {
  const exercises = kinds.map((_, i) => mkExercise(`${prefix}${i}`, over));
  const attempts = kinds.map((k, i) => mkAttempt(`${prefix}${i}`, start + i, k));
  return { exercises, attempts };
}

const base = { dueReviews: 0, totalGames: 20, profile: [] };
const fork = { theme: 'fork' as const, motifSide: 'opponent' as const, skill: 'threats' as const };

describe('adaptive recommendation: exercise performance', () => {
  // Both patterns appear twice; with no exercise evidence the first-found (fork) leads.
  const games = [game('g1', 1, [allowedFork]), game('g2', 2, [allowedFork]), game('g3', 3, [hanging]), game('g4', 4, [hanging])];

  it('without exercise evidence, ties keep the order of the error patterns', () => {
    expect(nextTraining({ ...base, games }).focus).toMatchObject({ key: 'fork:opponent' });
  });

  it('a recurring pattern with poor recent exercise results moves up and cites real numbers', () => {
    const ev = themeExercises('h', ['fail', 'revealed', 'independent', 'fail']);
    const rec = nextTraining({ ...base, games, ...ev });
    expect(rec.kind).toBe('theme');
    expect(rec.theme).toBe('hanging_piece');
    expect(rec.performance?.state).toBe('struggling');
    expect(rec.message).toContain('você resolveu 1 de 4 sem ajuda');
    expect(rec.message).toContain('Contagem nas últimas 4 partida(s) analisada(s)');
  });

  it('a pattern mastered in exercises (enough sample, harder ones included) loses priority', () => {
    const ev = themeExercises('f', ['independent', 'independent', 'independent', 'independent', 'independent'], fork);
    const perf = themePerformanceByKey(ev.exercises, ev.attempts).get('fork:opponent');
    expect(perf?.state).toBe('mastered');
    const rec = nextTraining({ ...base, games, ...ev });
    expect(rec.theme).toBe('hanging_piece');
    // The mastered pattern is still listed, not erased.
    expect(rankPatterns(games, themePerformanceByKey(ev.exercises, ev.attempts)).map((p) => p.key)).toEqual(['hanging_piece', 'fork:opponent']);
  });

  it('mastery needs harder exercises: five independent difficulty-1 solves are not enough', () => {
    const ev = themeExercises('f', Array<Kind>(5).fill('independent'), { ...fork, difficulty: 1 });
    expect(themePerformanceByKey(ev.exercises, ev.attempts).get('fork:opponent')?.state).toBe('developing');
  });

  it('insufficient sample: below the minimum, neither failures nor successes change the priority', () => {
    const fails = themeExercises('f', ['fail', 'fail'], fork);
    const perf = themePerformanceByKey(fails.exercises, fails.attempts).get('fork:opponent');
    expect(perf?.state).toBe('insufficient');
    expect(MIN_THEME_SAMPLE).toBe(3);
    const rec = nextTraining({ ...base, games, ...fails });
    expect(rec.focus).toMatchObject({ key: 'fork:opponent' });
    expect(rec.message).toContain('Ainda são poucos exercícios');
    // Four independent solves: good, but no mastery claimed.
    expect(stateOf(4, 4, 4)).toBe('developing');
  });

  it('assisted solves are reported apart and do not count as independent', () => {
    const ev = themeExercises('h', ['assisted', 'assisted', 'assisted', 'independent']);
    const perf = themePerformanceByKey(ev.exercises, ev.attempts).get('hanging_piece');
    expect(perf).toMatchObject({ exercises: 4, independent: 1, assisted: 3, failed: 0, state: 'struggling' });
    expect(nextTraining({ ...base, games, ...ev }).message).toContain('1 de 4 sem ajuda, 3 com dicas');
  });

  it('repeating the same exercise is one piece of evidence (its latest outcome)', () => {
    const exercises = [mkExercise('h0')];
    const attempts = [1, 2, 3, 4, 5, 6].map((t) => mkAttempt('h0', t, 'independent'));
    const perf = themePerformanceByKey(exercises, attempts).get('hanging_piece');
    expect(perf).toMatchObject({ exercises: 1, independent: 1, state: 'insufficient' });
    // Latest outcome wins: an old success followed by a failure is a failure now.
    const later = themePerformanceByKey(exercises, [...attempts, mkAttempt('h0', 99, 'fail')]).get('hanging_piece');
    expect(later).toMatchObject({ independent: 0, failed: 1 });
  });

  it('consistent improvement: once recent exercises are solved, old failures leave the window', () => {
    const old = themeExercises('old', Array<Kind>(10).fill('fail'), {}, 1000);
    const recent = themeExercises('new', Array<Kind>(10).fill('independent'), {}, 5000);
    const exercises = [...old.exercises, ...recent.exercises];
    const attempts = [...old.attempts, ...recent.attempts];
    expect(themePerformanceByKey(old.exercises, old.attempts).get('hanging_piece')?.state).toBe('struggling');
    expect(themePerformanceByKey(exercises, attempts).get('hanging_piece')).toMatchObject({ exercises: 10, independent: 10, state: 'mastered' });
  });

  it('a pattern only failing in exercises is recommended when games show nothing recurring', () => {
    const ev = themeExercises('f', ['fail', 'assisted', 'fail'], fork);
    const rec = nextTraining({ ...base, games: [clean('g1', 1)], ...ev });
    expect(rec.kind).toBe('theme');
    expect(rec.title).toMatch(/do adversário/);
    expect(rec.message).toContain('0 de 3 sem ajuda, 1 com dicas');
  });
});

describe('adaptive recommendation: recent window and due reviews', () => {
  it('old history outside the recent window does not drive the recommendation, but is kept', () => {
    const old = [game('o1', 1, [hanging]), game('o2', 2, [hanging])];
    const recent = Array.from({ length: RECENT_GAMES }, (_, i) => clean(`r${i}`, 10 + i));
    const all = [...old, ...recent];
    expect(recentGames(all).map((g) => g.gameId)).not.toContain('o1');
    expect(nextTraining({ ...base, games: all }).kind).not.toBe('theme');
    // The same pattern inside the window is recommended.
    expect(nextTraining({ ...base, games: [...recent.slice(2), ...old.map((g, i) => ({ ...g, at: 100 + i }))] }).theme).toBe('hanging_piece');
  });

  it('games are ordered by date, not by array order', () => {
    const games = [game('late', 50, []), game('early', 1, [])];
    expect(recentGames(games, 1).map((g) => g.gameId)).toEqual(['late']);
  });

  it('due reviews above the threshold come before a recurring pattern', () => {
    const games = [game('g1', 1, [hanging]), game('g2', 2, [hanging])];
    const rec = nextTraining({ ...base, games, dueReviews: DUE_FIRST_THRESHOLD });
    expect(rec.kind).toBe('reviews');
    expect(rec.message).toContain(`${DUE_FIRST_THRESHOLD} exercício(s) para revisar`);
    expect(rec.message).toContain('Depois delas, o foco é');
    const few = nextTraining({ ...base, games, dueReviews: 2 });
    expect(few.kind).toBe('theme');
    expect(few.message).toContain('Você tem 2 revisão(ões) vencida(s).');
  });

  it('any due review beats a pattern already mastered in exercises', () => {
    const games = [game('g1', 1, [hanging]), game('g2', 2, [hanging])];
    const ev = themeExercises('h', Array<Kind>(5).fill('independent'));
    expect(nextTraining({ ...base, games, ...ev, dueReviews: 1 }).kind).toBe('reviews');
    expect(nextTraining({ ...base, games, ...ev, dueReviews: 0 }).message).toContain('o foco agora é reconhecê-lo durante a partida');
  });

  it('only attempted exercises count as due reviews; fresh ones are created due but are new (review finding)', () => {
    expect(isDueReview({ box: 0, dueAt: 5 }, 10)).toBe(false);
    expect(isDueReview({ box: 0, dueAt: 5, lastReviewedAt: 1 }, 10)).toBe(true);
    expect(isDueReview({ box: 0, dueAt: 50, lastReviewedAt: 1 }, 10)).toBe(false);
  });

  it('with many due reviews, the focus after them skips a pattern already mastered (review finding)', () => {
    // fork (mastered): 6 × 0.5 = 3 > hanging: 2 × 1, so the mastered pattern still ranks first.
    const forks = [1, 2, 3, 4, 5, 6].map((i) => game(`f${i}`, i, [allowedFork]));
    const many = [...forks, game('h1', 7, [hanging]), game('h2', 8, [hanging])];
    const ev = themeExercises('f', Array<Kind>(5).fill('independent'), fork);
    const ranked = rankPatterns(many, themePerformanceByKey(ev.exercises, ev.attempts));
    expect(ranked[0]?.key).toBe('fork:opponent');
    const rec = nextTraining({ ...base, games: many, ...ev, dueReviews: DUE_FIRST_THRESHOLD });
    expect(rec.kind).toBe('reviews');
    expect(rec.focus).toMatchObject({ key: 'hanging_piece' });
    expect(rec.message).toContain('Depois delas, o foco é: peça desprotegida');
  });

  it('exercises created before motifSide existed count for the player-side pattern (review finding)', () => {
    const legacy = themeExercises('l', ['fail', 'fail', 'fail'], { theme: 'fork', skill: 'tactics' });
    expect([...themePerformanceByKey(legacy.exercises, legacy.attempts).keys()]).toEqual(['fork:own']);
  });

  it('games of the same date are ordered by import time (review finding)', () => {
    const g = (id: string, importedAt: number): Game => ({ id, hash: id, headers: { white: 'a', black: 'b', result: '*', date: '2026.10.01' }, rawHeaders: {}, startFen: '', moves: [], pgn: '', userColor: 'w', importId: 'i', importedAt, warnings: [] });
    const a = (gameId: string) => ({ gameId, status: 'complete', reviews: [], positions: [], updatedAt: 0 }) as unknown as GameAnalysis;
    const inputs = toAnalyzedInputs([g('later', 200), g('earlier', 100)], [a('later'), a('earlier')]);
    expect(recentGames(inputs, 1).map((x) => x.gameId)).toEqual(['later']);
  });

  it('with no exercises at all the message says so instead of inventing numbers', () => {
    const games = [game('g1', 1, [hanging]), game('g2', 2, [hanging])];
    const rec = nextTraining({ ...base, games, exercises: [], attempts: [] });
    expect(rec.message).toContain('Ainda não há tentativas em exercícios deste tema.');
    expect(rec.message).not.toMatch(/\d+%/);
  });
});
