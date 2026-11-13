import { describe, expect, it } from 'vitest';
import { consequenceOf, numberedLine, refutationLine, REFUTATION_PLIES } from '../src/services/exercises/refutation';
import type { Score } from '../src/types/domain';

const cp = (v: number): Score => ({ kind: 'cp', value: v });
const mate = (n: number): Score => ({ kind: 'mate', value: n });

// White rook d2, Black queen d5: Rxd5 wins the queen; Rd4?? hangs the rook to Qxd4.
const ROOK_QUEEN = '4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1';

describe('refutation line (Sprint 4.6, B1)', () => {
  it('lists the opponent reply and what follows, in SAN, up to the ply limit', () => {
    const line = refutationLine(ROOK_QUEEN, ['d2d4', 'd5d4', 'e1f1', 'd4d1', 'f1f2', 'e8e7']);
    expect(line?.map((m) => m.san)).toEqual(['Qxd4', 'Kf1', 'Qd1+', 'Kf2']);
    expect(line).toHaveLength(REFUTATION_PLIES);
    expect(line?.[0]?.uci).toBe('d5d4');
  });

  it('has no refutation when the engine line stops at the user move', () => {
    expect(refutationLine(ROOK_QUEEN, ['d2d4'])).toBeUndefined();
    expect(refutationLine(ROOK_QUEEN, [])).toBeUndefined();
  });

  it('stops at the first illegal move instead of inventing the rest', () => {
    expect(refutationLine(ROOK_QUEEN, ['d2d4', 'd5d4', 'a1a8'])?.map((m) => m.san)).toEqual(['Qxd4']);
  });
});

describe('consequence of a rejected move (Sprint 4.6, B1)', () => {
  it('a mate against the user is stated as "permite mate em N"', () => {
    expect(consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: mate(-2), reference: cp(900) })).toBe('permite mate em 2');
    expect(consequenceOf({ fen: ROOK_QUEEN, solver: 'b', played: mate(3), reference: cp(0) })).toBe('permite mate em 3');
  });

  it('a settled material loss of 3 or more is named by its size', () => {
    const text = consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(-600), reference: cp(900), pv: ['d2d4', 'd5d4', 'e1f1', 'e8e7'], referencePv: ['d2d5', 'e8e7'] });
    expect(text).toBe('perde material (cerca de uma torre)');
  });

  it('missing a material gain of 3 or more is named as such', () => {
    const text = consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(-500), reference: cp(900), pv: ['e1f2', 'e8e7'], referencePv: ['d2d5', 'e8e7'] });
    expect(text).toBe('deixa de ganhar material (cerca de uma dama)');
  });

  it('a line that stops on a capture is not settled: the material rule is not used', () => {
    const text = consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(0), reference: cp(300), pv: ['d2d4', 'd5d4'] });
    expect(text).not.toMatch(/material/);
  });

  it('without a material or mate fact, the loss is stated as the change of the position', () => {
    expect(consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(0), reference: cp(300) })).toBe('a posição passa de vantagem para igualdade');
    expect(consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(-200), reference: cp(600) })).toBe('a posição passa de vantagem decisiva para desvantagem');
    expect(consequenceOf({ fen: ROOK_QUEEN, solver: 'b', played: cp(0), reference: cp(-300) })).toBe('a posição passa de vantagem para igualdade');
  });

  it('a loss inside the same band is still described without percentage points', () => {
    expect(consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(500), reference: cp(1000) })).toBe('reduz a vantagem');
    expect(consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(-100), reference: cp(100) })).toBe('piora a posição');
    expect(consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(-900), reference: cp(-500) })).toBe('piora uma posição já difícil');
  });

  it('never mentions percentage points', () => {
    const texts = [cp(-1000), cp(-300), cp(0), cp(200), cp(800)].map((played) => consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played, reference: cp(1000) }));
    for (const t of texts) expect(t).not.toMatch(/p\.p\.|%/);
  });
});

describe('numbered line for display (Sprint 4.6, B1)', () => {
  it('numbers a line that starts with Black to move', () => {
    const afterRd4 = '4k3/8/8/3q4/3R4/8/8/4K3 b - - 1 12';
    expect(numberedLine(afterRd4, ['Qxd4', 'Kf1', 'Qd1+', 'Kf2'])).toBe('12… Qxd4 13. Kf1 Qd1+ 14. Kf2');
  });

  it('numbers a line that starts with White to move', () => {
    expect(numberedLine('4k3/8/8/8/8/8/8/4K3 w - - 0 7', ['Kf1', 'Ke7'])).toBe('7. Kf1 Ke7');
  });
});
