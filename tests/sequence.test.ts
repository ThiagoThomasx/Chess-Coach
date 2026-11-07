import { describe, expect, it } from 'vitest';
import { defenseRepliesFrom, goalFor, legacyTree, mainLine, mateBudget, normalizeExercise, playSolverMove, UNCERTAIN_MARGIN, type SolveState } from '../src/services/exercises/sequence';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import { withSolutionTree } from '../src/services/exercises/generate';
import { Chess } from 'chess.js';
import { applyUci, terminalState } from '../src/services/chess/position';
import { mateInOne } from '../src/services/chess/tactics';
import type { Exercise, ExerciseGoal, Score, SolutionNode } from '../src/types/domain';

const mate = (n: number): Score => ({ kind: 'mate', value: n });
const cp = (v: number): Score => ({ kind: 'cp', value: v });
const legalUcis = (fen: string): string[] => new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));

// Two rooks vs king: 1.Ra7 or 1.Rb7 mate in two; Black has two king moves (Kf8, Kh8).
const ROOKS = '6k1/8/8/8/8/8/1R6/R5K1 w - - 0 1';

function leaf(fen: string): SolutionNode {
  // The mating moves of each leaf are computed exactly by chess.js, not invented.
  return { fen, accepted: mateInOne(fen).map((u) => ({ uci: u, san: u, score: mate(1) })), replies: {}, depth: 99 };
}

function rooksTree(): SolutionNode {
  const branchesAfter = (userUci: string) => {
    const after = applyUci(ROOKS, userUci) as string;
    return ['g8f8', 'g8h8'].map((r) => ({ uci: r, san: r === 'g8f8' ? 'Kf8' : 'Kh8', score: mate(1), next: leaf(applyUci(after, r) as string) }));
  };
  return {
    fen: ROOKS,
    accepted: [
      { uci: 'a1a7', san: 'Ra7', score: mate(2) },
      { uci: 'b2b7', san: 'Rb7', score: mate(2) },
    ],
    replies: { a1a7: branchesAfter('a1a7'), b2b7: branchesAfter('b2b7') },
    depth: 99,
  };
}

function exercise(over: Partial<Exercise> = {}): Exercise & { goal: ExerciseGoal } {
  const goal: ExerciseGoal = { kind: 'mate', maxUserMoves: 2, targetWin: 100, mateIn: 2 };
  return {
    id: 'x',
    fen: ROOKS,
    source: 'game',
    sideToMove: 'w',
    objective: 'Encontre o mate em 2.',
    theme: 'missed_mate',
    skill: 'patterns',
    bestMove: { uci: 'a1a7', san: 'Ra7', score: mate(2) },
    acceptableMoves: [],
    solutionLine: ['a1a7', 'g8f8', 'b2b8'],
    referenceLines: [],
    difficulty: 3,
    ambiguous: true,
    tolerance: 5,
    createdAt: 0,
    srs: { box: 0, dueAt: 0 },
    analysisDepth: 16,
    kind: 'mate',
    goal,
    tree: rooksTree(),
    ...over,
  } as Exercise & { goal: ExerciseGoal };
}

const start = (ex: Exercise): SolveState => ({ node: ex.tree as SolutionNode, userMoves: 0, fen: ex.fen });
const deps = (choose: number) => ({ depth: 12, tolerance: 5, choose: () => choose });

describe('fixture facts', () => {
  it('the leaves really are mate in one', () => {
    for (const b of rooksTree().replies.a1a7 ?? []) expect(b.next?.accepted.map((m) => m.uci)).toEqual(['b2b8']);
  });
});

describe('sequence exercises', () => {
  it('does not end after the first correct move of a sequence', async () => {
    const v = await playSolverMove(exercise(), start(exercise()), 'a1a7', deps(0));
    expect(v.kind).toBe('continue');
  });

  it('plays different opponent replies and validates the continuation of each', async () => {
    const ex = exercise();
    const seen = new Set<string>();
    for (const pick of [0, 1]) {
      const v1 = await playSolverMove(ex, start(ex), 'a1a7', deps(pick));
      if (v1.kind !== 'continue') throw new Error('expected continue');
      seen.add(v1.reply.san);
      const v2 = await playSolverMove(ex, v1.state, 'b2b8', deps(pick));
      expect(v2.kind).toBe('solved');
      if (v2.kind === 'solved') expect(terminalState(v2.fen)).toBe('checkmate');
    }
    expect(seen).toEqual(new Set(['Kf8', 'Kh8']));
  });

  it('accepts an equivalent first move and keeps validating its own continuation', async () => {
    const ex = exercise();
    const v1 = await playSolverMove(ex, start(ex), 'b2b7', deps(0));
    if (v1.kind !== 'continue') throw new Error('expected continue');
    expect(v1.message).toContain('alternativa');
    // After Rb7, the mate is Ra8#, not Rb8 (the main line's finisher).
    expect((await playSolverMove(ex, v1.state, 'a1a8', deps(0))).kind).toBe('solved');
  });

  it('rejects a wrong second move in the forced line', async () => {
    const ex = exercise();
    const v1 = await playSolverMove(ex, start(ex), 'a1a7', deps(0));
    if (v1.kind !== 'continue') throw new Error('expected continue');
    const v2 = await playSolverMove(ex, v1.state, 'g1g2', { ...deps(0), engine: undefined });
    expect(v2.kind).toBe('unverifiable'); // without the engine, an unlisted move is never guessed
  });

  it('rejects a move that stalemates instead of mating (no engine needed)', async () => {
    const fen = '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1';
    expect(terminalState(applyUci(fen, 'f1f7') as string)).toBe('stalemate');
    const ex = exercise({ fen, tree: leaf(fen), goal: { kind: 'mate', maxUserMoves: 1, targetWin: 100, mateIn: 1 } });
    const v = await playSolverMove(ex, start(ex), 'f1f7', deps(0));
    expect(v.kind).toBe('rejected');
    expect((await playSolverMove(ex, start(ex), 'f1f8', deps(0))).kind).toBe('solved');
  });

  it('ends at the goal move limit (single-move exercise)', async () => {
    const ex = exercise({ goal: { kind: 'single', maxUserMoves: 1, targetWin: 100 } });
    expect((await playSolverMove(ex, start(ex), 'a1a7', deps(0))).kind).toBe('solved');
  });

  it('reports illegal moves', async () => {
    expect((await playSolverMove(exercise(), start(exercise()), 'a1h8', deps(0))).kind).toBe('illegal');
  });

  it('extracts the main line for demonstrations', () => {
    expect(mainLine(rooksTree())).toEqual(['a1a7', 'g8f8', 'b2b8']);
  });
});

describe('goals and legacy exercises', () => {
  it('derives the goal from verifiable data', () => {
    expect(goalFor(ROOKS, { score: mate(2), pv: ['a1a7', 'g8f8', 'b2b8'] }, 'missed_mate', 5)).toMatchObject({ kind: 'mate', maxUserMoves: 2, mateIn: 2 });
    // Ne7+ Kf8 Nxc8: a settled 9-point gain needs two user moves.
    expect(goalFor('2q3k1/8/8/3N4/8/8/8/6K1 w - - 0 1', { score: cp(900), pv: ['d5e7', 'g8f8', 'e7c8', 'f8e8'] }, 'fork', 5)).toMatchObject({ kind: 'sequence', maxUserMoves: 2 });
    expect(goalFor(ROOKS, { score: cp(20), pv: ['g1g2'] }, 'hanging_piece', 5).kind).toBe('defense');
    expect(goalFor('4k3/pp6/8/8/8/8/PP2Q3/4K3 w - - 0 1', { score: cp(900), pv: ['e2b5'] }, 'positional', 5).kind).toBe('conversion');
  });

  it('measures the sequence up to the ply where the gain happens, not the measuring horizon (A4)', () => {
    // Free queen: Rxd5 wins it at once; the following king moves are not part of the task.
    expect(goalFor('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1', { score: cp(900), pv: ['d2d5', 'e8e7', 'e1d2', 'e7f6', 'd2e3'] }, 'missed_capture', 5)).toMatchObject({ kind: 'single', maxUserMoves: 1 });
    // Two checks, then the rook falls: three user moves.
    expect(goalFor('7k/8/8/r7/8/8/8/3Q3K w - - 0 1', { score: cp(900), pv: ['d1d4', 'h8g8', 'd4d8', 'g8f7', 'd8a5', 'f7e6'] }, 'combination', 5)).toMatchObject({ kind: 'sequence', maxUserMoves: 3 });
  });

  it("an opponent's motif makes a defensive goal (M1)", () => {
    expect(goalFor('3qk3/8/8/8/3n4/8/2Q5/R3K3 w Q - 0 1', { score: cp(0), pv: ['e1f1'] }, 'fork', 5, 'opponent').kind).toBe('defense');
  });

  it('keeps the analysis main move first when the tree search ties it with another (B5)', async () => {
    const engine: EngineLike = {
      analyze: async ({ fen }) => {
        const lines =
          fen === ROOKS
            ? [{ multipv: 1, depth: 16, score: mate(2), pv: ['b2b7'] }, { multipv: 2, depth: 16, score: mate(2), pv: ['a1a7'] }]
            : (mateInOne(fen).length ? mateInOne(fen) : legalUcis(fen)).map((u, i) => ({ multipv: i + 1, depth: 16, score: mate(1), pv: [u] }));
        return { fen, depth: 16, multiPv: lines.length, timeMs: 0, complete: true, lines } as never;
      },
    } as EngineLike;
    const ex = exercise({ goal: undefined, tree: undefined, kind: undefined, referenceLines: [{ multipv: 1, depth: 16, score: mate(2), pv: ['a1a7', 'g8f8', 'b2b8'] }] });
    const built = await withSolutionTree(ex, engine, { depth: 16, multiPv: 3, tolerance: 5 });
    expect(built.tree?.accepted[0]?.uci).toBe('a1a7');
    expect(built.bestMove.uci).toBe('a1a7');
    expect(built.solutionLine[0]).toBe('a1a7');
  });

  it('converts a v1 exercise (single line) into a tree', () => {
    const legacy = exercise({ kind: undefined, goal: undefined, tree: undefined, acceptableMoves: [{ uci: 'a1a7', san: 'Ra7', score: mate(2) }] });
    const n = normalizeExercise(legacy);
    expect(n.kind).toBe('mate');
    expect(n.goal.maxUserMoves).toBe(2);
    expect(mainLine(n.tree)).toEqual(['a1a7', 'g8f8', 'b2b8']);
    expect(legacyTree({ ...legacy, solutionLine: ['a1a7'] }).replies).toEqual({});
  });
});

describe('long mates (audit C1)', () => {
  const LONG: ExerciseGoal = { kind: 'mate', maxUserMoves: 4, targetWin: 100, mateIn: 6 };

  it('keeps the full mate distance as the budget, not the 4-move limit', () => {
    expect(mateBudget(LONG, 0)).toBe(6);
    expect(mateBudget(LONG, 3)).toBe(3);
    expect(mateBudget({ kind: 'mate', maxUserMoves: 2, targetWin: 100 }, 1)).toBe(1);
  });

  it('repairs a stored tree with an empty root from the accepted moves', () => {
    const accepted = [{ uci: 'a1a7', san: 'Ra7', score: mate(2) }];
    const broken = exercise({ acceptableMoves: accepted, tree: { fen: ROOKS, accepted: [], replies: {}, depth: 16 } });
    expect(normalizeExercise(broken).tree.accepted).toEqual(accepted);
  });

  it('verifies a move from an empty node with the engine instead of claiming it is unavailable', async () => {
    const engine: EngineLike = {
      analyze: async ({ fen }) => ({ fen, depth: 12, multiPv: 1, timeMs: 0, complete: true, lines: [{ multipv: 1, depth: 12, score: mate(2), pv: ['a1a7'] }] }) as never,
    } as EngineLike;
    const ex = exercise();
    const v = await playSolverMove(ex, { node: { fen: ROOKS, accepted: [], replies: {}, depth: 0 }, userMoves: 0, fen: ROOKS }, 'a1a7', { engine, depth: 12, tolerance: 5 });
    expect(v.kind).not.toBe('unverifiable');
  });
});

describe('opponent replies are real defenses (Sprint 3)', () => {
  // Black to move, being mated: win% is 0 for every reply, so it cannot rank them.
  const FEN = '8/8/8/8/8/4k3/8/3QR1K1 b - - 0 1';
  const analysis = (lines: [string, Score][]) => ({ fen: FEN, depth: 16, multiPv: lines.length, timeMs: 0, complete: true, lines: lines.map(([u, s], i) => ({ multipv: i + 1, depth: 16, score: s, pv: [u] })) });

  it('keeps only the longest mate when every reply loses', () => {
    // White POV: mate 3 = Black mated in 3 (best defense), mate 2 = faster mate.
    const r = defenseRepliesFrom(analysis([['e3f3', mate(3)], ['e3f4', mate(2)]]) as never, 5);
    expect(r.map((m) => m.uci)).toEqual(['e3f3']);
  });

  it('drops a reply that loses material even when win% has saturated', () => {
    // From Black's POV both are hopeless (~2.5% vs ~0.5%): within 5 p.p., but 4 pawns apart.
    const r = defenseRepliesFrom(analysis([['e3f3', cp(900)], ['e3f4', cp(1300)], ['e3f2', cp(930)]]) as never, 5);
    expect(r.map((m) => m.uci)).toEqual(['e3f3', 'e3f2']);
  });
});

describe('judging moves outside the tree (Sprint 3)', () => {
  const single: ExerciseGoal = { kind: 'single', maxUserMoves: 1, targetWin: 60 };
  const node: SolutionNode = { fen: ROOKS, accepted: [{ uci: 'a1a7', san: 'Ra7', score: cp(60) }], replies: {}, depth: 16 };
  const state: SolveState = { node, userMoves: 0, fen: ROOKS };
  /** Engine that honours searchmoves with fixed scores per root move. */
  const engineWith = (scores: Record<string, number>, calls: { searchMoves?: string[]; depth?: number }[] = []): EngineLike => ({
    analyze: async (req) => {
      calls.push({ searchMoves: req.searchMoves, depth: req.depth });
      const moves = req.searchMoves ?? Object.keys(scores);
      const lines = moves.map((u) => ({ multipv: 0, depth: req.depth ?? 12, score: cp(scores[u] ?? 0), pv: [u] })).sort((a, b) => b.score.value - a.score.value).map((l, i) => ({ ...l, multipv: i + 1 }));
      return { fen: req.fen, depth: req.depth ?? 12, multiPv: lines.length, timeMs: 0, complete: true, lines } as never;
    },
  });

  it('compares both moves inside one search (searchmoves), not against a stored score from another search', async () => {
    // The stored score (60) is stale: in the same search Ra7 and Kh1 are equal, so Kh1 is accepted.
    const calls: { searchMoves?: string[] }[] = [];
    const v = await playSolverMove(exercise({ goal: single, kind: 'single' }), state, 'g1h1', { engine: engineWith({ a1a7: 20, g1h1: 15 }, calls), depth: 12, tolerance: 5 });
    expect(v.kind).toBe('solved');
    expect(calls[0]?.searchMoves).toEqual(['a1a7', 'g1h1']);
  });

  it('a borderline move is re-checked deeper and reported as uncertain, not as an error', async () => {
    // 70 cp vs 0 cp ≈ 6.4 p.p.: just above the 5 p.p. tolerance, inside the uncertainty band.
    const calls: { depth?: number }[] = [];
    const v = await playSolverMove(exercise({ goal: single, kind: 'single' }), state, 'g1h1', { engine: engineWith({ a1a7: 70, g1h1: 0 }, calls), depth: 12, tolerance: 5 });
    expect(v.kind).toBe('uncertain');
    if (v.kind === 'uncertain') expect(v.winLoss).toBeGreaterThan(5);
    if (v.kind === 'uncertain') expect(v.winLoss).toBeLessThanOrEqual(5 + UNCERTAIN_MARGIN);
    expect(calls.map((c) => c.depth)).toContain(16);
  });

  it('a clearly worse move is still rejected', async () => {
    const v = await playSolverMove(exercise({ goal: single, kind: 'single' }), state, 'g1h1', { engine: engineWith({ a1a7: 300, g1h1: 0 }), depth: 12, tolerance: 5 });
    expect(v.kind).toBe('rejected');
  });
});

describe('verdicts carry the measured scores for the move badge (Sprint 4.2)', () => {
  const single: ExerciseGoal = { kind: 'single', maxUserMoves: 1, targetWin: 60 };
  const node: SolutionNode = { fen: ROOKS, accepted: [{ uci: 'a1a7', san: 'Ra7', score: cp(60) }], replies: {}, depth: 16 };
  const state: SolveState = { node, userMoves: 0, fen: ROOKS };
  const engineWith = (scores: Record<string, number>): EngineLike => ({
    analyze: async (req) => {
      const moves = req.searchMoves ?? Object.keys(scores);
      const lines = moves.map((u) => ({ multipv: 0, depth: req.depth ?? 12, score: cp(scores[u] ?? 0), pv: [u] })).sort((a, b) => b.score.value - a.score.value).map((l, i) => ({ ...l, multipv: i + 1 }));
      return { fen: req.fen, depth: req.depth ?? 12, multiPv: lines.length, timeMs: 0, complete: true, lines } as never;
    },
  });

  it('a move from the stored tree is assessed against the node best, at the node depth', async () => {
    const ex = exercise();
    const v = await playSolverMove(ex, start(ex), 'b2b7', deps(0));
    expect(v.kind === 'continue' && v.assessment).toEqual({ reference: mate(2), played: mate(2), depth: 99 });
  });

  it('an engine-verified move is assessed with the scores of the same search', async () => {
    const v = await playSolverMove(exercise({ goal: single, kind: 'single' }), state, 'g1h1', { engine: engineWith({ a1a7: 20, g1h1: 15 }), depth: 12, tolerance: 5 });
    expect(v.kind === 'solved' && v.assessment).toEqual({ reference: cp(20), played: cp(15), depth: 12 });
  });

  it('a rejected move carries its scores too', async () => {
    const v = await playSolverMove(exercise({ goal: single, kind: 'single' }), state, 'g1h1', { engine: engineWith({ a1a7: 300, g1h1: 0 }), depth: 12, tolerance: 5 });
    expect(v.kind === 'rejected' && v.assessment).toEqual({ reference: cp(300), played: cp(0), depth: 12 });
  });

  it('checkmate is assessed as the best move', async () => {
    const fen = '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1';
    const ex = exercise({ fen, tree: leaf(fen), goal: { kind: 'mate', maxUserMoves: 1, targetWin: 100, mateIn: 1 } });
    const v = await playSolverMove(ex, start(ex), 'f1f8', deps(0));
    if (v.kind !== 'solved' || !v.assessment) throw new Error('expected an assessed solved verdict');
    expect(v.assessment.played).toEqual(v.assessment.reference);
    expect(v.assessment.played.kind).toBe('mate');
  });
});

describe('a solved verdict that ends with an opponent reply names the reply (Sprint 4.2 review)', () => {
  it('returns the reply so the board can highlight it', async () => {
    const after = applyUci(ROOKS, 'a1a7') as string;
    const node: SolutionNode = {
      fen: ROOKS,
      accepted: [{ uci: 'a1a7', san: 'Ra7', score: mate(2) }],
      replies: { a1a7: [{ uci: 'g8f8', san: 'Kf8', score: mate(1), next: null }] },
      depth: 99,
    };
    const ex = exercise({ tree: node, goal: { kind: 'sequence', maxUserMoves: 2, targetWin: 100 }, kind: 'sequence' });
    const v = await playSolverMove(ex, start(ex), 'a1a7', deps(0));
    if (v.kind !== 'solved') throw new Error('expected solved');
    expect(v.reply).toEqual({ uci: 'g8f8', san: 'Kf8' });
    expect(v.fen).toBe(applyUci(after, 'g8f8'));
  });

  it('has no reply when the user move itself ends the exercise', async () => {
    const ex = exercise({ goal: { kind: 'single', maxUserMoves: 1, targetWin: 100 } });
    const v = await playSolverMove(ex, start(ex), 'a1a7', deps(0));
    expect(v.kind === 'solved' && v.reply).toBeFalsy();
  });
});
