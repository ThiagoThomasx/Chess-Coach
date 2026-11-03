import { Chess } from 'chess.js';
import type { Color, OpeningLine } from '../../types/domain';
import type { EngineLike } from '../analysis/gameAnalyzer';
import { winPercentFor } from '../analysis/evaluation';
import { applyUci, sideToMove } from '../chess/position';

export interface LineValidation {
  ok: boolean;
  error?: string;
  fens: string[];
}

/** Checks that a line is legal and returns the FEN after each ply. */
export function validateLine(moves: readonly string[]): LineValidation {
  const chess = new Chess();
  const fens = [chess.fen()];
  for (let i = 0; i < moves.length; i++) {
    try {
      chess.move(moves[i] as string);
      fens.push(chess.fen());
    } catch {
      return { ok: false, error: `Lance ilegal na meia-jogada ${i + 1}: ${moves[i]}`, fens };
    }
  }
  return { ok: true, fens };
}

/** Parses free text like "1. e4 e5 2. Nf3" into SAN tokens. */
export function parseMoveText(text: string): string[] {
  return text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !['1-0', '0-1', '1/2-1/2', '*'].includes(t));
}

function normalizeSan(s: string): string {
  return s.replace(/[+#?!]/g, '');
}

/**
 * Drill state. `ply` indexes the next line move; `owed` is a line move the
 * user postponed by swapping the order of two of their moves (transposition):
 * it must be played before the drill rejoins the line at `resumePly`.
 */
export interface PracticeState {
  ply: number;
  fen: string;
  lastMove: { from: string; to: string } | null;
  owed: { san: string; resumePly: number } | null;
}

export type PracticeMoveVerdict = { kind: 'correct'; done: boolean } | { kind: 'transposed'; postponed: string } | { kind: 'wrong'; expected: string };

export function startPractice(line: OpeningLine): PracticeState {
  return { ply: 0, fen: validateLine(line.moves).fens[0] as string, lastMove: null, owed: null };
}

/** Position key without the move counters, for comparing transpositions. */
const positionKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

function play(fen: string, san: string): { fen: string; from: string; to: string } | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move(san);
    return { fen: chess.fen(), from: m.from, to: m.to };
  } catch {
    return null;
  }
}

/** Judges the user's move (SAN) and returns the next state. */
export function practiceUserMove(line: OpeningLine, state: PracticeState, san: string): { verdict: PracticeMoveVerdict; state: PracticeState } {
  const expected = state.owed?.san ?? line.moves[state.ply];
  const moved = play(state.fen, san);
  if (expected === undefined || !moved) return { verdict: { kind: 'wrong', expected: expected ?? '' }, state };
  const lastMove = { from: moved.from, to: moved.to };
  if (normalizeSan(expected) === normalizeSan(san)) {
    const ply = state.owed ? state.owed.resumePly : state.ply + 1;
    return { verdict: { kind: 'correct', done: ply + 1 >= line.moves.length }, state: { ply, fen: moved.fen, lastMove, owed: null } };
  }
  // Transposition: the user played their next line move first; if the opponent's
  // line reply and then the skipped move reach the same position, the line goes on.
  const p = state.ply;
  const next = line.moves[p + 2];
  const reply = line.moves[p + 1];
  const target = validateLine(line.moves).fens[p + 3];
  if (!state.owed && next && reply && target && normalizeSan(next) === normalizeSan(san)) {
    const afterReply = play(moved.fen, reply);
    const rejoined = afterReply && play(afterReply.fen, expected);
    if (rejoined && positionKey(rejoined.fen) === positionKey(target)) {
      return { verdict: { kind: 'transposed', postponed: expected }, state: { ply: p + 1, fen: moved.fen, lastMove, owed: { san: expected, resumePly: p + 3 } } };
    }
  }
  return { verdict: { kind: 'wrong', expected }, state };
}

/** Plays the opponent's line move. While a move is owed, the line index skips the one already played. */
export function practiceOpponentMove(line: OpeningLine, state: PracticeState): PracticeState {
  const san = line.moves[state.ply];
  const moved = san ? play(state.fen, san) : null;
  if (!moved) return state;
  return { ...state, ply: state.ply + 1, fen: moved.fen, lastMove: { from: moved.from, to: moved.to } };
}

export function isUserTurn(state: PracticeState, side: Color): boolean {
  return sideToMove(state.fen) === side;
}

/** Search depth used to judge an off-book move. */
export const OFF_BOOK_DEPTH = 12;

/**
 * Engine judgment of a move outside the line: playable when it loses at most
 * `tolerance` points of win expectancy against the best move.
 */
export async function judgeOffBook(engine: EngineLike, fen: string, uci: string, tolerance: number): Promise<{ playable: boolean; loss: number }> {
  const after = applyUci(fen, uci);
  if (!after) return { playable: false, loss: 100 };
  const mover = sideToMove(fen);
  const [a, b] = [await engine.analyze({ fen, depth: OFF_BOOK_DEPTH, multiPv: 1 }), await engine.analyze({ fen: after, depth: OFF_BOOK_DEPTH, multiPv: 1 })];
  const best = a.lines[0]?.score;
  const played = b.lines[0]?.score;
  if (!best || !played) return { playable: false, loss: 100 };
  const loss = Math.max(0, winPercentFor(best, mover) - winPercentFor(played, mover));
  return { playable: loss <= tolerance, loss };
}
