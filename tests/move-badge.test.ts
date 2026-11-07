import { describe, expect, it } from 'vitest';
import { badgeForClass, badgeForReview, solverMoveClass } from '../src/services/analysis/moveBadge';
import { DEFAULT_THRESHOLDS } from '../src/services/analysis/classify';
import type { MoveClass, MoveReview, Score } from '../src/types/domain';

const cp = (v: number): Score => ({ kind: 'cp', value: v });
const mate = (n: number): Score => ({ kind: 'mate', value: n });

const review = (over: Partial<MoveReview> = {}): MoveReview => ({
  ply: 5,
  san: 'Nd4',
  uci: 'f3d4',
  color: 'w',
  fenBefore: '',
  fenAfter: '',
  evalBefore: cp(30),
  evalAfter: cp(-300),
  bestLine: [],
  winBefore: 52,
  winAfter: 22,
  winLoss: 30,
  classification: 'blunder',
  flags: [],
  depth: 16,
  ...over,
});

describe('badgeForClass', () => {
  it.each<[MoveClass, string]>([
    ['best', '★'],
    ['excellent', '!'],
    ['good', '✓'],
    ['inaccuracy', '?!'],
    ['mistake', '?'],
    ['blunder', '??'],
  ])('maps %s to its symbol and the methodology label', (cls, symbol) => {
    const b = badgeForClass(cls);
    expect(b?.symbol).toBe(symbol);
    expect(b?.cls).toBe(cls);
    expect(b?.label.length).toBeGreaterThan(0);
  });

  it('shows nothing for verdicts the engine could not support', () => {
    expect(badgeForClass('inconclusive')).toBeNull();
    expect(badgeForClass('book')).toBeNull();
  });
});

describe('badgeForReview', () => {
  it('anchors the badge on the destination square of the move', () => {
    expect(badgeForReview(review())).toMatchObject({ square: 'd4', cls: 'blunder', symbol: '??' });
  });

  it('uses the promotion destination, not the promotion piece', () => {
    expect(badgeForReview(review({ uci: 'e7e8q', classification: 'best' }))?.square).toBe('e8');
  });

  it('returns null with no review or an inconclusive one', () => {
    expect(badgeForReview(undefined)).toBeNull();
    expect(badgeForReview(review({ classification: 'inconclusive' }))).toBeNull();
  });
});

describe('solverMoveClass', () => {
  const t = DEFAULT_THRESHOLDS;
  const base = { color: 'w' as const, depth: 16 };

  it('the reference move itself is the best move', () => {
    expect(solverMoveClass({ accepted: true, ...base, reference: cp(250), played: cp(250) }, t)).toBe('best');
  });

  it('an accepted alternative is graded by its win-expectancy loss', () => {
    // 250 → 240 cp loses under 2 p.p.; 250 → 200 loses about 3.9 p.p.
    expect(solverMoveClass({ accepted: true, ...base, reference: cp(250), played: cp(240) }, t)).toBe('excellent');
    expect(solverMoveClass({ accepted: true, ...base, reference: cp(250), played: cp(200) }, t)).toBe('good');
  });

  it('a slower mate is at most "good" (methodology mate rule)', () => {
    expect(solverMoveClass({ accepted: true, ...base, reference: mate(2), played: mate(3) }, t)).toBe('good');
  });

  it('a rejected move is graded by its loss', () => {
    expect(solverMoveClass({ accepted: false, ...base, reference: cp(300), played: cp(-300) }, t)).toBe('blunder');
  });

  it('a rejected move whose loss is small shows no badge instead of a contradictory positive one', () => {
    expect(solverMoveClass({ accepted: false, ...base, reference: mate(2), played: mate(5) }, t)).toBeNull();
  });

  it('uses the mover point of view for Black', () => {
    expect(solverMoveClass({ accepted: false, color: 'b', depth: 16, reference: cp(-300), played: cp(300) }, t)).toBe('blunder');
  });

  it('is inconclusive (no badge) below the minimum depth', () => {
    expect(solverMoveClass({ accepted: true, color: 'w', depth: 4, reference: cp(10), played: cp(10) }, t)).toBeNull();
  });
});
