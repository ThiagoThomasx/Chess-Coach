import { Chess, type Square } from 'chess.js';
import type { MoveReview, Skill, Theme } from '../../types/domain';
import { vulnerablePieces, defendedBy, attackedTargets } from '../chess/attacks';
import { materialSwingAlongLine, gamePhase, PIECE_VALUE } from '../chess/material';
import { applyUci, parseUci, uciLineToSan } from '../chess/position';
import { hasMateFor } from '../analysis/evaluation';

/** A concept detected in a reviewed move, with the facts that justify it. */
export interface Concept {
  theme: Theme;
  /** Machine-checkable evidence used by the templates. */
  evidence: ConceptEvidence;
}

export interface ConceptEvidence {
  square?: Square;
  pieceType?: string;
  capturingMoveSan?: string;
  replySan?: string[];
  bestSan?: string[];
  mateIn?: number;
  materialDelta?: number;
  targets?: { square: Square; type: string }[];
  movedPiece?: string;
}

export const THEME_SKILL: Record<Theme, Skill> = {
  hanging_piece: 'threats',
  ignored_threat: 'threats',
  removed_defender: 'threats',
  missed_capture: 'tactics',
  fork: 'patterns',
  missed_check: 'tactics',
  mate_threat: 'defense',
  missed_mate: 'patterns',
  allowed_mate: 'defense',
  defense: 'defense',
  positional: 'strategy',
  opening: 'openings',
  endgame: 'endgames',
};

export const THEME_LABEL: Record<Theme, string> = {
  hanging_piece: 'Peça desprotegida',
  ignored_threat: 'Ameaça ignorada',
  removed_defender: 'Defensor removido',
  missed_capture: 'Captura desperdiçada',
  fork: 'Ataque duplo',
  missed_check: 'Xeque decisivo',
  mate_threat: 'Ameaça de mate',
  missed_mate: 'Mate perdido',
  allowed_mate: 'Mate permitido',
  defense: 'Defesa necessária',
  positional: 'Jogo posicional',
  opening: 'Princípios de abertura',
  endgame: 'Técnica de finais',
};

function mateDistance(score: { kind: string; value: number }): number | undefined {
  return score.kind === 'mate' ? Math.max(1, Math.ceil(Math.abs(score.value))) : undefined;
}

/**
 * Detects concepts behind a move, using only verifiable facts: board geometry
 * from chess.js and the engine's own lines. Returns an ordered list (most
 * specific first). An empty list means no reliable explanation beyond the
 * raw engine evaluation is available.
 */
export function detectConcepts(review: MoveReview, replyLine: readonly string[]): Concept[] {
  const out: Concept[] = [];
  const mover = review.color;
  const opponent = mover === 'w' ? 'b' : 'w';
  const replySan = uciLineToSan(review.fenAfter, replyLine.slice(0, 6));
  const bestSan = uciLineToSan(review.fenBefore, review.bestLine.slice(0, 6));

  if (review.flags.includes('allowed_mate')) {
    const n = mateDistance(review.evalAfter);
    out.push({ theme: 'allowed_mate', evidence: { replySan, ...(n ? { mateIn: n } : {}) } });
  }
  if (review.flags.includes('mate_missed')) {
    const n = mateDistance(review.evalBefore);
    out.push({ theme: 'missed_mate', evidence: { bestSan, ...(n ? { mateIn: n } : {}) } });
  }

  // Material lost to the opponent's best reply: find which piece and why.
  const replyFirst = replyLine[0];
  const replySwing = replyLine.length ? materialSwingAlongLine(review.fenAfter, replyLine, mover, 6).delta : 0;
  if (replyFirst && replySwing <= -2) {
    const target = parseUci(replyFirst).to;
    const vulnAfter = vulnerablePieces(review.fenAfter, mover).find((v) => v.square === target);
    if (vulnAfter) {
      const { from, to } = parseUci(review.uci);
      const vulnBefore = vulnerablePieces(review.fenBefore, mover).some((v) => v.square === target);
      const wasDefendedByMover = defendedBy(review.fenBefore, from).includes(target);
      const evidence: ConceptEvidence = {
        square: target,
        pieceType: vulnAfter.type,
        capturingMoveSan: replySan[0] ?? replyFirst,
        replySan,
        materialDelta: replySwing,
      };
      if (target === to) out.push({ theme: 'hanging_piece', evidence: { ...evidence, movedPiece: vulnAfter.type } });
      else if (vulnBefore) out.push({ theme: 'ignored_threat', evidence });
      else if (wasDefendedByMover) out.push({ theme: 'removed_defender', evidence });
      else out.push({ theme: 'hanging_piece', evidence });
    }
  }

  // Opportunities the best move offered.
  const bestFirst = review.bestLine[0];
  if (bestFirst && review.bestMoveUci !== review.uci) {
    const bestGain = materialSwingAlongLine(review.fenBefore, review.bestLine, mover, 6).delta;
    const afterBest = applyUci(review.fenBefore, bestFirst);
    if (afterBest && bestGain >= 2) {
      const dest = parseUci(bestFirst).to;
      const targets = attackedTargets(afterBest, dest).filter((t) => t.type === 'k' || PIECE_VALUE[t.type as keyof typeof PIECE_VALUE] >= 3);
      const givesCheck = new Chess(afterBest).inCheck();
      const isCapture = new Chess(review.fenBefore).get(dest)?.color === opponent;
      if (targets.length >= 2) out.push({ theme: 'fork', evidence: { bestSan, materialDelta: bestGain, targets: targets.map((t) => ({ square: t.square, type: t.type })) } });
      else if (isCapture) out.push({ theme: 'missed_capture', evidence: { bestSan, materialDelta: bestGain, square: dest } });
      else if (givesCheck) out.push({ theme: 'missed_check', evidence: { bestSan, materialDelta: bestGain } });
    }
  }

  if (out.length === 0 && review.flags.includes('defense_needed') && hasMateFor(review.evalBefore, opponent)) {
    out.push({ theme: 'mate_threat', evidence: { bestSan } });
  }
  if (out.length === 0 && review.flags.includes('defense_needed')) out.push({ theme: 'defense', evidence: { bestSan } });

  if (out.length === 0) {
    const phase = gamePhase(review.fenBefore, review.ply);
    if (phase === 'opening') out.push({ theme: 'opening', evidence: { bestSan } });
    else if (phase === 'endgame') out.push({ theme: 'endgame', evidence: { bestSan } });
    else out.push({ theme: 'positional', evidence: { bestSan } });
  }
  return out;
}

/** True when a concept is backed by concrete tactical evidence (not just phase heuristics). */
export function isVerifiedConcept(c: Concept): boolean {
  return !['positional', 'opening', 'endgame', 'defense'].includes(c.theme);
}
