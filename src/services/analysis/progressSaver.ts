import type { GameAnalysis } from '../../types/domain';

/**
 * Minimum time between two intermediate saves of a running analysis (Sprint 4.6, PA-1).
 * Measured with Stockfish 19 lite at the default depth 16 / MultiPV 3: median 786 ms per
 * position, p90 1.8 s (docs/SPRINT4-6-PA1-B3-RELATORIO.md). 2 s keeps about one save per
 * slow position and groups the fast ones (cache hits, terminal positions). A tab closed
 * between saves loses no engine work: each finished search is already in the eval cache.
 */
export const PROGRESS_SAVE_INTERVAL_MS = 2000;

/**
 * Wraps `save` so intermediate progress is written at most once per `intervalMs`: the
 * first update is written at once, later ones only when the interval has passed. No timer
 * is used, so nothing can be written after the run ends: the caller saves the final state
 * (complete, paused or error) itself, unconditionally, after the last update. Resolves to
 * whether this update was written.
 */
export function progressSaver(save: (a: GameAnalysis) => Promise<void>, intervalMs: number = PROGRESS_SAVE_INTERVAL_MS, now: () => number = Date.now): (a: GameAnalysis) => Promise<boolean> {
  let last = Number.NEGATIVE_INFINITY;
  return async (a) => {
    const t = now();
    if (t - last < intervalMs) return false;
    last = t;
    await save(a);
    return true;
  };
}
