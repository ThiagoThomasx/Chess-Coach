import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/database';
import { subscribe } from '../../services/analysis/analysisRunner';
import type { GameAnalysis } from '../../types/domain';

/**
 * The newer of the stored analysis and the runner's in-memory one. The runner notifies after
 * every position but saves at most every PROGRESS_SAVE_INTERVAL_MS (Sprint 4.6, PA-1); a tie
 * goes to the stored record, which may carry later marks (derivation) with the same time.
 */
export function newerAnalysis(stored: GameAnalysis | undefined, live: GameAnalysis | null): GameAnalysis | undefined {
  if (!live) return stored;
  if (!stored) return live;
  return live.updatedAt > stored.updatedAt ? live : stored;
}

/** Analysis of a game for the analysis screen: stored record, kept live by the runner while it runs. */
export function useLiveAnalysis(gameId: string): GameAnalysis | undefined {
  const stored = useLiveQuery(() => getDb().analyses.get(gameId), [gameId]);
  const [live, setLive] = useState<GameAnalysis | null>(null);
  useEffect(() => {
    setLive(null);
    // The final state is saved before the runner announces it: from then on the stored record is enough.
    return subscribe(gameId, (a) => setLive(a.status === 'running' ? a : null));
  }, [gameId]);
  return newerAnalysis(stored, live);
}
