import { describe, expect, it } from 'vitest';
import { displayed, navReducer, type NavState } from '../src/features/analysis/navigation';
import { replayGame, positionsOf } from '../src/services/chess/position';
import { attemptStats, dailyPerformance, openingResults, dayKey } from '../src/services/stats/stats';
import type { Attempt, Game } from '../src/types/domain';

const moves = ['e4', 'e5', 'Nf3', 'Nc6'];
const plies = replayGame(moves);
const fens = positionsOf(moves);
const reduce = navReducer(plies);
const start: NavState = { ply: 0, variation: null };

describe('analysis navigation', () => {
  it('moves through the main line and clamps at both ends', () => {
    let s = reduce(start, { type: 'step', delta: -1 });
    expect(s.ply).toBe(0);
    s = reduce(s, { type: 'last' });
    expect(s.ply).toBe(4);
    s = reduce(s, { type: 'step', delta: 1 });
    expect(s.ply).toBe(4);
    expect(reduce(s, { type: 'goto', ply: 2 }).ply).toBe(2);
  });

  it('playing the main-line move advances instead of branching', () => {
    expect(reduce(start, { type: 'play', uci: 'e2e4' })).toEqual({ ply: 1, variation: null });
  });

  it('creates, extends, navigates and exits variations', () => {
    let s = reduce({ ply: 2, variation: null }, { type: 'play', uci: 'f1c4' });
    expect(s.variation).toEqual({ basePly: 2, moves: ['f1c4'], index: 1 });
    s = reduce(s, { type: 'play', uci: 'g8f6' });
    expect(s.variation?.moves).toEqual(['f1c4', 'g8f6']);
    const view = displayed(fens, plies, s);
    expect(view.variationSan).toEqual(['Bc4', 'Nf6']);
    expect(view.lastMove).toEqual({ from: 'g8', to: 'f6' });
    s = reduce(s, { type: 'step', delta: -1 });
    expect(s.variation?.index).toBe(1);
    s = reduce(s, { type: 'play', uci: 'b8c6' }); // overwrite the tail
    expect(s.variation?.moves).toEqual(['f1c4', 'b8c6']);
    expect(reduce(s, { type: 'exitVariation' })).toEqual({ ply: 2, variation: null });
  });

  it('shows an engine line from a given base ply', () => {
    const s = reduce(start, { type: 'showLine', basePly: 1, moves: ['e7e5', 'g1f3'] });
    expect(displayed(fens, plies, s).fen).toBe(fens[2]);
  });
});

describe('stats', () => {
  const a = (correct: boolean, hintsUsed: number, revealed = false, at = new Date(2026, 10, 2, 23, 30).getTime()): Attempt => ({ exerciseId: 'x', at, correct, hintsUsed, revealed, timeMs: 1, moves: [] });

  it('separates independent, assisted and revealed attempts', () => {
    const s = attemptStats([a(true, 0), a(true, 2), a(false, 0, true), a(false, 0)]);
    expect(s).toMatchObject({ total: 4, independent: 1, assisted: 1, revealed: 1, independentRate: 0.25 });
    expect(attemptStats([]).independentRate).toBeNull();
  });

  it('groups by local calendar day', () => {
    expect(dayKey(new Date(2026, 10, 2, 23, 30).getTime())).toBe('2026-11-02');
    expect(dailyPerformance([a(true, 0), a(true, 1)])).toEqual([{ day: '2026-11-02', attempts: 2, independentRate: 50, assistedRate: 50 }]);
  });

  it('scores openings from the user perspective', () => {
    const g = (result: string, userColor: 'w' | 'b'): Game => ({ id: result + userColor, hash: '', headers: { white: 'a', black: 'b', result }, rawHeaders: {}, startFen: '', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4'], pgn: '', userColor, importId: '', importedAt: 0, warnings: [] });
    const r = openingResults([g('1-0', 'w'), g('1-0', 'b'), g('1/2-1/2', 'w')]);
    expect(r[0]).toMatchObject({ games: 3 });
    expect(r[0]?.score).toBeCloseTo(0.5);
  });
});
