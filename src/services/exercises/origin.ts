// Links between a game's analysis and the exercises derived from it (Sprint 4.6, B2).
//
// The association is the one the exercise already stores: `source: 'game'`,
// `gameId` (indexed) and `ply` (the move played in the game; the exercise
// position is the one before it). No parallel table and no FEN lookup decide
// it: the FEN only *checks* that a stored ply still points at the exercise's
// position, so a broken reference is dropped instead of opening the wrong move.

import type { Color, Exercise, Game, MoveClass, MoveReview } from '../../types/domain';
import { replayGame, sideToMove } from '../chess/position';
import { fenKey } from '../analysis/gameAnalyzer';

/** Analysis route of a game's move: the existing `?ply=` parameter opens the position after it, with its review. */
export function analysisHref(gameId: string, ply: number): string {
  return `/analysis/${encodeURIComponent(gameId)}?ply=${ply}`;
}

export function exerciseHref(exerciseId: string): string {
  return `/train/${encodeURIComponent(exerciseId)}`;
}

/** The game reference an exercise stores, or null when it does not come from a game. */
export function gameRef(ex: Pick<Exercise, 'source' | 'gameId' | 'ply'>): { gameId: string; ply: number } | null {
  if (ex.source !== 'game' || !ex.gameId || !Number.isInteger(ex.ply) || (ex.ply ?? 0) < 1) return null;
  return { gameId: ex.gameId, ply: ex.ply as number };
}

/**
 * Exercise id per ply of this game. `fens[i]` is the position after i plies
 * (fens[0] = start). An exercise counts only when it belongs to this game, its
 * ply is a move of the game and the position before that move is the
 * exercise's own (move counters ignored); anything else is not linked.
 */
export function linkedExercisesByPly(exercises: readonly Exercise[], gameId: string, fens: readonly string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const ex of exercises) {
    const ref = gameRef(ex);
    if (!ref || ref.gameId !== gameId || ref.ply >= fens.length) continue;
    const before = fens[ref.ply - 1];
    if (before === undefined || fenKey(before) !== fenKey(ex.fen)) continue;
    // Positions are unique per exercise (addExercise), so a second one here would be a corrupted record: keep the first read.
    if (!out.has(ref.ply)) out.set(ref.ply, ex.id);
  }
  return out;
}

/** The origin is shown only once the attempt is solved or the solution revealed: before, it would give the answer away. */
export function isOriginVisible(status: string): boolean {
  return status === 'solved' || status === 'revealed';
}

/** Move number label as the analysis shows it: "3. Nd4" for White, "3… exd4" for Black. */
export function moveLabel(startFen: string, ply: number, color: Color, san: string): string {
  const first = Number(startFen.split(' ')[5] ?? '1') || 1;
  const blackOffset = sideToMove(startFen) === 'b' ? 1 : 0;
  return `${first + Math.floor((ply - 1 + blackOffset) / 2)}${color === 'w' ? '.' : '…'} ${san}`;
}

export type OriginMover = 'you' | 'opponent' | 'unknown';

export interface ExerciseOrigin {
  gameId: string;
  ply: number;
  /** "Aluno × Rival". */
  gameTitle: string;
  date?: string;
  /** The move played in the game at the exercise position, e.g. "3. Nd4". */
  playedLabel: string;
  mover: OriginMover;
  /** From the game's stored analysis, only when its review is for this same position. */
  classification?: MoveClass;
  winLoss?: number;
  bestSan?: string;
  href: string;
}

/**
 * What the exercise's origin can say from stored data only: the game, the
 * move played there and, when the analysis review matches the position, its
 * classification, loss and best move. Null when the exercise has no game,
 * the game is gone, or its stored ply no longer leads to the exercise position
 * (then a link would open the wrong move).
 */
export function exerciseOrigin(ex: Exercise, game: Game | undefined, review: MoveReview | undefined): ExerciseOrigin | null {
  const ref = gameRef(ex);
  if (!ref || !game || game.id !== ref.gameId || ref.ply > game.moves.length) return null;
  let played: { san: string; color: Color; fenBefore: string } | undefined;
  try {
    played = replayGame(game.moves.slice(0, ref.ply), game.startFen)[ref.ply - 1];
  } catch {
    return null;
  }
  if (!played || fenKey(played.fenBefore) !== fenKey(ex.fen)) return null;
  const matching = review && review.ply === ref.ply && fenKey(review.fenBefore) === fenKey(ex.fen) ? review : undefined;
  const mover: OriginMover = !game.userColor ? 'unknown' : game.userColor === played.color ? 'you' : 'opponent';
  const bestSan = matching?.bestMoveSan ?? ex.bestMove?.san;
  return {
    gameId: ref.gameId,
    ply: ref.ply,
    gameTitle: `${game.headers.white} × ${game.headers.black}`,
    ...(game.headers.date ? { date: game.headers.date } : {}),
    playedLabel: moveLabel(game.startFen, ref.ply, played.color, played.san),
    mover,
    ...(matching ? { classification: matching.classification, winLoss: matching.winLoss } : {}),
    ...(bestSan && bestSan !== played.san ? { bestSan } : {}),
    href: analysisHref(ref.gameId, ref.ply),
  };
}
