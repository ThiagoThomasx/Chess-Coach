import type { Color, Score } from '../../types/domain';

/**
 * Converts a score reported by UCI (relative to the side to move) into
 * White's point of view. All stored evaluations use White's POV.
 */
export function toWhitePov(score: Score, sideToMove: Color): Score {
  if (sideToMove === 'w') return score;
  return { kind: score.kind, value: score.value === 0 ? 0 : -score.value } as Score;
}

/** Score from `color`'s point of view, given a White-POV score. */
export function povOf(score: Score, color: Color): Score {
  if (color === 'w') return score;
  return { kind: score.kind, value: score.value === 0 ? 0 : -score.value } as Score;
}

/**
 * Win expectancy (0–100) for White from a centipawn score, using the logistic
 * model published by Lichess (coefficient 0.00368208). Mate scores map to 100
 * or 0 explicitly instead of being converted to centipawns.
 */
export function winPercentWhite(score: Score): number {
  if (score.kind === 'mate') {
    if (score.value > 0) return 100;
    if (score.value < 0) return 0;
    // mate 0 means the side to move is mated; caller must resolve via toWhitePov first.
    return 50;
  }
  const cp = Math.max(-1000, Math.min(1000, score.value));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function winPercentFor(score: Score, color: Color): number {
  const w = winPercentWhite(score);
  return color === 'w' ? w : 100 - w;
}

/**
 * Score for a position where checkmate is already on the board, White POV.
 * Encoded as mate with |value| = 0.5 ("mate delivered") so the sign still
 * identifies the winner; formatScore renders it as the result.
 */
export function matedScore(mated: Color): Score {
  return { kind: 'mate', value: mated === 'w' ? -0.5 : 0.5 };
}

/** Returns true if `color` has a forced mate according to a White-POV score. */
export function hasMateFor(score: Score, color: Color): boolean {
  return score.kind === 'mate' && (color === 'w' ? score.value > 0 : score.value < 0);
}

export function formatScore(score: Score | undefined): string {
  if (!score) return '—';
  if (score.kind === 'mate') {
    const n = Math.ceil(Math.abs(score.value));
    if (n === 0 || Math.abs(score.value) < 1) return score.value > 0 ? '1-0' : '0-1';
    return `${score.value > 0 ? '+' : '-'}M${n}`;
  }
  const v = score.value / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Fraction (0..1) of the eval bar filled by White. */
export function evalBarFraction(score: Score | undefined): number {
  if (!score) return 0.5;
  return winPercentWhite(score) / 100;
}

export function scoresEqual(a: Score, b: Score): boolean {
  return a.kind === b.kind && a.value === b.value;
}
