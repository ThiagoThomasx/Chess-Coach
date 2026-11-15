import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChessQuestDB, setDb } from '../src/db/database';
import { getGame, importPgn } from '../src/db/gamesRepo';
import { getAnalysis, recoverInterruptedAnalyses, saveAnalysis } from '../src/db/analysisRepo';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { emptyAnalysis, type EngineLike } from '../src/services/analysis/gameAnalyzer';
import { AnalysisElsewhereError, isRunning, reconcileDerivations, startAnalysis } from '../src/services/analysis/analysisRunner';
import { analysisLockName, analysisOwner, onAnalysisLockReleased, setAnalysisLockManager, withAnalysisLock } from '../src/services/analysis/analysisLock';
import { controlView } from '../src/features/analysis/useAnalysisOwner';
import type { Game } from '../src/types/domain';
import { OPERA_GAME, SHORT_BLUNDER_GAME } from './fixtures';

// Sprint 4.8, T-1: one analysis per game across tabs, with the browser's Web Locks as the owner mark.
// Node ships the same API (navigator.locks); a lock held by the test stands for "another tab".

const settings = { ...DEFAULT_SETTINGS, analysisDepth: 10 };
let n = 0;

const quietEngine = (onCall?: () => Promise<void> | void): EngineLike => ({
  async analyze({ fen, depth = 10, multiPv = 1 }) {
    await onCall?.();
    return { fen, depth, multiPv, lines: [{ multipv: 1, score: { kind: 'cp', value: 10 }, pv: [], depth }], complete: true, timeMs: 1 };
  },
});

async function opera(): Promise<Game> {
  const r = await importPgn(OPERA_GAME, 'opera.pgn', []);
  const game = await getGame(r.imported[0]?.id ?? '');
  if (!game) throw new Error('not imported');
  return game;
}

/** Holds a lock like another tab would; the returned function releases it and waits until it is free. */
async function holdElsewhere(name: string): Promise<() => Promise<void>> {
  let done: () => void = () => undefined;
  let held: Promise<unknown> = Promise.resolve();
  await new Promise<void>((granted) => {
    held = navigator.locks.request(name, () => {
      granted();
      return new Promise<void>((resolve) => {
        done = resolve;
      });
    });
  });
  return async () => {
    done();
    await held;
  };
}

async function heldNames(): Promise<string[]> {
  return ((await navigator.locks.query()).held ?? []).map((l) => l.name ?? '');
}

beforeEach(() => {
  setDb(new ChessQuestDB(`lock-${++n}`));
  setAnalysisLockManager(undefined);
});
afterEach(() => {
  setAnalysisLockManager(undefined);
});

describe('withAnalysisLock (Sprint 4.8, T-1)', () => {
  it('runs the work holding the game lock and releases it afterwards', async () => {
    let during: string[] = [];
    const out = await withAnalysisLock('g1', async () => {
      during = await heldNames();
      return 42;
    });
    expect(out).toEqual({ acquired: true, value: 42 });
    expect(during).toContain(analysisLockName('g1'));
    expect(await heldNames()).not.toContain(analysisLockName('g1'));
  });

  it('does not run the work while another tab holds the lock', async () => {
    const release = await holdElsewhere(analysisLockName('g1'));
    let ran = false;
    const out = await withAnalysisLock('g1', async () => {
      ran = true;
    });
    await release();
    expect(out).toEqual({ acquired: false });
    expect(ran).toBe(false);
  });

  it('releases the lock when the work fails', async () => {
    await expect(withAnalysisLock('g1', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await heldNames()).not.toContain(analysisLockName('g1'));
  });

  it('runs the work without the API (older browsers keep the previous behaviour)', async () => {
    setAnalysisLockManager(null);
    expect(await withAnalysisLock('g1', async () => 'ok')).toEqual({ acquired: true, value: 'ok' });
  });
});

describe('analysisOwner and onAnalysisLockReleased (Sprint 4.8, T-1)', () => {
  it('tells a game analysed in another tab from a free one, and "unknown" without the API', async () => {
    expect(await analysisOwner('g1')).toBe('none');
    const release = await holdElsewhere(analysisLockName('g1'));
    expect(await analysisOwner('g1')).toBe('elsewhere');
    await release();
    expect(await analysisOwner('g1')).toBe('none');
    setAnalysisLockManager(null);
    expect(await analysisOwner('g1')).toBe('unknown');
  });

  it('calls back once the other tab releases the lock, without keeping it', async () => {
    const release = await holdElsewhere(analysisLockName('g1'));
    const released = new Promise<void>((resolve) => onAnalysisLockReleased('g1', resolve));
    await release();
    await released;
    expect(await analysisOwner('g1')).toBe('none');
  });

  it('cancelling the watch neither calls back nor blocks the lock', async () => {
    const release = await holdElsewhere(analysisLockName('g1'));
    let called = false;
    const cancel = onAnalysisLockReleased('g1', () => {
      called = true;
    });
    cancel();
    await release();
    expect((await withAnalysisLock('g1', async () => 'mine')).acquired).toBe(true);
    expect(called).toBe(false);
  });
});

describe('startAnalysis owns the game lock (Sprint 4.8, T-1)', () => {
  it('holds the lock for the whole run and releases it at the end', async () => {
    const game = await opera();
    const seen: string[][] = [];
    const out = await startAnalysis(
      game,
      settings,
      quietEngine(async () => {
        if (seen.length < 2) seen.push(await heldNames());
      }),
    );
    expect(out.analysis.status).toBe('complete');
    expect(seen.every((names) => names.includes(analysisLockName(game.id)))).toBe(true);
    expect(await heldNames()).not.toContain(analysisLockName(game.id));
  });

  it('refuses to start while another tab analyses the same game: nothing is written', async () => {
    const game = await opera();
    const release = await holdElsewhere(analysisLockName(game.id));
    let searches = 0;
    await expect(startAnalysis(game, settings, quietEngine(() => void searches++))).rejects.toBeInstanceOf(AnalysisElsewhereError);
    await release();
    expect(searches).toBe(0);
    expect(await getAnalysis(game.id)).toBeUndefined();
    expect(isRunning(game.id)).toBe(false);
  });

  it('starts normally once the other tab is done', async () => {
    const game = await opera();
    const release = await holdElsewhere(analysisLockName(game.id));
    await expect(startAnalysis(game, settings, quietEngine())).rejects.toBeInstanceOf(AnalysisElsewhereError);
    await release();
    expect((await startAnalysis(game, settings, quietEngine())).analysis.status).toBe('complete');
  });
});

describe('recoverInterruptedAnalyses respects the owner (Sprint 4.8, T-1)', () => {
  it('leaves an analysis that another tab is running as "running" and pauses the orphans', async () => {
    const live = await opera();
    const orphan = (await importPgn(SHORT_BLUNDER_GAME, 'b.pgn', [])).imported[0]!;
    await saveAnalysis({ ...emptyAnalysis(live, { depth: 10, multiPv: 1 }), status: 'running' });
    await saveAnalysis({ ...emptyAnalysis(orphan, { depth: 10, multiPv: 1 }), status: 'running' });
    const release = await holdElsewhere(analysisLockName(live.id));
    expect(await recoverInterruptedAnalyses()).toBe(1);
    await release();
    expect((await getAnalysis(live.id))?.status).toBe('running');
    expect((await getAnalysis(orphan.id))?.status).toBe('paused');
  });

  it('can recover a single game (a tab that closed while this one watched)', async () => {
    const a = await opera();
    const b = (await importPgn(SHORT_BLUNDER_GAME, 'b.pgn', [])).imported[0]!;
    await saveAnalysis({ ...emptyAnalysis(a, { depth: 10, multiPv: 1 }), status: 'running' });
    await saveAnalysis({ ...emptyAnalysis(b, { depth: 10, multiPv: 1 }), status: 'running' });
    expect(await recoverInterruptedAnalyses([a.id])).toBe(1);
    expect((await getAnalysis(a.id))?.status).toBe('paused');
    expect((await getAnalysis(b.id))?.status).toBe('running');
  });

  it('pauses every running analysis without the API (previous behaviour)', async () => {
    setAnalysisLockManager(null);
    const game = await opera();
    await saveAnalysis({ ...emptyAnalysis(game, { depth: 10, multiPv: 1 }), status: 'running' });
    expect(await recoverInterruptedAnalyses()).toBe(1);
    expect((await getAnalysis(game.id))?.status).toBe('paused');
  });

  it('does not overwrite a record that changed after it was read (a run that just started)', async () => {
    const game = await opera();
    const stale = { ...emptyAnalysis(game, { depth: 10, multiPv: 1 }), status: 'running' as const, updatedAt: 1 };
    await saveAnalysis(stale);
    const newer = { ...stale, updatedAt: 2 };
    expect(await recoverInterruptedAnalyses(undefined, async () => saveAnalysis(newer))).toBe(0);
    expect((await getAnalysis(game.id))?.updatedAt).toBe(2);
    expect((await getAnalysis(game.id))?.status).toBe('running');
  });
});

describe('controlView: what the analysis controls show (Sprint 4.8, T-1)', () => {
  it('another tab\'s run shows no button, whatever is stored', () => {
    expect(controlView('elsewhere', 'running')).toEqual({ status: 'elsewhere', controls: 'none' });
    expect(controlView('elsewhere', 'paused')).toEqual({ status: 'elsewhere', controls: 'none' });
  });

  it('this tab\'s run can be stopped', () => {
    expect(controlView('here', 'paused')).toEqual({ status: 'running', controls: 'stop' });
  });

  it('a "running" record no tab owns shows as paused, with "Retomar"', () => {
    expect(controlView('none', 'running')).toEqual({ status: 'paused', controls: 'start' });
    expect(controlView('none', 'complete')).toEqual({ status: 'complete', controls: 'start' });
    expect(controlView('none', undefined)).toEqual({ status: 'pending', controls: 'start' });
  });

  it('without Web Locks the stored status decides, as before', () => {
    expect(controlView('unknown', 'running')).toEqual({ status: 'running', controls: 'stop' });
    expect(controlView('unknown', 'paused')).toEqual({ status: 'paused', controls: 'start' });
  });
});

describe('controlView while the owner is being checked (review 4.8, M1)', () => {
  it('a running record shows no button until the owner is known; other states keep their buttons', () => {
    expect(controlView('checking', 'running')).toEqual({ status: 'running', controls: 'none' });
    expect(controlView('checking', 'paused')).toEqual({ status: 'paused', controls: 'start' });
  });
});

describe('reconcileDerivations respects the run of another tab (pre-closure audit, MEDIUM 2)', () => {
  it('leaves a pending derivation whose game another tab holds, and does it once the lock is free', async () => {
    const game = await opera();
    await saveAnalysis({ ...emptyAnalysis(game, { depth: 10, multiPv: 1 }), status: 'complete', derivation: 'pending' });
    const release = await holdElsewhere(analysisLockName(game.id));
    expect(await reconcileDerivations(settings)).toBe(0);
    expect((await getAnalysis(game.id))?.derivation).toBe('pending');
    await release();
    expect(await reconcileDerivations(settings)).toBe(1);
    expect((await getAnalysis(game.id))?.derivation).toBe('done');
  });

  it('without Web Locks, derives as before', async () => {
    setAnalysisLockManager(null);
    const game = await opera();
    await saveAnalysis({ ...emptyAnalysis(game, { depth: 10, multiPv: 1 }), status: 'complete', derivation: 'pending' });
    expect(await reconcileDerivations(settings)).toBe(1);
    expect((await getAnalysis(game.id))?.derivation).toBe('done');
  });
});
