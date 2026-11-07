import { Chess, type Move, type Square } from 'chess.js';
import type { Color } from '../../types/domain';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface PlyInfo {
  ply: number; // 1-based
  san: string;
  uci: string;
  color: Color;
  fenBefore: string;
  fenAfter: string;
  from: Square;
  to: Square;
  captured?: string;
  promotion?: string;
}

export function moveToUci(m: Pick<Move, 'from' | 'to' | 'promotion'>): string {
  return `${m.from}${m.to}${m.promotion ?? ''}`;
}

export function parseUci(uci: string): { from: Square; to: Square; promotion?: string } {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error(`UCI inválido: ${uci}`);
  const promotion = uci.length === 5 ? uci[4] : undefined;
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, ...(promotion ? { promotion } : {}) };
}

/** Replays SAN moves from a start FEN, returning per-ply info. Throws on illegal moves. */
export function replayGame(moves: readonly string[], startFen: string = START_FEN): PlyInfo[] {
  const chess = new Chess(startFen);
  return moves.map((san, i) => {
    const fenBefore = chess.fen();
    let m: Move;
    try {
      m = chess.move(san);
    } catch {
      throw new Error(`Lance ilegal na meia-jogada ${i + 1}: ${san}`);
    }
    return {
      ply: i + 1,
      san: m.san,
      uci: moveToUci(m),
      color: m.color,
      fenBefore,
      fenAfter: chess.fen(),
      from: m.from,
      to: m.to,
      ...(m.captured ? { captured: m.captured } : {}),
      ...(m.promotion ? { promotion: m.promotion } : {}),
    };
  });
}

/** FEN list where index i is the position after i plies (0 = start). */
export function positionsOf(moves: readonly string[], startFen: string = START_FEN): string[] {
  const plies = replayGame(moves, startFen);
  return [startFen, ...plies.map((p) => p.fenAfter)];
}

export function sideToMove(fen: string): Color {
  const t = fen.split(' ')[1];
  if (t !== 'w' && t !== 'b') throw new Error(`FEN inválido: ${fen}`);
  return t;
}

export function isValidFen(fen: string): boolean {
  return positionProblem(fen) === null;
}

/**
 * Why a FEN cannot occur in a game, or null when it can. chess.js accepts
 * some impossible positions that make the engine crash (e.g. the side not to
 * move in check), so they are rejected here.
 */
export function positionProblem(fen: string): string | null {
  const board = fen.trim().split(/\s+/)[0] ?? '';
  const ranks = board.split('/');
  if (ranks.length === 8) {
    for (const [king, side] of [['K', 'brancas'], ['k', 'pretas']] as const) {
      const n = [...board].filter((c) => c === king).length;
      if (n !== 1) return `as ${side} têm ${n} rei(s)`;
    }
    if (/[pP]/.test(`${ranks[0] ?? ''}${ranks[7] ?? ''}`)) return 'há peão na 1ª ou 8ª fileira';
    for (const [pawn, side] of [['P', 'brancas'], ['p', 'pretas']] as const) {
      if ([...board].filter((c) => c === pawn).length > 8) return `as ${side} têm mais de 8 peões`;
    }
  }
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch (e) {
    return `FEN inválido: ${e instanceof Error ? e.message : String(e)}`;
  }
  const parts = fen.split(' ');
  const flipped = [parts[0], chess.turn() === 'w' ? 'b' : 'w', parts[2] ?? '-', '-', parts[4] ?? '0', parts[5] ?? '1'].join(' ');
  try {
    if (new Chess(flipped).inCheck()) return 'o lado que não joga está em xeque';
  } catch {
    return 'posição inválida';
  }
  return null;
}

/** Converts a UCI move to SAN in the given position, or null if illegal. */
export function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    return chess.move(parseUci(uci)).san;
  } catch {
    return null;
  }
}

/** Converts a UCI line to SAN; stops at the first illegal move. */
export function uciLineToSan(fen: string, line: readonly string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of line) {
    try {
      out.push(chess.move(parseUci(uci)).san);
    } catch {
      break;
    }
  }
  return out;
}

export function applyUci(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    chess.move(parseUci(uci));
    return chess.fen();
  } catch {
    return null;
  }
}

export function sanToUci(fen: string, san: string): string | null {
  try {
    const chess = new Chess(fen);
    return moveToUci(chess.move(san));
  } catch {
    return null;
  }
}

export function legalMoveCount(fen: string): number {
  return new Chess(fen).moves().length;
}

export type TerminalState = 'checkmate' | 'stalemate' | 'draw' | null;

export function terminalState(fen: string): TerminalState {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isInsufficientMaterial()) return 'draw';
  return null;
}

/** Full-move number label for a ply, e.g. ply 1 → "1.", ply 2 → "1...". */
export function moveNumberLabel(ply: number, startFen: string = START_FEN): string {
  const startFull = Number(startFen.split(' ')[5] ?? '1');
  const startBlack = sideToMove(startFen) === 'b';
  const idx = ply - 1 + (startBlack ? 1 : 0);
  const num = startFull + Math.floor(idx / 2);
  return idx % 2 === 0 ? `${num}.` : `${num}...`;
}
