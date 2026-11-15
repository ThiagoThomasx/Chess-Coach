import { useEffect, useState } from 'react';
import type { AnalysisStatus } from '../../types/domain';
import { analysisOwner, hasAnalysisLocks, onAnalysisLockReleased, type AnalysisOwner } from '../../services/analysis/analysisLock';
import { recoverInterruptedAnalyses } from '../../db/analysisRepo';

/** The owner, or 'checking' while the check for the current stored status has not answered (Web Locks present). */
export type OwnerView = AnalysisOwner | 'checking';

/**
 * Who runs this game's analysis (Sprint 4.8, T-1):
 * - 'here': this tab runs it (`isActive`); the browser is not asked;
 * - 'elsewhere': another tab holds the game's lock;
 * - 'none': no tab holds it;
 * - 'checking': Web Locks exist but the check for the current stored status has not answered yet;
 * - 'unknown': no Web Locks in this browser, or the check failed.
 * Checked again when the game, the stored status or `isActive` changes, and after a watched lock is
 * released. While another tab runs it, the lock is watched: when that tab finishes or closes, a
 * record it left "running" is paused at once, so this tab can resume it without reloading.
 */
export function useAnalysisOwner(gameId: string, storedStatus: AnalysisStatus | undefined, isActive: boolean): OwnerView {
  // The owner found for a given stored status. Until the check for the current status answers, the
  // hook returns 'checking' (or 'unknown' without Web Locks), never an answer given for another
  // status: a run another tab just started never shows as paused in between (review 4.8, M1).
  // Undefined before the first answer, so a game without analysis (no stored status) is not taken
  // for one already checked.
  const [checked, setChecked] = useState<{ owner: AnalysisOwner; status: AnalysisStatus | undefined } | undefined>(undefined);
  const [releases, setReleases] = useState(0);
  useEffect(() => {
    if (isActive) return undefined;
    let cancelled = false;
    let unwatch: () => void = () => undefined;
    analysisOwner(gameId)
      .then((found) => {
        if (cancelled) return;
        setChecked({ owner: found, status: storedStatus });
        if (found !== 'elsewhere') return;
        unwatch = onAnalysisLockReleased(gameId, () => {
          void recoverInterruptedAnalyses([gameId])
            .catch((e: unknown) => console.error('ChessQuest: não foi possível liberar a análise da outra aba', e))
            .finally(() => setReleases((r) => r + 1));
        });
      })
      .catch((e: unknown) => {
        console.error('ChessQuest: não foi possível saber se outra aba analisa esta partida', e);
        if (!cancelled) setChecked({ owner: 'unknown', status: storedStatus });
      });
    return () => {
      cancelled = true;
      unwatch();
    };
  }, [gameId, storedStatus, isActive, releases]);
  if (isActive) return 'here';
  if (checked && checked.status === storedStatus) return checked.owner;
  return hasAnalysisLocks() ? 'checking' : 'unknown';
}

/** What the analysis controls show: a status and which buttons (Sprint 4.8, T-1). */
export interface ControlView {
  status: AnalysisStatus | 'elsewhere';
  controls: 'stop' | 'start' | 'none';
}

/**
 * Controls for a game's analysis. Another tab's run shows no button: "Interromper" here could not
 * stop it, and starting would be refused. A "running" record no tab owns is shown as paused, with
 * "Retomar". Without Web Locks ("unknown") the stored status decides, as before Sprint 4.8.
 */
export function controlView(owner: OwnerView, stored: AnalysisStatus | undefined): ControlView {
  // Review 4.8 (M1): while checking, a "running" record shows no button: "Interromper" might belong to another tab.
  if (owner === 'checking') return stored === 'running' ? { status: 'running', controls: 'none' } : { status: stored ?? 'pending', controls: 'start' };
  if (owner === 'here') return { status: 'running', controls: 'stop' };
  if (owner === 'elsewhere') return { status: 'elsewhere', controls: 'none' };
  const status = stored ?? 'pending';
  if (status === 'running' && owner === 'none') return { status: 'paused', controls: 'start' };
  return { status, controls: status === 'running' ? 'stop' : 'start' };
}
