import type { Attempt, Exercise, Theme } from '../../src/types/domain';

/** Minimal valid exercise (back-rank mate in one) with overridable fields. */
export function mkExercise(id: string, over: Partial<Exercise> = {}): Exercise {
  return {
    id,
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    source: 'game',
    sideToMove: 'w',
    objective: 'Encontre o melhor lance.',
    theme: 'hanging_piece' as Theme,
    skill: 'tactics',
    bestMove: { uci: 'a1a8', san: 'Ra8#', score: { kind: 'mate', value: 1 } },
    acceptableMoves: [{ uci: 'a1a8', san: 'Ra8#', score: { kind: 'mate', value: 1 } }],
    solutionLine: ['a1a8'],
    referenceLines: [],
    difficulty: 2,
    ambiguous: false,
    tolerance: 5,
    createdAt: 1,
    srs: { box: 0, dueAt: Number.MAX_SAFE_INTEGER },
    analysisDepth: 16,
    ...over,
  };
}

export type Kind = 'independent' | 'assisted' | 'fail' | 'revealed';

export function mkAttempt(exerciseId: string, at: number, kind: Kind): Attempt {
  return {
    exerciseId,
    at,
    correct: kind === 'independent' || kind === 'assisted',
    hintsUsed: kind === 'assisted' ? 1 : 0,
    revealed: kind === 'revealed',
    timeMs: 10_000,
    moves: [],
  };
}
