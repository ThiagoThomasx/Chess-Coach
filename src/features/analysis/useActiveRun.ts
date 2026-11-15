import { useEffect, useState } from 'react';
import { currentRun } from '../../services/analysis/analysisRunner';

/**
 * Whether this tab runs the game's analysis, for the analysis controls. A run started from the
 * controls is driven by the returned setter. When the controls mount while a run goes on (the
 * player left the screen and came back), they follow that run and see it end, in success or
 * error: before this, the controls stayed on "Analisando…" until a reload (Sprint 4.8 pre-closure
 * audit, MEDIUM 1).
 */
export function useActiveRun(gameId: string): [boolean, (active: boolean) => void] {
  const [isActive, setIsActive] = useState(() => currentRun(gameId) !== undefined);
  useEffect(() => {
    const run = currentRun(gameId);
    if (!run) return undefined;
    let mounted = true;
    // Settled either way: the runner reports the outcome itself (stored record, toasts of the screen that started it).
    void run.then(
      () => mounted && setIsActive(false),
      () => mounted && setIsActive(false),
    );
    return () => {
      mounted = false;
    };
  }, [gameId]);
  return [isActive, setIsActive];
}
