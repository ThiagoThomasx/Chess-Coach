import { describe, expect, it } from 'vitest';
import { buildExercise, checkCandidate, acceptableMovesFrom, estimateDifficulty, isSacrifice, selectExercisePositions } from '../src/services/exercises/generate';
import { validateStep, judgeWithEngine, hintFor, hintForNode, attemptResult, MAX_HINTS } from '../src/services/exercises/validate';
import { exerciseOutcome } from '../src/services/adaptation/skills';
import { nextSrs, outcomeOf, DAY_MS, RETRY_DELAY_MS } from '../src/services/scheduling/srs';
import { applyUci, isValidFen, replayGame } from '../src/services/chess/position';
import { reviewMove } from '../src/services/analysis/gameAnalyzer';
import { parsePgnText } from '../src/services/pgn/parsePgn';
import type { Exercise, Game, PositionAnalysis, Score } from '../src/types/domain';
import { SHORT_BLUNDER_GAME } from './fixtures';

const cp = (v: number): Score => ({ kind: 'cp', value: v });
const game: Game = { ...parsePgnText(SHORT_BLUNDER_GAME, ['Aluno']).games[0]!, importId: 'i', importedAt: 0 };
const plies = replayGame(game.moves);
const nd4 = plies[4]!;
const before: PositionAnalysis = {
  fen: nd4.fenBefore,
  depth: 16,
  multiPv: 3,
  complete: true,
  timeMs: 1,
  lines: [
    { multipv: 1, score: cp(45), pv: ['f1c4', 'g8f6', 'd2d3'], depth: 16 },
    { multipv: 2, score: cp(38), pv: ['f1b5', 'a7a6'], depth: 16 },
    { multipv: 3, score: cp(-20), pv: ['b1c3'], depth: 16 },
  ],
};
const after: PositionAnalysis = { fen: nd4.fenAfter, depth: 16, multiPv: 1, complete: true, timeMs: 1, lines: [{ multipv: 1, score: cp(-290), pv: ['e5d4', 'c2c3'], depth: 16 }] };
const review = reviewMove(nd4, before, after)!;

function exercise(): Exercise {
  const ex = buildExercise({ game, review, before, replyLine: ['e5d4', 'c2c3'], tolerance: 5, now: 1000 });
  if (!ex) throw new Error('exercise not built');
  return ex;
}

describe('exercise generation', () => {
  it('accepts a real error and rejects good moves or shallow analyses', () => {
    expect(checkCandidate(review, before).ok).toBe(true);
    expect(checkCandidate({ ...review, classification: 'good' }, before).ok).toBe(false);
    expect(checkCandidate(review, { ...before, depth: 4 }).reasons.join()).toMatch(/Profundidade/);
    expect(checkCandidate(review, { ...before, complete: false }).ok).toBe(false);
  });

  it('builds a valid, reproducible exercise with every equivalent move accepted', () => {
    const ex = exercise();
    expect(isValidFen(ex.fen)).toBe(true);
    expect(ex.sideToMove).toBe('w');
    expect(ex.gameId).toBe(game.id);
    expect(ex.ply).toBe(5);
    expect(ex.acceptableMoves.map((m) => m.uci)).toEqual(['f1c4', 'f1b5']);
    expect(ex.ambiguous).toBe(true);
    expect(ex.srs.dueAt).toBe(1000);
    expect(ex.difficulty).toBeGreaterThanOrEqual(1);
    expect(ex.difficulty).toBeLessThanOrEqual(5);
  });

  it("an exercise from the opponent's fork asks for a defense, not a material win (M1)", () => {
    const fen = '3qk3/8/8/8/3n4/8/2Q5/R3K3 w Q - 0 1';
    const pos: PositionAnalysis = {
      fen, depth: 16, multiPv: 3, complete: true, timeMs: 1,
      lines: [
        { multipv: 1, score: cp(0), pv: ['e1f1'], depth: 16 },
        { multipv: 2, score: cp(-900), pv: ['c2h2', 'd4f3'], depth: 16 },
      ],
    };
    const qh2 = { ply: 1, san: 'Qh2', uci: 'c2h2', from: 'c2' as const, to: 'h2' as const, color: 'w' as const, fenBefore: fen, fenAfter: applyUci(fen, 'c2h2')! };
    const afterQh2: PositionAnalysis = { fen: qh2.fenAfter, depth: 16, multiPv: 1, complete: true, timeMs: 1, lines: [{ multipv: 1, score: cp(-900), pv: ['d4f3', 'e1e2', 'f3h2', 'a1a7', 'd8d2'], depth: 16 }] };
    const r = reviewMove(qh2, pos, afterQh2)!;
    const ex = buildExercise({ game, review: r, before: pos, replyLine: afterQh2.lines[0]!.pv, tolerance: 5, now: 1 })!;
    expect(ex.theme).toBe('fork');
    expect(ex.motifSide).toBe('opponent');
    expect(ex.objective).not.toMatch(/ganha material/);
    expect(ex.objective).toMatch(/advers/);
  });

  it('never accepts the move that was actually played', () => {
    const lax = { ...before, lines: [...before.lines, { multipv: 4, score: cp(44), pv: ['f3d4'], depth: 16 }] };
    expect(buildExercise({ game, review, before: lax, replyLine: [], tolerance: 5 })).toBeNull();
  });

  it('respects the configured tolerance', () => {
    expect(acceptableMovesFrom(before, 0.3)).toHaveLength(1);
    expect(acceptableMovesFrom(before, 30)).toHaveLength(3);
  });

  it('selects only the user side, ranked by loss and capped', () => {
    const picks = selectExercisePositions(game, [review, { ...review, ply: 4, color: 'b' }], [null, null, null, null, before], { max: 5 });
    expect(picks).toHaveLength(1);
    expect(picks[0]?.color).toBe('w');
    expect(selectExercisePositions(game, [review], [null, null, null, null, before], { max: 5, existingFens: new Set([review.fenBefore]) })).toHaveLength(0);
  });

  it('rates quiet multi-move solutions as harder than a one-move capture', () => {
    const fen = '4k3/8/8/3q4/8/8/3R2P1/6K1 w - - 0 1';
    expect(estimateDifficulty(fen, ['d2d5'], 'missed_capture', 1)).toBeLessThan(estimateDifficulty('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['g2g3', 'h7h6', 'a1a8', 'g8h7', 'a8h8'], 'positional', 1));
  });
});

describe('solution validation', () => {
  it('accepts the best move and equivalent alternatives; rejects others', () => {
    const ex = exercise();
    expect(validateStep(ex, 0, ex.fen, 'f1c4').kind).toBe('solved');
    expect(validateStep(ex, 0, ex.fen, 'f1b5').kind).toBe('solved');
    expect(validateStep(ex, 0, ex.fen, 'a2a3').kind).toBe('unknown');
    expect(validateStep(ex, 0, ex.fen, 'e1e3').kind).toBe('incorrect');
  });

  it('validates forcing sequences move by move including the opponent reply', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
    const ex: Exercise = { ...exercise(), fen, solutionLine: ['a1a8'], acceptableMoves: [{ uci: 'a1a8', san: 'Ra8#', score: { kind: 'mate', value: 1 } }] };
    expect(validateStep(ex, 0, fen, 'a1a8').kind).toBe('solved');

    const seqFen = '2q3k1/8/8/3N4/8/8/6P1/6K1 w - - 0 1';
    const seq: Exercise = { ...exercise(), fen: seqFen, solutionLine: ['d5e7', 'g8f8', 'e7c8'], acceptableMoves: [{ uci: 'd5e7', san: 'Ne7+', score: cp(900) }] };
    const s0 = validateStep(seq, 0, seqFen, 'd5e7');
    expect(s0.kind).toBe('continue');
    if (s0.kind !== 'continue') return;
    expect(s0.opponentMove).toBe('g8f8');
    const f1 = applyUci(applyUci(seqFen, 'd5e7')!, 'g8f8')!;
    expect(validateStep(seq, 1, f1, 'e7c8').kind).toBe('solved');
    expect(validateStep(seq, 1, f1, 'g1h1').kind).toBe('incorrect');
  });

  it('judges unknown moves with a fresh engine evaluation and the tolerance', () => {
    const ex = exercise();
    const pa = (s: Score): PositionAnalysis => ({ fen: 'x', depth: 14, multiPv: 1, lines: [{ multipv: 1, score: s, pv: [], depth: 14 }], complete: true, timeMs: 1 });
    expect(judgeWithEngine(ex, pa(cp(40))).accepted).toBe(true);
    expect(judgeWithEngine(ex, pa(cp(-150))).accepted).toBe(false);
    expect(judgeWithEngine(ex, { ...pa(cp(40)), complete: false }).accepted).toBe(false);
  });

  it('offers progressive hints', () => {
    const ex = exercise();
    expect(hintFor(ex, 1).square).toBeUndefined();
    expect(hintFor(ex, 2).square).toBe('f1');
    expect(hintFor(ex, 3).text).toContain('Bc4');
  });
});

describe('spaced repetition', () => {
  const now = 1_000_000;
  it('brings failures back soon and resets the box', () => {
    const s = nextSrs({ box: 3, dueAt: 0 }, 'fail', now);
    expect(s).toMatchObject({ box: 0, dueAt: now + RETRY_DELAY_MS });
  });
  it('promotes independent successes with growing intervals', () => {
    const a = nextSrs({ box: 0, dueAt: 0 }, 'independent', now);
    const b = nextSrs(a, 'independent', now);
    expect(a.box).toBe(1);
    expect(a.dueAt - now).toBe(1 * DAY_MS);
    expect(b.dueAt - now).toBe(3 * DAY_MS);
  });
  it('records hint-assisted solutions separately without promotion', () => {
    const s = nextSrs({ box: 2, dueAt: 0 }, 'assisted', now);
    expect(s.box).toBe(2);
    expect(s.dueAt - now).toBe(3.5 * DAY_MS);
    expect(outcomeOf(true, 1, false)).toBe('assisted');
    expect(outcomeOf(true, 0, true)).toBe('fail');
    expect(outcomeOf(true, 0, false)).toBe('independent');
  });
});

describe('first hint carries information (audit A5)', () => {
  const objective = 'Encontre o melhor lance nesta posição.';
  const first = (fen: string, uci: string) => hintForNode(fen, objective, [{ uci, san: uci }], 1);

  it('never repeats the objective and never names the square', () => {
    const cases: [string, string, RegExp][] = [
      ['6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8', /xeque-mate/],
      ['4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', 'a1a8', /dá xeque/],
      ['4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1', 'd2d5', /captura/],
      ['r3k3/8/8/8/8/8/2N5/4K3 w - - 0 1', 'c2b4', /tranquilo/],
      ['4k3/8/3r1q2/8/8/8/3N4/4K3 w - - 0 1', 'd2e4', /duas peças/],
      ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'g1f3', /cavalo/],
    ];
    for (const [fen, uci, expected] of cases) {
      const h = first(fen, uci);
      expect(h.text).not.toContain(objective);
      expect(h.text).toMatch(expected);
      expect(h.square).toBeUndefined();
      expect(h.text).not.toContain(uci.slice(2, 4));
    }
  });

  it('keeps the piece for hint 2 and the move for hint 3', () => {
    const fen = '4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1';
    expect(hintForNode(fen, objective, [{ uci: 'd2d5', san: 'Rxd5' }], 2).square).toBe('d2');
    expect(hintForNode(fen, objective, [{ uci: 'd2d5', san: 'Rxd5' }], 3).text).toContain('Rxd5');
  });
});

describe('Sprint 3: exercise quality', () => {
  const objective = 'Encontre o melhor lance nesta posição.';

  it('hint 1 agrees in gender and does not name a piece the solver has only one of', () => {
    // A single queen: naming it would point at the piece exactly like hint 2.
    const lone = hintForNode('4k3/8/8/8/8/8/8/3QK3 w - - 0 1', objective, [{ uci: 'd1d7', san: 'Qd7+' }], 1).text;
    const quietQueen = hintForNode('k7/8/8/8/8/8/8/3QK3 w - - 0 1', objective, [{ uci: 'd1d2', san: 'Qd2' }], 1).text;
    expect(lone).not.toMatch(/de a dama|da dama/);
    expect(quietQueen).not.toMatch(/dama/);
    const rooks = hintForNode('1k6/8/8/8/8/8/8/R3K2R w KQ - 0 1', objective, [{ uci: 'h1h2', san: 'Rh2' }], 1).text;
    expect(rooks).toMatch(/de uma torre/);
  });

  it('the same position reached at another move number is not a new exercise', () => {
    const review = reviewMove(nd4, before, { ...before, fen: nd4.fenAfter, lines: [{ multipv: 1, depth: 16, score: cp(-300), pv: ['f3e5'] }] })!;
    const otherCounters = review.fenBefore.replace(/ \d+ \d+$/, ' 0 17');
    expect(selectExercisePositions(game, [review], [null, null, null, null, before], { max: 5, existingFens: new Set([otherCounters]) })).toHaveLength(0);
    // And a repeated position inside one game yields a single exercise.
    expect(selectExercisePositions(game, [review, { ...review, ply: 9 }], [null, null, null, null, before, null, null, null, before], { max: 5 })).toHaveLength(1);
  });

  it('a sacrifice is rated harder than the same pattern without giving material', () => {
    // Qh6+!! Kxh6 then Bxf6#: the queen is given away with check.
    const fen = 'r1bq2r1/b4pk1/p1pp1p2/1p2pP2/1P2P1PB/3P4/1PPQ2P1/R3K2R w - - 0 1';
    expect(isSacrifice(fen, 'd2h6')).toBe(true);
    expect(isSacrifice('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1', 'd2d5')).toBe(false);
    expect(estimateDifficulty(fen, ['d2h6', 'g7h6', 'h4f6'], 'missed_mate', 1)).toBeGreaterThanOrEqual(4);
  });
});

describe('the hint that names the move counts as a revealed solution (Sprint 4.4, E2)', () => {
  const NOW = 1_000_000_000;
  const recorded = (correct: boolean, revealed: boolean, hints: number) => {
    const r = attemptResult(correct, revealed, hints);
    return { ...r, credit: exerciseOutcome({ ...r, hintsUsed: hints }), srs: nextSrs({ box: 3, dueAt: NOW }, outcomeOf(r.correct, hints, r.revealed), NOW) };
  };

  it('solving after the last hint records a revealed attempt: no credit, back in 10 minutes', () => {
    const r = recorded(true, false, MAX_HINTS);
    expect(r).toMatchObject({ correct: false, revealed: true, credit: 0 });
    expect(r.srs).toEqual({ box: 0, dueAt: NOW + RETRY_DELAY_MS, lastReviewedAt: NOW });
  });

  it('hints 1 and 2 still count as an assisted success with partial credit', () => {
    for (const hints of [1, 2]) {
      const r = recorded(true, false, hints);
      expect(r).toMatchObject({ correct: true, revealed: false, credit: 1 - 0.25 * hints });
      expect(r.srs.box).toBe(3); // assisted: box unchanged
      expect(r.srs.dueAt).toBeGreaterThanOrEqual(NOW + DAY_MS);
    }
  });

  it('without hints, failures and reveals are unchanged', () => {
    expect(attemptResult(true, false, 0)).toEqual({ correct: true, revealed: false });
    expect(attemptResult(false, false, 0)).toEqual({ correct: false, revealed: false });
    expect(attemptResult(false, true, 1)).toEqual({ correct: false, revealed: true });
  });

  it('the last hint is the one that names the move', () => {
    const accepted = [{ uci: 'a1a7', san: 'Ra7' }];
    const fen = '6k1/5ppp/8/8/8/8/1Q6/R5K1 w - - 0 1';
    expect(hintForNode(fen, 'x', accepted, MAX_HINTS - 1).text).not.toContain('Ra7');
    expect(hintForNode(fen, 'x', accepted, MAX_HINTS).text).toContain('Ra7');
  });
});
