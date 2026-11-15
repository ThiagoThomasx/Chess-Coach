import { winPercentFor } from '../../src/services/analysis/evaluation';
import type { AcceptableMove, Color } from '../../src/types/domain';

// Sprint 4.8 (PD-4 preparation): what "ambiguous" hides. The tree searches the root with a fixed
// MultiPV, so "3 moves accepted" with MultiPV 3 may mean exactly 3 or many more; and an accepted
// alternative may be almost as good as the best or right at the tolerance.

/** Upper bounds (win% points below the best) of the buckets for accepted alternatives. */
export const LOSS_BUCKETS = [1, 3, 5] as const;

export interface RootSpread {
  /** Accepted moves at the root. */
  accepted: number;
  /** Every searched root line was accepted: more moves may be acceptable than the search shows. */
  capped: boolean;
  /** Win% points each accepted alternative (2nd, 3rd…) gives up against the first accepted move. */
  alternativeLosses: number[];
}

/** Spread of the accepted root moves of an exercise, for the side to move. */
export function rootSpread(accepted: readonly AcceptableMove[], side: Color, searchedLines: number): RootSpread {
  const [best, ...rest] = accepted;
  const bestWin = best ? winPercentFor(best.score, side) : 0;
  return {
    accepted: accepted.length,
    capped: accepted.length > 0 && accepted.length >= searchedLines,
    alternativeLosses: rest.map((m) => Math.max(0, bestWin - winPercentFor(m.score, side))),
  };
}

/** Label of the bucket a loss falls in ("≤1", "1–3", "3–5" or ">5"). */
export function lossBucket(loss: number): string {
  let lower = 0;
  for (const upper of LOSS_BUCKETS) {
    if (loss <= upper) return lower === 0 ? `≤${upper}` : `${lower}–${upper}`;
    lower = upper;
  }
  return `>${lower}`;
}
