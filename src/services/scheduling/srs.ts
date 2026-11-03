import type { SrsState } from '../../types/domain';

export const DEFAULT_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60];
export const DAY_MS = 86_400_000;
/** A failed item comes back in the same session after this delay. */
export const RETRY_DELAY_MS = 10 * 60_000;

export type ReviewOutcome = 'fail' | 'assisted' | 'independent';

/**
 * Simple Leitner-style scheduling (documented in docs/METHODOLOGY.md):
 * - fail → back to box 0, due again in 10 minutes;
 * - assisted (solved with hints) → box unchanged, half the box interval (≥ 1 day);
 * - independent → due after the current box interval, then promoted one box.
 */
export function nextSrs(state: SrsState, outcome: ReviewOutcome, now: number, intervals: readonly number[] = DEFAULT_INTERVALS_DAYS): SrsState {
  const maxBox = intervals.length - 1;
  const box = Math.max(0, Math.min(state.box, maxBox));
  const interval = intervals[box] ?? 1;
  switch (outcome) {
    case 'fail':
      return { box: 0, dueAt: now + RETRY_DELAY_MS, lastReviewedAt: now };
    case 'assisted':
      return { box, dueAt: now + Math.max(1, interval / 2) * DAY_MS, lastReviewedAt: now };
    case 'independent':
      return { box: Math.min(box + 1, maxBox), dueAt: now + interval * DAY_MS, lastReviewedAt: now };
  }
}

export function outcomeOf(correct: boolean, hintsUsed: number, revealed: boolean): ReviewOutcome {
  if (!correct || revealed) return 'fail';
  return hintsUsed > 0 ? 'assisted' : 'independent';
}

export function isDue(state: SrsState, now: number): boolean {
  return state.dueAt <= now;
}
