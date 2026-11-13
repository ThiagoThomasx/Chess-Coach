import type { ClassificationThresholds, Color, MoveClass, MoveFlag, Score } from '../../types/domain';
import { hasMateFor, povOf, winPercentFor } from './evaluation';

/**
 * Default thresholds on win-expectancy loss (percentage points, mover's POV).
 * Documented in docs/METHODOLOGY.md. All are user-configurable.
 */
export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 15,
  minDepth: 10,
};

export interface ClassifyInput {
  color: Color;
  /** White-POV eval of the position before the move (best play). */
  before: Score;
  /** White-POV eval of the position after the played move. */
  after: Score;
  playedIsBest: boolean;
  depth: number;
  complete: boolean;
  ply: number;
  /** Best move gap: win% of best line minus second best (mover POV), when known. */
  secondBestGap?: number;
  thresholds?: ClassificationThresholds;
}

export interface ClassifyResult {
  classification: MoveClass;
  flags: MoveFlag[];
  winBefore: number;
  winAfter: number;
  winLoss: number;
  cpLoss?: number;
  reason?: string;
}

/** Mover's win expectancy at or below which the position counts as already lost. */
export const LOST_WIN_PERCENT = 5;

/**
 * Mover's win expectancy from which the advantage is decisive (the "winning" standing, the
 * "vantagem decisiva" band of the refutation). A move that keeps it neither fails a conversion
 * exercise nor counts as a serious error in the game trend (Sprint 4.7, PD-2).
 */
export const DECISIVE_WIN_PERCENT = 80;

/** Positional state buckets on mover's win expectancy. */
export type Standing = 'winning' | 'advantage' | 'equal' | 'worse' | 'losing';

export function standingOf(win: number): Standing {
  if (win >= DECISIVE_WIN_PERCENT) return 'winning';
  if (win >= 60) return 'advantage';
  if (win > 40) return 'equal';
  if (win > 20) return 'worse';
  return 'losing';
}

const RANK: Record<Standing, number> = { losing: 0, worse: 1, equal: 2, advantage: 3, winning: 4 };

function classByLoss(loss: number, t: ClassificationThresholds): MoveClass {
  if (loss < t.excellent) return 'excellent';
  if (loss < t.good) return 'good';
  if (loss < t.inaccuracy) return 'inaccuracy';
  if (loss < t.mistake) return 'mistake';
  return 'blunder';
}

/**
 * Classifies a move by comparing evaluations normalized to the mover's POV.
 * Mate transitions are handled by explicit rules — they are never converted
 * into a centipawn loss.
 */
export function classifyMove(input: ClassifyInput): ClassifyResult {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const { color, before, after } = input;
  const winBefore = winPercentFor(before, color);
  const winAfter = winPercentFor(after, color);
  const winLoss = Math.max(0, winBefore - winAfter);
  const flags: MoveFlag[] = [];
  const base = { winBefore, winAfter, winLoss };

  const pb = povOf(before, color);
  const pa = povOf(after, color);
  const cpLoss = pb.kind === 'cp' && pa.kind === 'cp' ? Math.max(0, pb.value - pa.value) : undefined;
  const withCp = cpLoss !== undefined ? { cpLoss } : {};

  if (!input.complete || input.depth < t.minDepth) {
    return {
      ...base,
      ...withCp,
      classification: 'inconclusive',
      flags,
      reason: !input.complete ? 'Análise interrompida antes do limite configurado' : `Profundidade ${input.depth} abaixo do mínimo (${t.minDepth})`,
    };
  }

  const opponent: Color = color === 'w' ? 'b' : 'w';
  const hadMate = hasMateFor(before, color);
  const keepsMate = hasMateFor(after, color);
  const allowsMate = hasMateFor(after, opponent) && !hasMateFor(before, opponent);

  if (hadMate && keepsMate) flags.push('mate_found');
  if (hadMate && !keepsMate) flags.push('mate_missed');
  if (allowsMate) flags.push('allowed_mate');
  if (hasMateFor(before, opponent)) flags.push('defense_needed');

  const sb = standingOf(winBefore);
  const sa = standingOf(winAfter);
  if (RANK[sa] < RANK[sb]) {
    if (sb === 'winning' && RANK[sa] <= RANK.equal) flags.push('lost_winning_position');
    else if (sb === 'winning' || sb === 'advantage') flags.push('lost_advantage');
    else if (sb === 'equal') flags.push('lost_equality');
    if (RANK[sa] < RANK.equal) flags.push('entered_inferior');
  }
  if (input.secondBestGap !== undefined && input.secondBestGap >= 15 && input.playedIsBest) flags.push('only_move');

  let classification: MoveClass;
  if (input.playedIsBest) {
    classification = 'best';
  } else if (allowsMate) {
    // From an already lost position the result barely changes: the flag stays, the label softens.
    classification = winBefore <= LOST_WIN_PERCENT ? 'inaccuracy' : 'blunder';
  } else if (hadMate && !keepsMate) {
    // Missing a forced mate: severity depends on what is left.
    classification = winAfter >= DECISIVE_WIN_PERCENT ? 'inaccuracy' : winAfter >= 60 ? 'mistake' : 'blunder';
  } else if (hadMate && keepsMate) {
    // Still mating, just slower: never worse than "good".
    classification = 'good';
  } else if (hasMateFor(before, opponent) && hasMateFor(after, opponent)) {
    // Already lost to a forced mate: the result cannot change, so no error label;
    // but a move that is not the most resistant defense is not "excellent" either.
    classification = 'good';
  } else {
    classification = classByLoss(winLoss, t);
  }

  if (input.ply <= 20 && (classification === 'mistake' || classification === 'blunder')) flags.push('opening_error');

  return { ...base, ...withCp, classification, flags };
}

export const CLASS_LABEL: Record<MoveClass, string> = {
  best: 'Melhor lance',
  excellent: 'Excelente',
  good: 'Bom',
  inaccuracy: 'Imprecisão',
  mistake: 'Erro',
  blunder: 'Erro grave',
  inconclusive: 'Inconclusivo',
  book: 'Teoria',
};

export const CLASS_SYMBOL: Record<MoveClass, string> = {
  best: '★',
  excellent: '!',
  good: '✓',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  inconclusive: '…',
  book: '📖',
};

export const FLAG_LABEL: Record<MoveFlag, string> = {
  mate_found: 'Mate encontrado',
  mate_missed: 'Mate perdido',
  allowed_mate: 'Permitiu mate',
  lost_winning_position: 'Perdeu posição vencedora',
  lost_advantage: 'Perdeu a vantagem',
  lost_equality: 'Perdeu a igualdade',
  entered_inferior: 'Entrou em posição inferior',
  material_loss: 'Perda de material',
  missed_tactic: 'Oportunidade tática desperdiçada',
  defense_needed: 'Defesa necessária',
  opening_error: 'Erro de abertura',
  only_move: 'Único lance',
};

export const ERROR_CLASSES: readonly MoveClass[] = ['inaccuracy', 'mistake', 'blunder'];
