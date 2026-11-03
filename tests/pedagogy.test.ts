import { describe, expect, it } from 'vitest';
import { detectConcepts } from '../src/services/pedagogy/concepts';
import { explainMove } from '../src/services/pedagogy/explain';
import { applyUci } from '../src/services/chess/position';
import type { MoveReview, Score } from '../src/types/domain';

const cp = (v: number): Score => ({ kind: 'cp', value: v });

function review(fenBefore: string, uci: string, san: string, over: Partial<MoveReview> = {}): MoveReview {
  const fenAfter = applyUci(fenBefore, uci);
  if (!fenAfter) throw new Error(`illegal ${uci}`);
  return {
    ply: 30,
    san,
    uci,
    color: fenBefore.split(' ')[1] === 'w' ? 'w' : 'b',
    fenBefore,
    fenAfter,
    evalBefore: cp(0),
    evalAfter: cp(-300),
    bestLine: [],
    winBefore: 50,
    winAfter: 20,
    winLoss: 30,
    classification: 'blunder',
    flags: [],
    depth: 16,
    ...over,
  };
}

describe('concept detection (verified facts only)', () => {
  it('moving a piece to an attacked, undefended square → hanging piece', () => {
    const r = review('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'f3d4', 'Nd4', { ply: 5, bestLine: ['f1c4'] });
    const c = detectConcepts(r, ['e5d4', 'c2c3']);
    expect(c[0]?.theme).toBe('hanging_piece');
    expect(c[0]?.evidence.square).toBe('d4');
    expect(c[0]?.evidence.capturingMoveSan).toBe('exd4');
  });

  it('moving the only defender away → removed defender', () => {
    const r = review('6k1/8/1b6/8/3N4/8/6P1/3R2K1 w - - 0 1', 'd1a1', 'Ra1', { bestLine: ['d4f5'] });
    expect(detectConcepts(r, ['b6d4'])[0]?.theme).toBe('removed_defender');
  });

  it('an attacked piece left en prise → ignored threat', () => {
    const r = review('6k1/8/1b6/8/3N4/8/6P1/R5K1 w - - 0 1', 'g1h1', 'Kh1', { bestLine: ['d4f5'] });
    expect(detectConcepts(r, ['b6d4'])[0]?.theme).toBe('ignored_threat');
  });

  it('does not claim a hanging piece when the engine reply does not win material', () => {
    const r = review('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'f3d4', 'Nd4', { ply: 25, bestLine: ['f1c4'] });
    const themes = detectConcepts(r, ['g8f6']).map((c) => c.theme);
    expect(themes).not.toContain('hanging_piece');
  });

  it('a knight check hitting king and queen in the best line → fork', () => {
    const r = review('2q3k1/8/8/3N4/8/8/6P1/6K1 w - - 0 1', 'g1h1', 'Kh1', { bestMoveUci: 'd5e7', bestLine: ['d5e7', 'g8h8', 'e7c8'] });
    const c = detectConcepts(r, []);
    expect(c[0]?.theme).toBe('fork');
    expect(c[0]?.evidence.targets?.map((t) => t.type).sort()).toEqual(['k', 'q']);
  });

  it('a free capture skipped → missed capture', () => {
    const r = review('4k3/8/8/3q4/8/8/3R2P1/6K1 w - - 0 1', 'g1h1', 'Kh1', { bestMoveUci: 'd2d5', bestLine: ['d2d5', 'e8e7'] });
    expect(detectConcepts(r, [])[0]?.theme).toBe('missed_capture');
  });

  it('mate flags take precedence', () => {
    const r = review('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'g1f1', 'Kf1', { flags: ['mate_missed'], evalBefore: { kind: 'mate', value: 1 }, bestLine: ['a1a8'] });
    expect(detectConcepts(r, [])[0]?.theme).toBe('missed_mate');
  });

  it('falls back to a limited positional explanation without tactical evidence', () => {
    const r = review('4k3/pp6/8/8/8/8/PP2Q3/4K3 w - - 0 1', 'e2e3', 'Qe3', { ply: 40, bestLine: ['e2b5'] });
    const e = explainMove(r, ['e8d7']);
    expect(e.theme).toBe('endgame');
    expect(e.confidence).toBe('limited');
  });
});

describe('explanations', () => {
  it('produces the structured sections for a verified error', () => {
    const r = review('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'f3d4', 'Nd4', { ply: 5, bestLine: ['f1c4'], bestMoveSan: 'Bc4', bestMoveUci: 'f1c4' });
    const e = explainMove(r, ['e5d4']);
    expect(e.confidence).toBe('verified');
    expect(e.skill).toBe('threats');
    expect(e.whatHappened).toContain('Nd4');
    expect(e.betterAlternative).toContain('Bc4');
    expect(e.problem).toContain('d4');
    expect(e.consequence).toContain('exd4');
    expect(e.concept).toBeTruthy();
    expect(e.howToAvoid).toBeTruthy();
  });

  it('does not invent problems for good moves or inconclusive data', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    expect(explainMove(review(fen, 'f1c4', 'Bc4', { classification: 'best' }), []).problem).toBeUndefined();
    const inc = explainMove(review(fen, 'f1c4', 'Bc4', { classification: 'inconclusive', reason: 'Profundidade 4 abaixo do mínimo (10)' }), []);
    expect(inc.confidence).toBe('limited');
    expect(inc.problem).toMatch(/Profundidade/);
  });
});
