import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { getGame, importPgn } from '../src/db/gamesRepo';
import { analysisStatuses, listCompleteAnalyses, saveAnalysis } from '../src/db/analysisRepo';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { startAnalysis, stopAnalysis, subscribe } from '../src/services/analysis/analysisRunner';
import { progressSaver, PROGRESS_SAVE_INTERVAL_MS } from '../src/services/analysis/progressSaver';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import type { Game, GameAnalysis } from '../src/types/domain';
import { OPERA_GAME } from './fixtures';
import { newerAnalysis } from '../src/features/analysis/useLiveAnalysis';

// Sprint 4.6, PA-1: progress is persisted at most every PROGRESS_SAVE_INTERVAL_MS; final states always.

/** Median time per position measured with Stockfish 19 lite at depth 16, MultiPV 3 (see the PA-1 report). */
const MEDIAN_POSITION_MS = 786;
const settings = { ...DEFAULT_SETTINGS, analysisDepth: 12 };
let n = 0;

/** Engine that takes `stepMs` of (fake) time per position; `onCall(i)` runs before the i-th search. */
function timedEngine(stepMs: number, onCall?: (i: number) => void): EngineLike {
  let i = 0;
  return {
    async analyze({ fen, depth = 12, multiPv = 1 }) {
      onCall?.(i++);
      vi.setSystemTime(Date.now() + stepMs);
      return { fen, depth, multiPv, lines: [{ multipv: 1, score: { kind: 'cp', value: 10 }, pv: [], depth }], complete: true, timeMs: stepMs };
    },
  };
}

async function opera(): Promise<Game> {
  const r = await importPgn(OPERA_GAME, 'opera.pgn', []);
  const game = await getGame(r.imported[0]?.id ?? '');
  if (!game) throw new Error('not imported');
  return game;
}

/** Counts every write to the analyses table (put = create or update). */
function countWrites(): { count: () => number } {
  let c = 0;
  const db = getDb();
  db.analyses.hook('creating', () => {
    c++;
  });
  db.analyses.hook('updating', () => {
    c++;
  });
  return { count: () => c };
}

const evaluated = (a: GameAnalysis | undefined) => a?.positions.filter((p) => p !== null).length ?? 0;

beforeEach(() => {
  setDb(new ChessQuestDB(`progress-${++n}`));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('progressSaver (Sprint 4.6, PA-1)', () => {
  it('saves the first update at once, then at most once per interval', async () => {
    let t = 0;
    const saved: number[] = [];
    const save = progressSaver(async (a: GameAnalysis) => void saved.push(a.updatedAt), 2000, () => t);
    for (const at of [0, 500, 1000, 1999, 2000, 2500, 4100]) {
      t = at;
      await save({ updatedAt: at } as GameAnalysis);
    }
    expect(saved).toEqual([0, 2000, 4100]);
  });

  it('reports whether it saved', async () => {
    let t = 0;
    const save = progressSaver(async () => undefined, 1000, () => t);
    expect(await save({} as GameAnalysis)).toBe(true);
    t = 10;
    expect(await save({} as GameAnalysis)).toBe(false);
  });
});

describe('the runner persists progress with fewer writes and never loses the final state (Sprint 4.6, PA-1)', () => {
  it('groups intermediate updates: far fewer writes than positions, and the stored result is the full analysis', async () => {
    const game = await opera();
    const writes = countWrites();
    const out = await startAnalysis(game, settings, timedEngine(MEDIAN_POSITION_MS));
    const positions = game.moves.length + 1;
    expect(out.analysis.status).toBe('complete');
    // Before PA-1: one write per position plus the final one.
    expect(writes.count()).toBeLessThan(positions / 2);
    expect(writes.count()).toBeGreaterThanOrEqual(Math.floor((positions * MEDIAN_POSITION_MS) / PROGRESS_SAVE_INTERVAL_MS));
    const stored = await getDb().analyses.get(game.id);
    expect(stored?.status).toBe('complete');
    expect(evaluated(stored)).toBe(positions);
    expect(stored?.reviews).toEqual(out.analysis.reviews);
  });

  it('still notifies listeners after every position (the analysis screen stays live)', async () => {
    const game = await opera();
    const seen: GameAnalysis[] = [];
    const off = subscribe(game.id, (a) => seen.push(a));
    await startAnalysis(game, settings, timedEngine(MEDIAN_POSITION_MS));
    off();
    expect(seen).toHaveLength(game.moves.length + 2); // each position, then the final result
    expect(seen.at(-1)?.status).toBe('complete');
  });

  it('a pause persists every position evaluated so far, including ones not yet written', async () => {
    const game = await opera();
    const out = await startAnalysis(game, settings, timedEngine(300, (i) => i === 10 && stopAnalysis(game.id)));
    expect(out.analysis.status).toBe('paused');
    const stored = await getDb().analyses.get(game.id);
    expect(stored?.status).toBe('paused');
    expect(evaluated(stored)).toBe(evaluated(out.analysis));
    expect(evaluated(stored)).toBe(11);
  });

  it('a failure persists the error and the positions evaluated before it', async () => {
    const game = await opera();
    const failing = timedEngine(300, (i) => {
      if (i === 7) throw new Error('motor caiu');
    });
    const out = await startAnalysis(game, settings, failing);
    expect(out.analysis.status).toBe('error');
    const stored = await getDb().analyses.get(game.id);
    expect(stored?.status).toBe('error');
    expect(stored?.error).toBe('motor caiu');
    expect(evaluated(stored)).toBe(7);
  });

  it('a cancelled search pauses, and resuming completes from the stored positions', async () => {
    const game = await opera();
    const cancelling = timedEngine(300, (i) => {
      if (i === 5) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    });
    expect((await startAnalysis(game, settings, cancelling)).analysis.status).toBe('paused');
    expect((await getDb().analyses.get(game.id))?.status).toBe('paused');
    let calls = 0;
    const resumed = await startAnalysis(game, settings, timedEngine(300, () => calls++));
    expect(resumed.analysis.status).toBe('complete');
    expect(evaluated(await getDb().analyses.get(game.id))).toBe(game.moves.length + 1);
    // Stored (and cached) positions are not searched again.
    expect(calls).toBeLessThanOrEqual(game.moves.length + 1 - 5);
  });

  it('nothing is written after the run ends: no late write can overwrite the final state', async () => {
    const game = await opera();
    const writes = countWrites();
    await startAnalysis(game, settings, timedEngine(MEDIAN_POSITION_MS));
    const after = writes.count();
    vi.setSystemTime(Date.now() + 60_000);
    await new Promise((r) => setTimeout(r, 30));
    expect(writes.count()).toBe(after);
    expect((await getDb().analyses.get(game.id))?.status).toBe('complete');
  });
});

describe('status queries do not load analyses (Sprint 4.6, PA-1)', () => {
  const analysis = (gameId: string, status: GameAnalysis['status']): GameAnalysis => ({
    gameId,
    status,
    settings: { depth: 12, multiPv: 1 },
    positions: [null, null],
    reviews: [],
    startedAt: 1,
    updatedAt: 1,
  });

  it('analysisStatuses reads only the status index (no record is read)', async () => {
    await Promise.all([saveAnalysis(analysis('a', 'complete')), saveAnalysis(analysis('b', 'running')), saveAnalysis(analysis('c', 'paused'))]);
    let reads = 0;
    getDb().analyses.hook('reading', (obj) => {
      reads++;
      return obj;
    });
    await getDb().analyses.toArray();
    expect(reads).toBe(3); // the hook does see full reads
    reads = 0;
    const map = await analysisStatuses();
    expect(reads).toBe(0);
    expect([...map.entries()].sort()).toEqual([
      ['a', 'complete'],
      ['b', 'running'],
      ['c', 'paused'],
    ]);
  });

  it('listCompleteAnalyses loads only complete analyses', async () => {
    await Promise.all([saveAnalysis(analysis('a', 'complete')), saveAnalysis(analysis('b', 'running')), saveAnalysis(analysis('c', 'error'))]);
    expect((await listCompleteAnalyses()).map((a) => a.gameId)).toEqual(['a']);
  });
});

describe('the analysis screen shows the newer of stored and live progress (Sprint 4.6, PA-1)', () => {
  const at = (updatedAt: number, status: GameAnalysis['status'] = 'running') => ({ gameId: 'g', status, updatedAt }) as GameAnalysis;

  it('prefers the live analysis only while it is newer than the stored one', () => {
    expect(newerAnalysis(at(1), at(5))?.updatedAt).toBe(5);
    expect(newerAnalysis(at(9, 'complete'), at(5))?.status).toBe('complete');
  });

  it('a tie goes to the stored record (it may carry the derivation mark)', () => {
    const stored = { ...at(5, 'complete'), derivation: 'done' } as GameAnalysis;
    expect(newerAnalysis(stored, at(5))).toBe(stored);
  });

  it('uses whichever exists', () => {
    expect(newerAnalysis(undefined, at(3))?.updatedAt).toBe(3);
    expect(newerAnalysis(at(3), null)?.updatedAt).toBe(3);
    expect(newerAnalysis(undefined, null)).toBeUndefined();
  });
});
