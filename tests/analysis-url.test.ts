import { describe, expect, it } from 'vitest';
import { paramsWithPly, plyFromParams } from '../src/features/analysis/navigation';

// Sprint 4.8: the selected move lives in the analysis URL, so coming back reopens it.

describe('plyFromParams', () => {
  it('reads the ply and clamps it to the game', () => {
    expect(plyFromParams(new URLSearchParams('ply=5'), 6)).toBe(5);
    expect(plyFromParams(new URLSearchParams('ply=99'), 6)).toBe(6);
    expect(plyFromParams(new URLSearchParams('ply=-3'), 6)).toBe(0);
  });

  it('is 0 when absent or not a number, and drops fractions', () => {
    expect(plyFromParams(new URLSearchParams(''), 6)).toBe(0);
    expect(plyFromParams(new URLSearchParams('ply=abc'), 6)).toBe(0);
    expect(plyFromParams(new URLSearchParams('ply=2.7'), 6)).toBe(2);
  });
});

describe('paramsWithPly', () => {
  it('sets the ply and keeps the other parameters', () => {
    expect(paramsWithPly(new URLSearchParams('x=1'), 4).toString()).toBe('x=1&ply=4');
  });

  it('drops the parameter at the initial position', () => {
    expect(paramsWithPly(new URLSearchParams('ply=4'), 0).toString()).toBe('');
  });

  it('drops "review": only the dashboard link, on opening, reviews a bookmark (audit AC-2)', () => {
    expect(paramsWithPly(new URLSearchParams('ply=5&review=1'), 5).toString()).toBe('ply=5');
  });

  it('does not change the parameters it was given', () => {
    const original = new URLSearchParams('ply=1');
    paramsWithPly(original, 3);
    expect(original.toString()).toBe('ply=1');
  });
});
