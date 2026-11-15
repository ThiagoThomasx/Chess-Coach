// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { ChessQuestDB, setDb } from '../src/db/database';
import { getAnalysis, saveAnalysis } from '../src/db/analysisRepo';
import { getGame, importPgn } from '../src/db/gamesRepo';
import { emptyAnalysis } from '../src/services/analysis/gameAnalyzer';
import { analysisLockName, setAnalysisLockManager } from '../src/services/analysis/analysisLock';
import { useAnalysisOwner } from '../src/features/analysis/useAnalysisOwner';
import type { AnalysisStatus, Game } from '../src/types/domain';
import { FakeLocks } from './support/fakeLocks';
import { OPERA_GAME, SHORT_BLUNDER_GAME } from './fixtures';

// Sprint 4.8, T-1: the hook that tells the analysis controls who runs a game's analysis.
// jsdom has no Web Locks: FakeLocks stands in for them, and holdElsewhere() plays another tab.

let locks: FakeLocks;
let n = 0;

beforeEach(() => {
  setDb(new ChessQuestDB(`owner-hook-${++n}`));
  locks = new FakeLocks();
  setAnalysisLockManager(locks);
});
afterEach(() => {
  cleanup();
  setAnalysisLockManager(undefined);
  vi.restoreAllMocks();
});

interface Props {
  gameId: string;
  status: AnalysisStatus | undefined;
  isActive: boolean;
}

const render = (initial: Props) => renderHook((p: Props) => useAnalysisOwner(p.gameId, p.status, p.isActive), { initialProps: initial });

/** A promise resolved from outside, to hold an answer until the test lets it go. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * For negative assertions only ("nothing happened later"): long enough for a recovery that had
 * wrongly started to finish on fake-indexeddb. Positive assertions use waitFor instead.
 */
const QUIET_MS = 50;
const quietPeriod = () => new Promise((r) => setTimeout(r, QUIET_MS));

async function runningGame(pgn = OPERA_GAME): Promise<Game> {
  const game = (await getGame((await importPgn(pgn, 'a.pgn', [])).imported[0]!.id))!;
  await saveAnalysis({ ...emptyAnalysis(game, { depth: 10, multiPv: 1 }), status: 'running' });
  return game;
}

describe('useAnalysisOwner (Sprint 4.8, T-1)', () => {
  it('is "here" while this tab runs the analysis, without asking the browser', () => {
    const { result } = render({ gameId: 'g1', status: 'running', isActive: true });
    expect(result.current).toBe('here');
    expect(locks.queries).toBe(0);
  });

  it('is "checking" until the browser answers, then "elsewhere" when another tab holds the lock', async () => {
    locks.holdElsewhere(analysisLockName('g1'));
    const { result } = render({ gameId: 'g1', status: 'running', isActive: false });
    expect(result.current).toBe('checking');
    await waitFor(() => expect(result.current).toBe('elsewhere'));
  });

  it('is "none" when no tab holds the lock, and then watches nothing', async () => {
    const { result } = render({ gameId: 'g1', status: 'running', isActive: false });
    await waitFor(() => expect(result.current).toBe('none'));
    // A watch on a free lock would fire at once and start a recovery and a new check.
    await quietPeriod();
    expect(locks.queries).toBe(1);
    expect(result.current).toBe('none');
  });

  it('a game without analysis (no stored status) is "checking" too until the browser answers', async () => {
    // Another tab may have just started its first analysis and not saved it yet.
    locks.holdElsewhere(analysisLockName('g1'));
    const { result } = render({ gameId: 'g1', status: undefined, isActive: false });
    expect(result.current).toBe('checking');
    await waitFor(() => expect(result.current).toBe('elsewhere'));
  });

  it('a game without analysis and no owner ends as "none"', async () => {
    const { result } = render({ gameId: 'g1', status: undefined, isActive: false });
    expect(result.current).toBe('checking');
    await waitFor(() => expect(result.current).toBe('none'));
  });

  it('is "unknown" without Web Locks, from the first render', () => {
    setAnalysisLockManager(null);
    const { result } = render({ gameId: 'g1', status: 'running', isActive: false });
    expect(result.current).toBe('unknown');
  });

  it('a new stored status goes back to "checking": an old answer is never shown for it (review 4.8, M1)', async () => {
    const { result, rerender } = render({ gameId: 'g1', status: 'paused', isActive: false });
    await waitFor(() => expect(result.current).toBe('none'));
    // Another tab starts the run: it holds the lock, and the stored status becomes "running" before
    // this tab's new check answers. The lock really is held, so the watch that follows only queues
    // (a free lock would grant it at once and start a recovery that outlives the test).
    locks.holdElsewhere(analysisLockName('g1'));
    const answer = deferred<{ held?: { name?: string }[] }>();
    locks.queryOverride = () => answer.promise;
    rerender({ gameId: 'g1', status: 'running', isActive: false });
    expect(result.current).toBe('checking');
    answer.resolve({ held: [{ name: analysisLockName('g1') }] });
    await waitFor(() => expect(result.current).toBe('elsewhere'));
    expect(locks.pending(analysisLockName('g1'))).toBe(1);
  });

  it('an answer that arrives after the game changed is ignored, and starts no watch', async () => {
    locks.holdElsewhere(analysisLockName('g1'));
    const late = deferred<{ held?: { name?: string }[] }>();
    locks.queryOverride = () => late.promise;
    const { result, rerender } = render({ gameId: 'g1', status: 'running', isActive: false });
    locks.queryOverride = undefined;
    rerender({ gameId: 'g2', status: 'paused', isActive: false });
    await waitFor(() => expect(result.current).toBe('none'));
    // g1 was held elsewhere, but that answer belongs to the game that is no longer shown.
    late.resolve({ held: [{ name: analysisLockName('g1') }] });
    await quietPeriod();
    expect(result.current).toBe('none');
    // The answer for g1 says "elsewhere": acting on it would have queued a watch on g1's lock.
    expect(locks.pending(analysisLockName('g1'))).toBe(0);
  });

  it('becomes "here" when this tab starts, and asks again when it stops', async () => {
    const { result, rerender } = render({ gameId: 'g1', status: 'paused', isActive: false });
    await waitFor(() => expect(result.current).toBe('none'));
    rerender({ gameId: 'g1', status: 'paused', isActive: true });
    expect(result.current).toBe('here');
    const before = locks.queries;
    rerender({ gameId: 'g1', status: 'complete', isActive: false });
    await waitFor(() => expect(result.current).toBe('none'));
    expect(locks.queries).toBeGreaterThan(before);
  });

  it('a failed check is "unknown" and is reported', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    locks.queryOverride = () => Promise.reject(new Error('query falhou'));
    const { result } = render({ gameId: 'g1', status: 'running', isActive: false });
    await waitFor(() => expect(result.current).toBe('unknown'));
    expect(error).toHaveBeenCalledWith('ChessQuest: não foi possível saber se outra aba analisa esta partida', expect.any(Error));
  });
});

describe('useAnalysisOwner watches the other tab (Sprint 4.8, T-1)', () => {
  it('when the other tab closes, pauses the record it left running and finds no owner', async () => {
    const game = await runningGame();
    const release = locks.holdElsewhere(analysisLockName(game.id));
    const { result } = render({ gameId: game.id, status: 'running', isActive: false });
    await waitFor(() => expect(result.current).toBe('elsewhere'));
    expect(locks.pending(analysisLockName(game.id))).toBe(1);
    release();
    await waitFor(() => expect(result.current).toBe('none'));
    await waitFor(async () => expect((await getAnalysis(game.id))?.status).toBe('paused'));
    // The watch took the lock only for that instant.
    expect(locks.isHeld(analysisLockName(game.id))).toBe(false);
  });

  it('recovers only the game it watched: another game left running stays as it is', async () => {
    const game = await runningGame();
    const other = await runningGame(SHORT_BLUNDER_GAME);
    const release = locks.holdElsewhere(analysisLockName(game.id));
    const { result } = render({ gameId: game.id, status: 'running', isActive: false });
    await waitFor(() => expect(result.current).toBe('elsewhere'));
    release();
    await waitFor(async () => expect((await getAnalysis(game.id))?.status).toBe('paused'));
    await waitFor(() => expect(result.current).toBe('none'));
    expect((await getAnalysis(other.id))?.status).toBe('running');
  });

  it('when the other tab finishes normally, the completed record is left as it is', async () => {
    const game = await runningGame();
    const release = locks.holdElsewhere(analysisLockName(game.id));
    const { result } = render({ gameId: game.id, status: 'running', isActive: false });
    await waitFor(() => expect(result.current).toBe('elsewhere'));
    await saveAnalysis({ ...(await getAnalysis(game.id))!, status: 'complete' });
    release();
    await waitFor(() => expect(result.current).toBe('none'));
    expect((await getAnalysis(game.id))?.status).toBe('complete');
  });

  it('leaving the screen cancels the watch: nothing is recovered later and the lock is not queued', async () => {
    const game = await runningGame();
    const release = locks.holdElsewhere(analysisLockName(game.id));
    const { result, unmount } = render({ gameId: game.id, status: 'running', isActive: false });
    await waitFor(() => expect(result.current).toBe('elsewhere'));
    unmount();
    expect(locks.pending(analysisLockName(game.id))).toBe(0);
    const queries = locks.queries;
    release();
    await quietPeriod();
    // No recovery ran (it would have read the held locks and paused the record).
    expect(locks.queries).toBe(queries);
    expect((await getAnalysis(game.id))?.status).toBe('running');
  });

  it('a failed recovery is reported and the owner is checked again anyway', async () => {
    const game = await runningGame();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const release = locks.holdElsewhere(analysisLockName(game.id));
    const { result } = render({ gameId: game.id, status: 'running', isActive: false });
    await waitFor(() => expect(result.current).toBe('elsewhere'));
    // The recovery reads the held locks first: that read fails once, when the watch fires.
    locks.queryOverride = () => {
      locks.queryOverride = undefined;
      return Promise.reject(new Error('query falhou'));
    };
    release();
    await waitFor(() => expect(error).toHaveBeenCalledWith('ChessQuest: não foi possível liberar a análise da outra aba', expect.any(Error)));
    // Checked again: nobody owns it now. The record stays "running" (the controls show it as paused).
    await waitFor(() => expect(result.current).toBe('none'));
    expect((await getAnalysis(game.id))?.status).toBe('running');
  });
});
