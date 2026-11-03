import { Chess } from 'chess.js';
import type { Color, OpeningLine } from '../../types/domain';

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

export type PracticeVerdict = { kind: 'correct'; done: boolean } | { kind: 'wrong'; expected: string };

/** Continuation drill: the user plays their side; `ply` is the index of the expected move. */
export function checkPracticeMove(line: OpeningLine, ply: number, san: string): PracticeVerdict {
  const expected = line.moves[ply];
  if (expected === undefined) return { kind: 'correct', done: true };
  if (normalizeSan(expected) !== normalizeSan(san)) return { kind: 'wrong', expected };
  return { kind: 'correct', done: ply + 1 >= line.moves.length || ply + 2 >= line.moves.length };
}

function normalizeSan(s: string): string {
  return s.replace(/[+#?!]/g, '');
}

/** Index of the first ply the user (playing `side`) must find. */
export function firstUserPly(side: Color): number {
  return side === 'w' ? 0 : 1;
}
