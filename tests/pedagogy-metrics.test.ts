import { describe, expect, it } from 'vitest';
import { lossBucket, rootSpread } from './support/pedagogyMetrics';
import type { AcceptableMove } from '../src/types/domain';

// Sprint 4.8: the metrics measure:pedagogy adds for the PD-4 decision.

const move = (uci: string, cp: number): AcceptableMove => ({ uci, san: uci, score: { kind: 'cp', value: cp } });

describe('rootSpread', () => {
  it('marks the search as capped when every searched line was accepted', () => {
    expect(rootSpread([move('a', 50), move('b', 40), move('c', 30)], 'w', 3).capped).toBe(true);
    expect(rootSpread([move('a', 50), move('b', 40)], 'w', 3).capped).toBe(false);
    expect(rootSpread([], 'w', 3)).toEqual({ accepted: 0, capped: false, alternativeLosses: [] });
  });

  it('measures what each alternative gives up against the first, for the side to move', () => {
    const white = rootSpread([move('a', 100), move('b', 0)], 'w', 3);
    expect(white.alternativeLosses).toHaveLength(1);
    expect(white.alternativeLosses[0]).toBeGreaterThan(5);
    // Black to move: a lower (White POV) score is better for Black.
    const black = rootSpread([move('a', -100), move('b', 0)], 'b', 3);
    expect(black.alternativeLosses[0]).toBeCloseTo(white.alternativeLosses[0] ?? 0, 6);
    expect(rootSpread([move('a', 30), move('b', 30)], 'w', 3).alternativeLosses).toEqual([0]);
  });
});

describe('lossBucket', () => {
  it('puts each loss in its bucket, bounds included in the lower one', () => {
    expect([0, 1, 1.01, 3, 4.9, 5, 5.01, 20].map(lossBucket)).toEqual(['≤1', '≤1', '1–3', '1–3', '3–5', '3–5', '>5', '>5']);
  });
});
