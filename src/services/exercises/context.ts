import type { Game } from '../../types/domain';
import { replayGame, type PlyInfo } from '../chess/position';

/** Board placement, side to move, castling and en passant: what identifies a position. */
const positionKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

/**
 * The move that led into an exercise taken from a game at `ply` (1-based ply of
 * the move to find). Returned only when the replayed position matches the
 * exercise FEN, so the board never highlights a move that did not happen.
 */
export function lastMoveBefore(game: Pick<Game, 'moves' | 'startFen'> | undefined, ply: number | undefined, fen: string): PlyInfo | null {
  if (!game || !ply || ply < 2) return null;
  let plies: PlyInfo[];
  try {
    plies = replayGame(game.moves.slice(0, ply - 1), game.startFen);
  } catch {
    return null;
  }
  const prev = plies[ply - 2];
  return prev && positionKey(prev.fenAfter) === positionKey(fen) ? prev : null;
}
