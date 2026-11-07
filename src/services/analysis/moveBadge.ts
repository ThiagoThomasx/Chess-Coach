import type { ClassificationThresholds, Color, MoveClass, MoveReview, Score } from '../../types/domain';
import { CLASS_LABEL, CLASS_SYMBOL, classifyMove } from './classify';

/** Classes the engine data actually supports on the board; inconclusive and book never get a badge. */
const BADGE_CLASSES: readonly MoveClass[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
const SEVERE: readonly MoveClass[] = ['inaccuracy', 'mistake', 'blunder'];

export interface MoveBadge {
  cls: MoveClass;
  symbol: string;
  label: string;
}

export interface PlacedMoveBadge extends MoveBadge {
  /** Destination square of the move, where the badge is drawn. */
  square: string;
}

export function badgeForClass(cls: MoveClass): MoveBadge | null {
  if (!BADGE_CLASSES.includes(cls)) return null;
  return { cls, symbol: CLASS_SYMBOL[cls], label: CLASS_LABEL[cls] };
}

/** Badge for a reviewed game move, anchored on its destination square. */
export function badgeForReview(review: MoveReview | undefined): PlacedMoveBadge | null {
  if (!review) return null;
  const badge = badgeForClass(review.classification);
  return badge ? { ...badge, square: review.uci.slice(2, 4) } : null;
}

/** What the exercise solver measured for the user's move (White-POV scores from one comparison). */
export interface SolverAssessment {
  accepted: boolean;
  color: Color;
  depth: number;
  /** Score of the reference (best) move. */
  reference: Score;
  /** Score after the user's move. */
  played: Score;
}

const sameScore = (a: Score, b: Score): boolean => a.kind === b.kind && a.value === b.value;

/**
 * Grades the user's move in an exercise with the same rules as game analysis
 * (docs/METHODOLOGY.md §3). A rejected move only shows a badge when it is at
 * least an inaccuracy, so a "wrong" verdict never carries a positive badge.
 */
export function solverMoveClass(a: SolverAssessment, thresholds: ClassificationThresholds): MoveClass | null {
  const { classification } = classifyMove({
    color: a.color,
    before: a.reference,
    after: a.played,
    playedIsBest: sameScore(a.reference, a.played),
    depth: a.depth,
    complete: true,
    // Outside the opening window: flags are irrelevant for the badge.
    ply: Number.MAX_SAFE_INTEGER,
    thresholds,
  });
  if (!badgeForClass(classification)) return null;
  if (!a.accepted && !SEVERE.includes(classification)) return null;
  return classification;
}
