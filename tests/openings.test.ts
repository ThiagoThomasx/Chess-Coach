import { describe, expect, it } from 'vitest';
import { OPENINGS, matchOpening } from '../src/services/openings/library';
import { validateLine, parseMoveText, checkPracticeMove, firstUserPly } from '../src/services/openings/practice';

describe('opening library', () => {
  it('contains only legal lines', () => {
    for (const o of OPENINGS) {
      for (const line of [o.mainLine, ...o.variations]) {
        const v = validateLine(line.moves);
        expect(v.ok, `${o.name} / ${line.name}: ${v.error}`).toBe(true);
      }
      expect(o.goals.length).toBeGreaterThan(0);
    }
  });

  it('has unique ids', () => {
    expect(new Set(OPENINGS.map((o) => o.id)).size).toBe(OPENINGS.length);
  });

  it('identifies the opening of a game by longest prefix', () => {
    const m = matchOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O', 'f6']);
    expect(m?.opening.id).toBe('ruy-lopez');
    expect(m?.lineId).toBe('exchange');
    expect(matchOpening(['a3', 'a6'])).toBeNull();
  });

  it('parses free-text move lists', () => {
    expect(parseMoveText('1. e4 e5 2. Nf3 {ideia} Nc6 *')).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('checks continuation drill moves', () => {
    const line = OPENINGS[0]!.mainLine;
    expect(checkPracticeMove(line, 0, 'e4')).toEqual({ kind: 'correct', done: false });
    expect(checkPracticeMove(line, 2, 'Bc4')).toEqual({ kind: 'wrong', expected: 'Nf3' });
    expect(checkPracticeMove(line, line.moves.length - 1, line.moves.at(-1)!)).toMatchObject({ kind: 'correct', done: true });
    expect(firstUserPly('b')).toBe(1);
  });
});
