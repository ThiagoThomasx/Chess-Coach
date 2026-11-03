import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { Color } from '../../types/domain';
import { PIECE_VALUE } from './material';
import { parseUci } from './position';

/**
 * Legality-aware tactical primitives. Everything here is derived from
 * chess.js legal move generation, so pinned pieces never "attack" or
 * "defend" a square they cannot actually move to.
 *
 * Conventions:
 * - "legal capture" = a capture the side could play right now, or — for the
 *   side NOT to move — after a null move (the opponent passing). Null moves are
 *   refused when the side to move is in check (the threat question is moot).
 * - Values use PIECE_VALUE (p1 n3 b3 r5 q9); the king is never a victim.
 */

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');

const FILES = 'abcdefgh';

function sq(file: number, rank: number): Square {
  return `${FILES[file]}${rank + 1}` as Square;
}

function coords(s: string): [number, number] {
  return [FILES.indexOf(s[0] as string), Number(s[1]) - 1];
}

export function pieceValue(t: PieceSymbol): number {
  return PIECE_VALUE[t];
}

/** FEN with the other side to move and no en-passant square, or null if the side to move is in check. */
export function nullMoveFen(fen: string): string | null {
  const chess = new Chess(fen);
  if (chess.inCheck()) return null;
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const flipped = parts.join(' ');
  try {
    new Chess(flipped);
    return flipped;
  } catch {
    return null;
  }
}

/** Position where `side` is to move (the original one, or a null-move position). */
export function positionFor(fen: string, side: Color): string | null {
  return fen.split(' ')[1] === side ? fen : nullMoveFen(fen);
}

/** Legal captures by `side` on `target` (empty if none or if a null move is impossible). */
export function legalCapturesOn(fen: string, target: Square, side: Color): Move[] {
  const pos = positionFor(fen, side);
  if (!pos) return [];
  return new Chess(pos).moves({ verbose: true }).filter((m) => m.to === target && (m.isCapture() || m.isEnPassant()));
}

function victimValue(m: Move): number {
  return m.captured ? pieceValue(m.captured) : 0;
}

function promoGain(m: Move): number {
  return m.promotion ? pieceValue(m.promotion) - 1 : 0;
}

/** Best gain (≥ 0) the side to move can obtain by starting captures on `target`, cheapest capturer first. */
function exchangeOn(fen: string, target: Square, depth: number): number {
  if (depth > 16) return 0;
  const chess = new Chess(fen);
  const caps = chess.moves({ verbose: true }).filter((m) => m.to === target && m.isCapture());
  if (caps.length === 0) return 0;
  const cheapest = caps.reduce((a, b) => (attackerValue(b) < attackerValue(a) ? b : a));
  chess.move(cheapest);
  return Math.max(0, victimValue(cheapest) + promoGain(cheapest) - exchangeOn(chess.fen(), target, depth + 1));
}

function attackerValue(m: Move): number {
  return m.piece === 'k' ? 100 : pieceValue(m.piece);
}

/**
 * Static exchange evaluation of a specific capture, using only legal moves.
 * Positive = the capturing side wins material on that square; negative =
 * the capture loses material after the best legal recaptures.
 */
export function seeCapture(fen: string, uci: string): number | null {
  const chess = new Chess(fen);
  let m: Move;
  try {
    m = chess.move(parseUci(uci));
  } catch {
    return null;
  }
  if (!m.isCapture() && !m.isEnPassant()) return 0;
  return victimValue(m) + promoGain(m) - exchangeOn(chess.fen(), m.to, 1);
}

export interface EnPrise {
  square: Square;
  type: PieceSymbol;
  /** Best legal capture (UCI) for the opponent and its SEE gain. */
  capture: string;
  gain: number;
}

/**
 * Pieces of `color` the opponent can win by a legal capture sequence on their
 * square (SEE > 0). Returns [] when it cannot be decided (null move refused).
 */
export function enPrise(fen: string, color: Color): EnPrise[] {
  const enemy = opposite(color);
  const pos = positionFor(fen, enemy);
  if (!pos) return [];
  const chess = new Chess(pos);
  const out: EnPrise[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== color || p.type === 'k') continue;
      let best: EnPrise | null = null;
      for (const m of legalCapturesOn(pos, p.square, enemy)) {
        const gain = seeCapture(pos, `${m.from}${m.to}${m.promotion ?? ''}`) ?? 0;
        if (gain > 0 && (!best || gain > best.gain)) best = { square: p.square, type: p.type, capture: `${m.from}${m.to}${m.promotion ?? ''}`, gain };
      }
      if (best) out.push(best);
    }
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/** Pieces of `side` that could legally recapture on `target` after an enemy piece lands there. */
export function legalRecapturers(fen: string, target: Square, side: Color): Square[] {
  const enemy = opposite(side);
  const pos = positionFor(fen, enemy);
  if (!pos) return [];
  const caps = legalCapturesOn(pos, target, enemy);
  if (caps.length === 0) return [];
  const cheapest = caps.reduce((a, b) => (attackerValue(b) < attackerValue(a) ? b : a));
  const chess = new Chess(pos);
  chess.move(cheapest);
  return chess
    .moves({ verbose: true })
    .filter((m) => m.to === target)
    .map((m) => m.from);
}

export interface Pin {
  pinned: Square;
  pinnedType: PieceSymbol;
  by: Square;
  /** Square of the piece behind (the king for absolute pins). */
  to: Square;
  kind: 'absolute' | 'relative';
}

const ORTHO: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Pins against pieces of `color`: an enemy slider, one `color` piece, then the
 * king (absolute) or a more valuable `color` piece (relative), on a line the
 * slider moves along.
 */
export function pinsAgainst(fen: string, color: Color): Pin[] {
  const chess = new Chess(fen);
  const out: Pin[] = [];
  for (const row of chess.board()) {
    for (const s of row) {
      if (!s || s.color === color || !['b', 'r', 'q'].includes(s.type)) continue;
      const dirs = s.type === 'b' ? DIAG : s.type === 'r' ? ORTHO : [...ORTHO, ...DIAG];
      const [f0, r0] = coords(s.square);
      for (const [df, dr] of dirs) {
        let f = f0 + df;
        let r = r0 + dr;
        let first: { square: Square; type: PieceSymbol } | null = null;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const p = chess.get(sq(f, r));
          if (p) {
            if (p.color !== color) break;
            if (!first) first = { square: sq(f, r), type: p.type };
            else {
              if (first.type !== 'k') {
                if (p.type === 'k') out.push({ pinned: first.square, pinnedType: first.type, by: s.square, to: sq(f, r), kind: 'absolute' });
                else if (pieceValue(p.type) > pieceValue(first.type)) out.push({ pinned: first.square, pinnedType: first.type, by: s.square, to: sq(f, r), kind: 'relative' });
              }
              break;
            }
          }
          f += df;
          r += dr;
        }
      }
    }
  }
  return out;
}

/** Legal moves of the side to move that deliver checkmate (exact, no engine). */
export function mateInOne(fen: string): string[] {
  const chess = new Chess(fen);
  return chess.moves({ verbose: true }).filter((m) => {
    chess.move(m);
    const mate = chess.isCheckmate();
    chess.undo();
    return mate;
  }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`);
}

/** Mate-in-one moves the side NOT to move would have if it could move now (null-move threat). */
export function mateThreats(fen: string): string[] {
  const nm = nullMoveFen(fen);
  return nm ? mateInOne(nm) : [];
}

/** Valuable targets (value ≥ 3, or the king) that `square`'s piece attacks along legal lines. */
export function attackedTargets(fen: string, square: Square): { square: Square; type: PieceSymbol }[] {
  const chess = new Chess(fen);
  const piece = chess.get(square);
  if (!piece) return [];
  const pos = positionFor(fen, piece.color);
  const out: { square: Square; type: PieceSymbol }[] = [];
  const enemyKing = chess.board().flat().find((p) => p && p.type === 'k' && p.color !== piece.color);
  // Checks: the enemy is to move and in check from this piece.
  if (enemyKing && chess.turn() !== piece.color && chess.inCheck() && chess.attackers(enemyKing.square, piece.color).includes(square)) {
    out.push({ square: enemyKing.square, type: 'k' });
  }
  if (!pos) {
    // The enemy is in check, so no null move: the checking piece just moved legally and is
    // attacking along its own lines; list valuable enemy pieces it attacks geometrically.
    for (const row of chess.board()) {
      for (const p of row) {
        if (p && p.color !== piece.color && p.type !== 'k' && pieceValue(p.type) >= 3 && chess.attackers(p.square, piece.color).includes(square)) out.push({ square: p.square, type: p.type });
      }
    }
    return out;
  }
  const moves = new Chess(pos).moves({ square, verbose: true });
  for (const m of moves) {
    if (m.captured && m.captured !== 'p' && pieceValue(m.captured) >= 3) out.push({ square: m.to, type: m.captured });
  }
  return out;
}

/**
 * Discovered attacks created by `uci`: pieces OTHER than the moved one that
 * now attack valuable enemy targets (or give check) they did not attack before.
 */
export function discoveredAttacks(fen: string, uci: string): { by: Square; target: Square; type: PieceSymbol }[] {
  const chess = new Chess(fen);
  const mover = chess.turn();
  const { from, to } = parseUci(uci);
  let after: string;
  try {
    chess.move(parseUci(uci));
    after = chess.fen();
  } catch {
    return [];
  }
  const before = new Chess(fen);
  const afterBoard = new Chess(after);
  const out: { by: Square; target: Square; type: PieceSymbol }[] = [];
  for (const row of afterBoard.board()) {
    for (const p of row) {
      if (!p || p.color === mover || (p.type !== 'k' && pieceValue(p.type) < 3)) continue;
      const nowAttackers = afterBoard.attackers(p.square, mover).filter((s) => s !== to);
      const wasAttackers = before.attackers(p.square, mover);
      for (const a of nowAttackers) {
        if (a === from || wasAttackers.includes(a)) continue;
        const pin = pinsAgainst(after, mover).find((x) => x.pinned === a && x.kind === 'absolute');
        if (!pin) out.push({ by: a, target: p.square, type: p.type });
      }
    }
  }
  return out;
}

export interface Overload {
  defender: Square;
  defenderType: PieceSymbol;
  targets: Square[];
}

/**
 * Overloaded defenders of `color`: a piece that is the ONLY legal recapturer
 * for two or more `color` pieces the opponent can legally capture.
 */
export function overloadedDefenders(fen: string, color: Color): Overload[] {
  const enemy = opposite(color);
  const pos = positionFor(fen, enemy);
  if (!pos) return [];
  const chess = new Chess(pos);
  const sole = new Map<Square, Square[]>();
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== color || p.type === 'k') continue;
      if (legalCapturesOn(pos, p.square, enemy).length === 0) continue;
      const rec = legalRecapturers(pos, p.square, color);
      if (rec.length === 1) sole.set(rec[0] as Square, [...(sole.get(rec[0] as Square) ?? []), p.square]);
    }
  }
  return [...sole.entries()]
    .filter(([, t]) => t.length >= 2)
    .map(([d, targets]) => ({ defender: d, defenderType: chess.get(d)?.type ?? 'p', targets }));
}

/**
 * Deflection in a line: the opponent's reply (line[1]) moves a piece that was
 * a legal recapturer of the square later captured by line[2].
 */
export function deflectionIn(fen: string, line: readonly string[]): { defender: Square; target: Square } | null {
  if (line.length < 3) return null;
  const chess = new Chess(fen);
  const me = chess.turn();
  try {
    chess.move(parseUci(line[0] as string));
  } catch {
    return null;
  }
  const afterFirst = chess.fen();
  const reply = parseUci(line[1] as string);
  const finisher = parseUci(line[2] as string);
  const target = finisher.to;
  const targetPiece = chess.get(target);
  if (!targetPiece || targetPiece.color === me) return null;
  const defendersBefore = legalRecapturers(afterFirst, target, opposite(me));
  if (!defendersBefore.includes(reply.from) || reply.to === target) return null;
  try {
    chess.move(reply);
  } catch {
    return null;
  }
  const defendersAfter = legalRecapturers(chess.fen(), target, opposite(me));
  return defendersAfter.length < defendersBefore.length ? { defender: reply.from, target } : null;
}
