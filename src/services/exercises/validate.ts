import { Chess, type PieceSymbol, type Square } from 'chess.js';
import type { Exercise, PositionAnalysis } from '../../types/domain';
import { attackedTargets } from '../chess/tactics';
import { applyUci, terminalState, uciToSan } from '../chess/position';
import { winPercentFor } from '../analysis/evaluation';

export type StepVerdict =
  | { kind: 'solved'; message: string }
  | { kind: 'continue'; opponentMove: string; message: string }
  | { kind: 'incorrect'; message: string }
  | { kind: 'unknown'; message: string };

/**
 * Validates the user's move at `step` (0-based count of user moves made).
 * Step 0 accepts any move in the acceptable set; later steps follow the
 * stored forcing line (or any move that delivers mate).
 */
export function validateStep(ex: Exercise, step: number, fen: string, uci: string): StepVerdict {
  const san = uciToSan(fen, uci);
  if (!san) return { kind: 'incorrect', message: 'Lance ilegal.' };
  const after = applyUci(fen, uci);
  if (after && terminalState(after) === 'checkmate') return { kind: 'solved', message: `${san}# — xeque-mate!` };

  const expected = ex.solutionLine[step * 2];
  const isMain = expected === uci;
  if (step === 0) {
    const accepted = ex.acceptableMoves.some((m) => m.uci === uci);
    if (!accepted && !isMain) return { kind: 'unknown', message: `${san} não está entre os lances analisados.` };
    if (!isMain) return { kind: 'solved', message: `${san} é uma alternativa equivalente aceita (dentro da tolerância de ${ex.tolerance}%).` };
  } else if (!isMain) {
    return { kind: 'incorrect', message: `${san} não continua a sequência forçada.` };
  }
  const reply = ex.solutionLine[step * 2 + 1];
  const nextUser = ex.solutionLine[step * 2 + 2];
  if (!reply || !nextUser) return { kind: 'solved', message: `${san} — correto!` };
  return { kind: 'continue', opponentMove: reply, message: `${san} — correto. Continue a sequência.` };
}

/**
 * Judges a first move not present in the stored lines using a fresh engine
 * evaluation of the resulting position (White POV score in `afterAnalysis`).
 */
export function judgeWithEngine(ex: Exercise, afterAnalysis: PositionAnalysis): { accepted: boolean; winLoss: number } {
  const line = afterAnalysis.lines[0];
  if (!line) return { accepted: false, winLoss: Number.POSITIVE_INFINITY };
  const bestWin = winPercentFor(ex.bestMove.score, ex.sideToMove);
  const win = winPercentFor(line.score, ex.sideToMove);
  const winLoss = Math.max(0, bestWin - win);
  return { accepted: afterAnalysis.complete && winLoss <= ex.tolerance, winLoss };
}

/**
 * First hint: the kind of move that works, computed from the position
 * (mate, check, capture, double attack, or a quiet move of a given piece).
 * It narrows the search without naming the square or the move.
 */
export function motifHint(fen: string, uci: string): string | null {
  const after = applyUci(fen, uci);
  const chess = new Chess(fen);
  const piece = chess.get(uci.slice(0, 2) as Square);
  if (!after || !piece) return null;
  if (terminalState(after) === 'checkmate') return 'Existe um xeque-mate imediato.';
  const isCapture = !!chess.get(uci.slice(2, 4) as Square) || (piece.type === 'p' && uci[0] !== uci[2]);
  const isCheck = new Chess(after).inCheck();
  if (isCheck && isCapture) return 'O lance certo captura com xeque.';
  if (isCheck) return 'O lance certo dá xeque.';
  if (isCapture) return 'O lance certo é uma captura.';
  if (attackedTargets(after, uci.slice(2, 4) as Square).length >= 2) return 'O lance certo ataca duas peças valiosas ao mesmo tempo.';
  return `O lance certo é um lance tranquilo (sem captura nem xeque) de ${PIECE_ARTICLE_PT[piece.type]}.`;
}

const PIECE_ARTICLE_PT: Record<PieceSymbol, string> = { p: 'um peão', n: 'um cavalo', b: 'um bispo', r: 'uma torre', q: 'a dama', k: 'o rei' };

/** Progressive hints for the current node: 1 = kind of move (motifHint), 2 = piece to move, 3 = the move. */
export function hintForNode(fen: string, objective: string, accepted: readonly { uci: string; san: string }[], level: number): { text: string; square?: string } {
  const best = accepted[0];
  if (!best) return { text: `Objetivo: ${objective}` };
  if (level <= 1) return { text: motifHint(fen, best.uci) ?? `Objetivo: ${objective}` };
  const from = best.uci.slice(0, 2);
  if (level === 2) return { text: `A peça a mover está em ${from}.`, square: from };
  return { text: `O lance é ${best.san}.`, square: from };
}

/** Progressive hints: 1 = theme, 2 = piece to move, 3 = full move. */
export function hintFor(ex: Exercise, level: number): { text: string; square?: string } {
  const from = ex.bestMove.uci.slice(0, 2);
  if (level <= 1) return { text: `Tema: ${ex.objective}` };
  if (level === 2) return { text: `A peça a mover está em ${from}.`, square: from };
  return { text: `O lance é ${ex.bestMove.san}.`, square: from };
}

export const MAX_HINTS = 3;
