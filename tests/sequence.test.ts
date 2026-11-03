import { describe, expect, it } from 'vitest';
import { goalFor, legacyTree, mainLine, mateBudget, normalizeExercise, playSolverMove, type SolveState } from '../src/services/exercises/sequence';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import { applyUci, terminalState } from '../src/services/chess/position';
import { mateInOne } from '../src/services/chess/tactics';
import type { Exercise, ExerciseGoal, Score, SolutionNode } from '../src/types/domain';

const mate = (n: number): Score => ({ kind: 'mate', value: n });
const cp = (v: number): Score => ({ kind: 'cp', value: v });

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
