import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectConcepts } from '../src/services/pedagogy/concepts';
import { errorKindOf, explainMove, threatBefore } from '../src/services/pedagogy/explain';
import { settledSwing } from '../src/services/chess/material';
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

// Sprint 3 audit, phase 2: explanations must not deny tactics that exist.
const NEGATIONS = /sem um motivo tático|Não há perda|sem perda imediata/i;
const LEGAL_G6 = 'rn1qkbnr/ppp2ppp/3p4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 3 4';

describe('truthful fallbacks (audit A2)', () => {
  it("Légal 4…g6: cites the pawn White wins instead of 'no tactical reason'", () => {
    // 5.Nxe5 dxe5 6.Qxg4: the bishop on g4 falls once the knight unblocks d1–g4.
    const r = review(LEGAL_G6, 'g7g6', 'g6', { ply: 8, evalBefore: cp(-40), evalAfter: cp(150), winBefore: 46, winAfter: 36, winLoss: 10, classification: 'mistake', bestLine: ['g8f6'], bestMoveSan: 'Nf6' });
    const e = explainMove(r, ['f3e5', 'd6e5', 'd1g4', 'g8f6', 'g4e2', 'b8c6']);
    const text = [e.whatHappened, e.why, e.consequence].join(' ');
    expect(text).not.toMatch(NEGATIONS);
    expect(e.theme).not.toBe('opening');
    expect(e.skill).not.toBe('openings');
    expect(text).toContain('Nxe5');
    expect(text).toMatch(/1 ponto/);
  });

  it('a line that does not settle is reported as not verified, never as "no loss"', () => {
    const e = explainMove(review('4k3/pp6/8/8/8/8/PP2Q3/4K3 w - - 0 1', 'e2e3', 'Qe3', { ply: 40, bestLine: ['e2b5'] }), ['e8d7']);
    const text = [e.whatHappened, e.why].join(' ');
    expect(text).not.toMatch(NEGATIONS);
    expect(e.confidence).toBe('limited');
  });

  it('no fallback template asserts the absence of tactics', () => {
    const source = readFileSync(new URL('../src/services/pedagogy/explain.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(NEGATIONS);
  });
});

describe("opponent's lines are never presented as the better move (audit A3)", () => {
  it('a combination by the opponent is a fact/consequence, not a "why"', () => {
    // Légal again, but the motif detector finds no named pattern for Nxe5.
    const r = review(LEGAL_G6, 'g7g6', 'g6', { ply: 8, classification: 'mistake', bestLine: ['g8f6'], bestMoveSan: 'Nf6' });
    const e = explainMove(r, ['f3e5', 'd6e5', 'd1g4', 'g8f6', 'g4e2', 'b8c6']);
    expect(e.why ?? '').not.toContain('Nxe5');
  });

  it('a verified concept is ranked before an unverified one', () => {
    for (const fen of [LEGAL_G6, ITALIAN]) {
      const cs = detectConcepts(review(fen, fen === ITALIAN ? 'f3d4' : 'g7g6', 'x', { ply: 8, bestLine: [] }), fen === ITALIAN ? ['e5d4', 'c2c3'] : ['f3e5', 'd6e5', 'd1g4', 'g8f6', 'g4e2', 'b8c6']);
      const firstUnverified = cs.findIndex((c) => !c.verified);
      const lastVerified = cs.map((c) => c.verified).lastIndexOf(true);
      if (firstUnverified >= 0 && lastVerified >= 0) expect(lastVerified).toBeLessThan(firstUnverified);
    }
  });
});

describe('pin tense and gender (audit M2, B1)', () => {
  it('a pin the opponent can still create is described in the future, naming the pinning move', () => {
    const r = review('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'e1d2', 'Kd2', { bestLine: ['e1e2'] });
    const e = explainMove(r, ['a8d8', 'd2e3', 'd8d5', 'e3e4', 'd5d1', 'e4e3']);
    expect(e.theme).toBe('pin');
    expect(e.whatHappened).not.toMatch(/está cravad/);
    expect(e.whatHappened).toContain('Rd8');
  });

  it('feminine pieces get feminine articles and agreement', () => {
    // The rook on a1 is attacked by the bishop and stays attacked.
    const r = review('4k3/8/8/8/8/8/1b6/R3K3 w - - 0 1', 'e1e2', 'Ke2', { bestLine: ['a1a2'] });
    const e = explainMove(r, ['b2a1', 'e2d3', 'a1e5', 'd3e4']);
    expect(e.whatHappened).toMatch(/Sua torre/);
    expect(e.whatHappened).toMatch(/capturada/);
    expect(e.whatHappened).not.toMatch(/Seu torre|capturado/);
  });

  it('target lists use an article for every piece', () => {
    const r = review('3qk3/8/8/8/3n4/8/2Q5/R3K3 w Q - 0 1', 'c2h2', 'Qh2', { bestLine: ['c2c3'] });
    const e = explainMove(r, ['d4f3', 'e1e2', 'f3h2', 'a1a8', 'd8a8', 'e2e3']);
    expect(e.whatHappened).toMatch(/o rei em e1 e a dama em h2/);
  });
});

// Sprint 3 audit, phase 7: "why it is better" states a fact or is omitted.
const QUIET = '4k3/pp6/8/8/8/8/PP2Q3/4K3 w - - 0 1';

describe('"why" compares both moves or is omitted (audit M7)', () => {
  it('omits the section when no fact separates the moves, instead of repeating the engine line', () => {
    const e = explainMove(review(QUIET, 'e2e3', 'Qe3', { ply: 40, bestLine: ['e2b5', 'e8d8'], bestMoveSan: 'Qb5+', bestMoveUci: 'e2b5' }), ['e8d7']);
    expect(e.category).toBe('positional');
    expect(e.why).toBeUndefined();
    expect(e.betterAlternative).toContain('Qb5+');
  });

  it('compares settled material of the best line and the played line', () => {
    // 1.Qb5+ Kd8 2.Qxb7 a6 wins a pawn; after Qe3 Kd7 material is level.
    const r = review(QUIET, 'e2e3', 'Qe3', { ply: 40, bestLine: ['e2b5', 'e8d8', 'b5b7', 'a7a6'], bestMoveSan: 'Qb5+', bestMoveUci: 'e2b5' });
    const c = detectConcepts(r, ['e8d7'])[0];
    expect(c?.evidence.materialCompare).toEqual({ best: 1, played: 0 });
    const e = explainMove(r, ['e8d7']);
    expect(e.why).toMatch(/Com Qb5\+.*\+1.*Qe3.*0/);
    expect(e.why).not.toMatch(/continuação preferida/);
  });

  it('a defense against mate is justified by the mate distance, not by naming the move', () => {
    const r = review(QUIET, 'e2e3', 'Qe3', { ply: 40, evalBefore: { kind: 'mate', value: -5 }, evalAfter: { kind: 'mate', value: -2 }, bestLine: ['e2b5'], bestMoveSan: 'Qb5+', bestMoveUci: 'e2b5' });
    const e = explainMove(r, ['e8d7']);
    expect(e.theme).toBe('mate_threat');
    expect(e.why).toBe('Com Qb5+, o mate demoraria 5 lance(s); depois de Qe3, vem em 2.');
  });

  it('no template uses the bare engine line as the justification', () => {
    const source = readFileSync(new URL('../src/services/pedagogy/explain.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/continuação preferida pelo motor|defesa mais (sólida|resistente)|Sequência do motor:/);
  });
});

describe('Sprint 3: six-question explanations', () => {
  // Blackburne–Shilling after 4.Nxe5?: the engine line Qg5 Bxf7+ Kd8 Ng4 Nh6 c3 Nc2+ Qxc2 Qxg4 Bb3.
  const BLACKBURNE = 'r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
  const REPLY = ['d8g5', 'c4f7', 'e8d8', 'e5g4', 'g8h6', 'c2c3', 'd4c2', 'd1c2', 'g5g4', 'f7b3'];

  it('material is not measured right before a capture the line is about to make', () => {
    // Six plies end on a quiet king move, but the line's next move wins the rook on a1 (no recapture, no check).
    const fen = '4k3/8/8/8/8/8/1q4P1/R3K3 b - - 0 1';
    const s = settledSwing(fen, ['e8e7', 'e1f1', 'e7e6', 'f1g1', 'e6e5', 'g1h2', 'b2a1'], 'w');
    expect(s).toMatchObject({ plies: 7, delta: -5, settled: true });
  });

  it('a line ending on a capture nobody can answer is settled; one with a recapture pending is not', () => {
    // 3.Nd4?? exd4 c3 d5 cxd4 dxe4 d5 Qxd5: the queen on d5 cannot be recaptured.
    const after = applyUci('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'f3d4') as string;
    expect(settledSwing(after, ['e5d4', 'c2c3', 'd7d5', 'c3d4', 'd5e4', 'd4d5', 'd8d5'], 'w')).toMatchObject({ delta: -4, settled: true });
    // Rxd5 can be met by …exd5: the exchange is unfinished.
    expect(settledSwing('3qk3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', ['d1d5'], 'w').settled).toBe(false);
  });

  it('a capture without a recognized motif is a calculation error, never "opening principles"', () => {
    const r = review(BLACKBURNE, 'f3e5', 'Nxe5', { ply: 7, bestLine: ['e1g1'], evalBefore: cp(116), evalAfter: cp(-59), winBefore: 60, winAfter: 44, winLoss: 16 });
    const e = explainMove(r, REPLY);
    expect(e.theme).not.toBe('opening');
    expect(e.skill).not.toBe('openings');
    if (e.theme === 'unsound_forcing') expect(e.kind).toBe('calculation');
  });

  it('names the opponent threat before the move from legal facts, and omits it when there is none', () => {
    // Black's rook on d8 attacks the undefended Nd4 (SEE > 0) before White's quiet king move.
    const threatened = review('3r2k1/8/8/8/3N4/8/6P1/6K1 w - - 0 1', 'g1h1', 'Kh1', { bestLine: ['d4f5'] });
    expect(threatBefore(threatened)).toMatch(/seu cavalo em d4/);
    const quiet = review('6k1/8/8/8/3N4/8/6P1/6K1 w - - 0 1', 'g1h1', 'Kh1', { bestLine: ['d4f5'] });
    expect(threatBefore(quiet)).toBeUndefined();
  });

  it('a mate-in-one threat before the move is named with its move', () => {
    // Back rank: ...Ra1# is threatened before White plays a king move.
    const r = review('r5k1/8/8/8/8/8/5PPP/6K1 w - - 0 1', 'g1f1', 'Kf1', { bestLine: ['h2h3'] });
    expect(threatBefore(r)).toMatch(/mate em 1 com Ra1#?/);
  });

  it('says what happens after the better move (engine line and evaluation)', () => {
    const r = review(ITALIAN, 'f3d4', 'Nd4', { ply: 5, bestLine: ['f1c4', 'f8c5', 'c2c3'], evalBefore: cp(30) });
    expect(explainMove(r, ['e5d4', 'c2c3']).afterAlternative).toMatch(/Bc4 Bc5 c3 — avaliação \+0[.,]30/);
  });

  it('labels each kind of decision', () => {
    const base = { category: 'tactical' as const, verified: true, evidence: {} };
    expect(errorKindOf({ ...base, theme: 'fork', side: 'opponent' })).toBe('tactical');
    expect(errorKindOf({ ...base, theme: 'fork', side: 'own' })).toBe('missed_opportunity');
    expect(errorKindOf({ ...base, theme: 'losing_capture', side: 'opponent' })).toBe('calculation');
    // An opponent combination after the player's own capture/check refutes that forcing move.
    expect(errorKindOf({ ...base, theme: 'combination', side: 'opponent', verified: false }, true)).toBe('calculation');
    expect(errorKindOf({ ...base, theme: 'combination', side: 'opponent', verified: false }, false)).toBe('tactical');
    expect(errorKindOf({ ...base, theme: 'conversion', category: 'positional' })).toBe('strategic');
    expect(errorKindOf({ ...base, theme: 'positional', category: 'positional' })).toBe('positional');
    const best = explainMove(review(ITALIAN, 'f1c4', 'Bc4', { classification: 'best', winLoss: 0 }), []);
    const close = explainMove(review(ITALIAN, 'f1b5', 'Bb5', { classification: 'excellent', winLoss: 1, bestMoveSan: 'Bc4' }), []);
    expect([best.kind, close.kind]).toEqual(['correct', 'equivalent']);
  });

  it('an unverified inaccuracy gets the facts, not a full lesson (proportional)', () => {
    const r = review(ITALIAN, 'h2h3', 'h3', { ply: 5, classification: 'inaccuracy', winLoss: 6, bestLine: ['f1c4'], bestMoveSan: 'Bc4' });
    const e = explainMove(r, ['g8f6']);
    expect(e.confidence).toBe('limited');
    expect(e.concept).toBeUndefined();
    expect(e.recognize).toBeUndefined();
    expect(e.betterAlternative).toBe('Bc4.');
  });
});
