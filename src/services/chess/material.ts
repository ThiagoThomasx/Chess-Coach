import { Chess, type Square, type PieceSymbol } from 'chess.js';
import type { Color } from '../../types/domain';
import { parseUci } from './position';

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const PIECE_NAME_PT: Record<PieceSymbol, string> = {
  p: 'peão',
  n: 'cavalo',
  b: 'bispo',
  r: 'torre',
  q: 'dama',
  k: 'rei',
};

export interface MaterialCount {
  w: number;
  b: number;
}

export function materialOf(fen: string): MaterialCount {
  const chess = new Chess(fen);
  const total: MaterialCount = { w: 0, b: 0 };
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq) total[sq.color] += PIECE_VALUE[sq.type];
    }
  }
  return total;
}

/** Material balance from `color`'s perspective (own minus opponent). */
export function materialBalance(fen: string, color: Color): number {
  const m = materialOf(fen);
  return color === 'w' ? m.w - m.b : m.b - m.w;
}

/** Non-pawn, non-king material on the board (both sides). */
export function nonPawnMaterial(fen: string): number {
  const chess = new Chess(fen);
  let sum = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.type !== 'p' && sq.type !== 'k') sum += PIECE_VALUE[sq.type];
    }
  }
  return sum;
}

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

/** Heuristic phase: opening for the first 20 plies with most material, endgame when ≤ 13 points of pieces remain. */
export function gamePhase(fen: string, ply: number): GamePhase {
  const npm = nonPawnMaterial(fen);
  if (npm <= 13) return 'endgame';
  if (ply <= 20 && npm >= 50) return 'opening';
  return 'middlegame';
}

/**
 * Material change for `color` after playing a UCI line from `fen`.
 * Returns the delta and how many plies were actually legal.
 */
export function materialSwingAlongLine(fen: string, line: readonly string[], color: Color, maxPlies = 8): { delta: number; plies: number } {
  const chess = new Chess(fen);
  const start = materialBalance(fen, color);
  let plies = 0;
  for (const uci of line.slice(0, maxPlies)) {
    try {
      chess.move(parseUci(uci));
      plies++;
    } catch {
      break;
    }
  }
  return { delta: materialBalance(chess.fen(), color) - start, plies };
}

export function pieceAt(fen: string, square: Square): { type: PieceSymbol; color: Color } | null {
  const p = new Chess(fen).get(square);
  return p ? { type: p.type, color: p.color } : null;
}
