import type { Exercise, PositionAnalysis } from '../../types/domain';
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

/** Progressive hints for the current node of a sequence: 1 = objective, 2 = piece to move, 3 = the move. */
export function hintForNode(objective: string, accepted: readonly { uci: string; san: string }[], level: number): { text: string; square?: string } {
  const best = accepted[0];
  if (!best || level <= 1) return { text: `Objetivo: ${objective}` };
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
