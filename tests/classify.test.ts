import { describe, expect, it } from 'vitest';
import { classifyMove, DEFAULT_THRESHOLDS } from '../src/services/analysis/classify';
import { toWhitePov, povOf, winPercentWhite, winPercentFor, formatScore, matedScore, hasMateFor } from '../src/services/analysis/evaluation';
import { reviewMove } from '../src/services/analysis/gameAnalyzer';
import { replayGame } from '../src/services/chess/position';
import type { PositionAnalysis, Score } from '../src/types/domain';

const cp = (value: number): Score => ({ kind: 'cp', value });
const mate = (value: number): Score => ({ kind: 'mate', value });
const base = { playedIsBest: false, depth: 16, complete: true, ply: 30 };

describe('evaluation perspective', () => {
  it('normalizes side-to-move scores to White POV', () => {
    expect(toWhitePov(cp(120), 'w')).toEqual(cp(120));
    expect(toWhitePov(cp(120), 'b')).toEqual(cp(-120));
    expect(toWhitePov(mate(3), 'b')).toEqual(mate(-3));
    expect(povOf(cp(-200), 'b')).toEqual(cp(200));
  });

  it('maps win expectancy symmetrically and handles mate explicitly', () => {
    expect(winPercentWhite(cp(0))).toBeCloseTo(50);
    expect(winPercentWhite(cp(300)) + winPercentWhite(cp(-300))).toBeCloseTo(100);
    expect(winPercentWhite(mate(2))).toBe(100);
    expect(winPercentFor(mate(2), 'b')).toBe(0);
    expect(hasMateFor(matedScore('b'), 'w')).toBe(true);
  });

  it('formats scores', () => {
    expect(formatScore(cp(135))).toBe('+1.35');
    expect(formatScore(mate(-4))).toBe('-M4');
    expect(formatScore(matedScore('w'))).toBe('0-1');
  });
});

describe('move classification', () => {
  it('labels the engine move as best regardless of eval', () => {
    expect(classifyMove({ ...base, color: 'w', before: cp(30), after: cp(30), playedIsBest: true }).classification).toBe('best');
  });

  it('classifies by win% loss with configurable thresholds', () => {
    expect(classifyMove({ ...base, color: 'w', before: cp(20), after: cp(10) }).classification).toBe('excellent');
    expect(classifyMove({ ...base, color: 'w', before: cp(0), after: cp(-60) }).classification).toBe('inaccuracy');
    expect(classifyMove({ ...base, color: 'w', before: cp(0), after: cp(-130) }).classification).toBe('mistake');
    expect(classifyMove({ ...base, color: 'w', before: cp(0), after: cp(-450) }).classification).toBe('blunder');
    const lax = { ...DEFAULT_THRESHOLDS, good: 12, inaccuracy: 30, mistake: 60 };
    expect(classifyMove({ ...base, color: 'w', before: cp(0), after: cp(-120), thresholds: lax }).classification).toBe('good');
  });

  it('applies the same rules from Black perspective', () => {
    // Black to move: White-POV +50 → +400 means Black worsened its position.
    const r = classifyMove({ ...base, color: 'b', before: cp(50), after: cp(400) });
    expect(['mistake', 'blunder']).toContain(r.classification);
    expect(r.cpLoss).toBe(350);
    // Black winning stays winning: small loss.
    expect(classifyMove({ ...base, color: 'b', before: cp(-300), after: cp(-280) }).classification).toBe('excellent');
  });

  it('does not penalize a small loss in an already decided position as a blunder', () => {
    expect(['excellent', 'good']).toContain(classifyMove({ ...base, color: 'w', before: cp(900), after: cp(700) }).classification);
  });

  it('treats mate transitions with explicit rules', () => {
    const allowed = classifyMove({ ...base, color: 'w', before: cp(50), after: mate(-3) });
    expect(allowed.classification).toBe('blunder');
    expect(allowed.flags).toContain('allowed_mate');
    expect(allowed.cpLoss).toBeUndefined();

    const missedButWinning = classifyMove({ ...base, color: 'w', before: mate(2), after: cp(800) });
    expect(missedButWinning.flags).toContain('mate_missed');
    expect(missedButWinning.classification).toBe('inaccuracy');

    const slower = classifyMove({ ...base, color: 'w', before: mate(2), after: mate(5) });
    expect(slower.classification).toBe('good');
    expect(slower.flags).toContain('mate_found');
  });

  it('flags lost winning positions, equality and inferior positions', () => {
    expect(classifyMove({ ...base, color: 'w', before: cp(600), after: cp(0) }).flags).toContain('lost_winning_position');
    const r = classifyMove({ ...base, color: 'w', before: cp(0), after: cp(-300) });
    expect(r.flags).toContain('lost_equality');
    expect(r.flags).toContain('entered_inferior');
  });

  it('returns inconclusive for shallow or interrupted searches', () => {
    expect(classifyMove({ ...base, color: 'w', before: cp(0), after: cp(-500), depth: 4 }).classification).toBe('inconclusive');
    const r = classifyMove({ ...base, color: 'w', before: cp(0), after: cp(-500), complete: false });
    expect(r.classification).toBe('inconclusive');
    expect(r.reason).toMatch(/interrompida/);
  });

  it('flags opening errors only in early plies', () => {
    expect(classifyMove({ ...base, color: 'w', before: cp(0), after: cp(-500), ply: 5 }).flags).toContain('opening_error');
    expect(classifyMove({ ...base, color: 'w', before: cp(0), after: cp(-500), ply: 40 }).flags).not.toContain('opening_error');
  });
});

describe('reviewMove (comparing before/after analyses)', () => {
  const [ply] = replayGame(['e4', 'e5', 'Nf3', 'Nc6', 'Nd4']).slice(4);
  const pa = (fen: string, lines: PositionAnalysis['lines'], depth = 16): PositionAnalysis => ({ fen, depth, multiPv: lines.length, lines, complete: true, timeMs: 1 });

  it('uses the next position eval when the played move is not in the MultiPV list and flags material loss', () => {
    if (!ply) throw new Error('fixture');
    const before = pa(ply.fenBefore, [
      { multipv: 1, score: cp(40), pv: ['f1c4', 'g8f6'], depth: 16 },
      { multipv: 2, score: cp(35), pv: ['f1b5', 'a7a6'], depth: 16 },
    ]);
    const after = pa(ply.fenAfter, [{ multipv: 1, score: cp(-280), pv: ['e5d4', 'c2c3'], depth: 16 }]);
    const r = reviewMove(ply, before, after);
    expect(r?.evalAfter).toEqual(cp(-280));
    expect(r?.classification).toBe('blunder');
    expect(r?.flags).toContain('material_loss');
    expect(r?.bestMoveSan).toBe('Bc4');
  });

  it("uses the played move's own line when it appears in MultiPV", () => {
    if (!ply) throw new Error('fixture');
    const before = pa(ply.fenBefore, [
      { multipv: 1, score: cp(40), pv: ['f1c4'], depth: 16 },
      { multipv: 2, score: cp(-260), pv: ['f3d4', 'e5d4'], depth: 16 },
    ]);
    const after = pa(ply.fenAfter, [{ multipv: 1, score: cp(-300), pv: ['e5d4'], depth: 16 }]);
    expect(reviewMove(ply, before, after)?.evalAfter).toEqual(cp(-260));
  });
});
