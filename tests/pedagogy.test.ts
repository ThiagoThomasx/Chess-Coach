import { readFileSync } from 'node:fs';
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

const ITALIAN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

describe('concept detection (legal-move facts + settled engine lines)', () => {
  it('moving a piece to a square where it can be legally won → hanging piece (verified)', () => {
    const c = detectConcepts(review(ITALIAN, 'f3d4', 'Nd4', { ply: 5, bestLine: ['f1c4'] }), ['e5d4', 'c2c3'])[0];
    expect(c).toMatchObject({ theme: 'hanging_piece', side: 'opponent', verified: true });
    expect(c?.evidence).toMatchObject({ square: 'd4', capturingMoveSan: 'exd4', materialDelta: -3 });
  });

  it('moving the only legal recapturer away → removed defender', () => {
    // (With the king on g1 and the rook going to a1, ...Bxd4+ would be a genuine fork instead.)
    const r = review('6k1/8/1b6/8/3N4/8/6P1/3R3K w - - 0 1', 'd1c1', 'Rc1', { bestLine: ['d4f5'] });
    expect(detectConcepts(r, ['b6d4', 'c1c8', 'g8h7'])[0]?.theme).toBe('removed_defender');
  });

  it('a piece that was already en prise and stays so → threat not answered', () => {
    const r = review('6k1/8/1b6/8/3N4/8/6P1/R5K1 w - - 0 1', 'g1h1', 'Kh1', { bestLine: ['d4f5'] });
    expect(detectConcepts(r, ['b6d4', 'a1a8', 'g8h7'])[0]?.theme).toBe('ignored_threat');
  });

  it('an absolutely pinned piece that is then won → pin, not "hanging"', () => {
    // Nd2 is pinned by Bb4 against Ke1; Qd1-g4 removes its last legal defender; ...Nxd2 wins it.
    const r = review('4k3/8/8/8/1b2n3/8/3N3P/3QK3 w - - 0 1', 'd1g4', 'Qg4', { bestLine: ['h2h3'] });
    const c = detectConcepts(r, ['e4d2', 'h2h3', 'd2e4'])[0];
    expect(c).toMatchObject({ theme: 'pin', side: 'opponent' });
    expect(c?.evidence).toMatchObject({ square: 'd2', by: 'b4', pinKind: 'absolute' });
  });

  it('a capture that looks free but loses material by SEE → losing capture', () => {
    const r = review('4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5', 'Qxd5', { bestLine: ['e1e2'] });
    const c = detectConcepts(r, ['c6d5', 'e1e2'])[0];
    expect(c).toMatchObject({ theme: 'losing_capture', verified: true });
    expect(c?.evidence.see).toBe(-8);
  });

  it('does not claim lost material when the engine reply does not win it', () => {
    const themes = detectConcepts(review(ITALIAN, 'f3d4', 'Nd4', { ply: 25, bestLine: ['f1c4'] }), ['g8f6']).map((c) => c.theme);
    expect(themes).not.toContain('hanging_piece');
  });

  it('does not quote material when the line stops mid-exchange (unsettled → unverified)', () => {
    const c = detectConcepts(review(ITALIAN, 'f3d4', 'Nd4', { ply: 5, bestLine: ['f1c4'] }), ['e5d4'])[0];
    expect(c?.theme).toBe('hanging_piece');
    expect(c?.verified).toBe(false);
  });

  it('a knight check hitting king and queen in the best line → fork opportunity', () => {
    const r = review('2q3k1/8/8/3N4/8/8/6P1/6K1 w - - 0 1', 'g1h1', 'Kh1', { bestMoveUci: 'd5e7', bestLine: ['d5e7', 'g8f8', 'e7c8', 'f8e8'] });
    const c = detectConcepts(r, [])[0];
    expect(c).toMatchObject({ theme: 'fork', side: 'own', verified: true });
    expect(c?.evidence.targets?.map((t) => t.type).sort()).toEqual(['k', 'q']);
  });

  it('a free capture skipped → capture opportunity with legal SEE', () => {
    const r = review('4k3/8/8/3q4/8/8/3R2P1/6K1 w - - 0 1', 'g1h1', 'Kh1', { bestMoveUci: 'd2d5', bestLine: ['d2d5', 'e8e7'] });
    expect(detectConcepts(r, [])[0]).toMatchObject({ theme: 'missed_capture', evidence: { see: 9 } });
  });

  it('capturing a piece to deflect an overloaded defender → deflection', () => {
    // Qd6 is the only defender of Nb6 and Be5: axb6 Qxb6 Rxe5 wins a piece.
    const r = review('6k1/8/1n1q4/P3b3/8/8/8/4R1K1 w - - 0 1', 'g1h1', 'Kh1', { bestMoveUci: 'a5b6', bestLine: ['a5b6', 'd6b6', 'e1e5', 'g8f8'] });
    const c = detectConcepts(r, [])[0];
    expect(['deflection', 'overloaded']).toContain(c?.theme);
    expect(c?.evidence.defender).toBe('d6');
  });

  it('mate flags take precedence and report exact mate in one', () => {
    const r = review('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'g1f1', 'Kf1', { flags: ['mate_missed'], evalBefore: { kind: 'mate', value: 1 }, bestLine: ['a1a8'] });
    expect(detectConcepts(r, [])[0]).toMatchObject({ theme: 'missed_mate', evidence: { mateMoveSan: 'Ra8#' } });
  });

  it('falls back to a limited positional explanation without tactical evidence', () => {
    const e = explainMove(review('4k3/pp6/8/8/8/8/PP2Q3/4K3 w - - 0 1', 'e2e3', 'Qe3', { ply: 40, bestLine: ['e2b5'] }), ['e8d7']);
    expect(e.category).toBe('positional');
    expect(e.confidence).toBe('limited');
  });

  it('a positional loss in a winning position is framed as conversion', () => {
    const e = explainMove(review('4k3/pp6/8/8/8/8/PP2Q3/4K3 w - - 0 1', 'e2e3', 'Qe3', { winBefore: 95, winAfter: 70, bestLine: ['e2b5'] }), ['e8d7']);
    expect(e.theme).toBe('conversion');
  });
});

describe('explanations', () => {
  it('answers the six questions for a verified tactical error', () => {
    const e = explainMove(review(ITALIAN, 'f3d4', 'Nd4', { ply: 5, bestLine: ['f1c4'], bestMoveSan: 'Bc4', bestMoveUci: 'f1c4' }), ['e5d4', 'c2c3']);
    expect(e.category).toBe('tactical');
    expect(e.confidence).toBe('verified');
    expect(e.skill).toBe('threats');
    expect(e.whatHappened).toMatch(/Nd4.*Erro tático.*d4/);
    expect(e.betterAlternative).toContain('Bc4');
    expect(e.consequence).toContain('exd4');
    expect(e.concept).toBeTruthy();
    expect(e.recognize).toBeTruthy();
  });

  it('does not invent problems for good moves or inconclusive data', () => {
    expect(explainMove(review(ITALIAN, 'f1c4', 'Bc4', { classification: 'best' }), []).consequence).toBeUndefined();
    const inc = explainMove(review(ITALIAN, 'f1c4', 'Bc4', { classification: 'inconclusive', reason: 'Profundidade 4 abaixo do mínimo (10)' }), []);
    expect(inc).toMatchObject({ confidence: 'limited', category: 'inconclusive' });
    expect(inc.whatHappened).toMatch(/Profundidade/);
  });

  it('never attributes psychological causes to the player', () => {
    const source = readFileSync(new URL('../src/services/pedagogy/explain.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/aten[cç][aã]o|distra|pressa|descuid|nervos|esqueceu|não viu|cansa|desleix/i);
  });
});
