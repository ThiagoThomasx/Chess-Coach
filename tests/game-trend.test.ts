import { describe, expect, it } from 'vitest';
import { seriousErrorTrend, TREND_MIN_GAMES, TREND_THRESHOLD, TREND_WINDOW } from '../src/services/stats/stats';
import type { AnalyzedGameInput } from '../src/services/recommendations/recommend';
import type { MoveClass, MoveReview } from '../src/types/domain';

// Sprint 4.6, B3: "Minhas partidas estão melhorando?" — serious errors per game, recent vs previous games.

const DAY = 86_400_000;
const review = (ply: number, classification: MoveClass): MoveReview => ({ ply, color: ply % 2 === 1 ? 'w' : 'b', classification }) as MoveReview;

/** A white game on day `day` with `serious` user mistakes/blunders (odd plies) and `theirs` opponent ones. */
function game(day: number | undefined, serious: number, opts: { theirs?: number; color?: 'w' | 'b' | null; importedAt?: number; minor?: number } = {}): AnalyzedGameInput {
  const color = opts.color === null ? undefined : (opts.color ?? 'w');
  const own = color === 'b' ? 0 : 1;
  const reviews: MoveReview[] = [];
  let ply = 1;
  const next = (mine: boolean) => {
    while ((ply % 2 === own) !== mine) ply++;
    return ply++;
  };
  for (let i = 0; i < serious; i++) reviews.push(review(next(true), i % 2 ? 'blunder' : 'mistake'));
  for (let i = 0; i < (opts.minor ?? 0); i++) reviews.push(review(next(true), 'inaccuracy'));
  for (let i = 0; i < (opts.theirs ?? 0); i++) reviews.push(review(next(false), 'blunder'));
  return {
    gameId: `g${day ?? 'x'}-${serious}-${Math.random()}`,
    ...(color ? { userColor: color } : {}),
    ...(day !== undefined ? { at: day * DAY } : {}),
    importedAt: opts.importedAt ?? 0,
    reviews,
    replyLines: {},
  };
}

const series = (counts: number[]) => counts.map((c, i) => game(i + 1, c));

describe('serious errors per game (Sprint 4.6, B3)', () => {
  it('constants follow the plan', () => {
    expect([TREND_MIN_GAMES, TREND_WINDOW, TREND_THRESHOLD]).toEqual([6, 10, 0.3]);
  });

  it('no games, or fewer than 6 valid ones, is insufficient', () => {
    expect(seriousErrorTrend([])).toEqual({ kind: 'insufficient', games: 0 });
    expect(seriousErrorTrend(series([1, 2, 3, 4, 5]))).toEqual({ kind: 'insufficient', games: 5 });
  });

  it('exactly 6 games compares the last 3 with the 3 before', () => {
    const t = seriousErrorTrend(series([3, 3, 3, 1, 1, 1]));
    expect(t).toMatchObject({ kind: 'compared', window: 3, recentGames: 3, previousGames: 3, recent: 1, previous: 3, direction: 'better' });
  });

  it('19 games uses half the total, rounded down (9 vs 9); the oldest game is left out', () => {
    const t = seriousErrorTrend(series([100, ...Array(9).fill(2), ...Array(9).fill(1)]));
    expect(t).toMatchObject({ kind: 'compared', window: 9, previous: 2, recent: 1 });
  });

  it('20 games or more compares the last 10 with the 10 before', () => {
    const t = seriousErrorTrend(series([...Array(5).fill(100), ...Array(10).fill(1), ...Array(10).fill(2)]));
    expect(t).toMatchObject({ kind: 'compared', window: 10, recentGames: 10, previousGames: 10, previous: 1, recent: 2, direction: 'worse' });
  });

  it('only the user moves classified mistake or blunder count', () => {
    const games = [1, 2, 3, 4, 5, 6].map((d) => game(d, d <= 3 ? 0 : 2, { theirs: 5, minor: 4 }));
    expect(seriousErrorTrend(games)).toMatchObject({ previous: 0, recent: 2 });
  });

  it('counts the user side for Black too', () => {
    const games = [1, 2, 3, 4, 5, 6].map((d) => game(d, d <= 3 ? 2 : 0, { color: 'b', theirs: 3 }));
    expect(seriousErrorTrend(games)).toMatchObject({ previous: 2, recent: 0, direction: 'better' });
  });

  it('only opponent errors: zero for the user, stable', () => {
    const games = [1, 2, 3, 4, 5, 6].map((d) => game(d, 0, { theirs: 4 }));
    expect(seriousErrorTrend(games)).toMatchObject({ previous: 0, recent: 0, difference: 0, direction: 'stable' });
  });

  it('games without the user color are left out of the sample', () => {
    const games = [...series([1, 1, 1, 1, 1]), game(9, 9, { color: null })];
    expect(seriousErrorTrend(games)).toEqual({ kind: 'insufficient', games: 5 });
  });

  it('orders by game date, not by import order; undated games count as the oldest', () => {
    // Imported newest-first, and two undated games imported last: they must still be the oldest.
    const dated = [6, 5, 4, 3].map((d, i) => game(d, d >= 5 ? 0 : 3, { importedAt: i + 10 }));
    const undated = [game(undefined, 3, { importedAt: 100 }), game(undefined, 3, { importedAt: 101 })];
    expect(seriousErrorTrend([...dated, ...undated])).toMatchObject({ previous: 3, recent: 1, window: 3 });
  });

  it('a difference below 0.3 errors per game is stable; 0.3 or more is a change', () => {
    // previous 3 games: 1, 1, 1 (mean 1). recent: totals 3 → 1 (0), 4 → 1.333 (0.33), 2 → 0.667 (−0.33).
    expect(seriousErrorTrend(series([1, 1, 1, 1, 1, 1]))).toMatchObject({ direction: 'stable', difference: 0 });
    expect(seriousErrorTrend(series([1, 1, 1, 1, 1, 2]))).toMatchObject({ direction: 'worse' });
    expect(seriousErrorTrend(series([1, 1, 1, 0, 1, 1]))).toMatchObject({ direction: 'better' });
    // 10 vs 10: totals 10 and 12 → means 1.0 and 1.2 (difference 0.2, below the threshold).
    const ten = (n: number, extra: number) => Array.from({ length: 10 }, (_, i) => 1 + (i < extra ? 1 : 0)).slice(0, n);
    expect(seriousErrorTrend(series([...ten(10, 0), ...ten(10, 2)]))).toMatchObject({ direction: 'stable' });
    // Exactly 0.3 (10 vs 13 errors over 10 games) counts as a change, despite floating point.
    expect(seriousErrorTrend(series([...ten(10, 0), ...ten(10, 3)]))).toMatchObject({ direction: 'worse', difference: 0.3 });
    expect(seriousErrorTrend(series([...ten(10, 3), ...ten(10, 0)]))).toMatchObject({ direction: 'better', difference: -0.3 });
  });

  it('no serious errors at all is stable at zero', () => {
    expect(seriousErrorTrend(series([0, 0, 0, 0, 0, 0, 0]))).toMatchObject({ kind: 'compared', recent: 0, previous: 0, direction: 'stable' });
  });

  it('flags a small sample where a single error decides the direction (review M1)', () => {
    // 3 games per window: one extra error moves the mean by 0.33, above the threshold.
    expect(seriousErrorTrend(series([1, 1, 1, 1, 1, 2]))).toMatchObject({ window: 3, direction: 'worse', singleErrorDecides: true });
    expect(seriousErrorTrend(series([1, 1, 1, 1, 1, 1, 1, 1]))).toMatchObject({ window: 4, singleErrorDecides: false });
    expect(seriousErrorTrend(series(Array(20).fill(1)))).toMatchObject({ window: 10, singleErrorDecides: false });
  });
});

describe('undated games in the comparison (audit AC-5)', () => {
  it('counts the compared games without a PGN date, so the direction can be qualified', () => {
    const dated = [6, 5, 4, 3].map((d) => game(d, d >= 5 ? 0 : 3));
    const undated = [game(undefined, 3, { importedAt: 100 }), game(undefined, 3, { importedAt: 101 })];
    expect(seriousErrorTrend([...dated, ...undated])).toMatchObject({ kind: 'compared', undatedGames: 2 });
  });

  it('is zero when every compared game is dated, and ignores undated games left out of both windows', () => {
    expect(seriousErrorTrend(series([1, 1, 1, 1, 1, 1]))).toMatchObject({ undatedGames: 0 });
    // 7 games: the window is 3, and the single oldest game (here the undated one) is not compared.
    expect(seriousErrorTrend([game(undefined, 2), ...series([1, 1, 1, 1, 1, 1])])).toMatchObject({ window: 3, undatedGames: 0 });
  });
});
