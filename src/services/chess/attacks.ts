import { Chess, type Square, type PieceSymbol } from 'chess.js';
import type { Color } from '../../types/domain';
import { PIECE_VALUE } from './material';

export interface PieceOnSquare {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

export interface Vulnerability extends PieceOnSquare {
  attackers: Square[];
  defenders: Square[];
  /** Value of the cheapest attacker. */
  cheapestAttacker: number;
  /** 'undefended': attacked and no defender; 'cheaper_attacker': attacked by a lower-value piece. */
  reason: 'undefended' | 'cheaper_attacker';
}

const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function piecesOf(fen: string, color: Color): PieceOnSquare[] {
  const chess = new Chess(fen);
  const out: PieceOnSquare[] = [];
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.color === color) out.push({ square: sq.square, type: sq.type, color: sq.color });
    }
  }
  return out;
}

/**
 * Pieces of `color` that are attacked and either undefended or attacked by a
 * cheaper piece. Geometric only (ignores pins); callers must confirm with the
 * engine line before claiming material is actually lost.
 */
export function vulnerablePieces(fen: string, color: Color): Vulnerability[] {
  const chess = new Chess(fen);
  const enemy = opposite(color);
  const out: Vulnerability[] = [];
  for (const p of piecesOf(fen, color)) {
    if (p.type === 'k') continue;
    const attackers = chess.attackers(p.square, enemy);
    if (attackers.length === 0) continue;
    const defenders = chess.attackers(p.square, color);
    const cheapest = Math.min(...attackers.map((s) => valueAt(chess, s)));
    if (defenders.length === 0) {
      out.push({ ...p, attackers, defenders, cheapestAttacker: cheapest, reason: 'undefended' });
    } else if (cheapest < PIECE_VALUE[p.type]) {
      out.push({ ...p, attackers, defenders, cheapestAttacker: cheapest, reason: 'cheaper_attacker' });
    }
  }
  return out;
}

function valueAt(chess: Chess, sq: Square): number {
  const p = chess.get(sq);
  // King as attacker counts as very high so it never looks like the "cheap" attacker.
  return p ? (p.type === 'k' ? 100 : PIECE_VALUE[p.type]) : 0;
}

/** Squares of `color` pieces that the piece on `from` defends. */
export function defendedBy(fen: string, from: Square): Square[] {
  const chess = new Chess(fen);
  const piece = chess.get(from);
  if (!piece) return [];
  return piecesOf(fen, piece.color)
    .filter((p) => p.square !== from)
    .filter((p) => chess.attackers(p.square, piece.color).includes(from))
    .map((p) => p.square);
}

/** Enemy pieces (value ≥ 3 or king) attacked by the piece standing on `square`. */
export function attackedTargets(fen: string, square: Square): PieceOnSquare[] {
  const chess = new Chess(fen);
  const piece = chess.get(square);
  if (!piece) return [];
  return piecesOf(fen, opposite(piece.color)).filter((t) => chess.attackers(t.square, piece.color).includes(square));
}

export function isInCheck(fen: string): boolean {
  return new Chess(fen).inCheck();
}
