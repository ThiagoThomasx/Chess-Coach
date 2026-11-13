import 'fake-indexeddb/auto';
import { writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { liveQuery } from 'dexie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { analysisStatuses, listCompleteAnalyses } from '../src/db/analysisRepo';
import { analyzeGame, type EngineLike } from '../src/services/analysis/gameAnalyzer';
import { progressSaver, PROGRESS_SAVE_INTERVAL_MS } from '../src/services/analysis/progressSaver';
import type { Game, GameAnalysis, PositionAnalysis } from '../src/types/domain';

// Sprint 4.6, PA-1: reproducible before/after measurement on a synthetic library.
// The assertions use operation counts (stable); times are only written to the report file
// when PA1_REPORT_FILE is set: `PA1_REPORT_FILE=pa1.json npx vitest run tests/pa1-measurement.test.ts`.

const PLIES = 80;
const LIBRARY = 200;
const MULTI_PV = 3;
const PV_LENGTH = 12;
/** Median time per position with Stockfish 19 lite, depth 16, MultiPV 3 (measured, see the report). */
const MEDIAN_POSITION_MS = 786;

/** Deterministic legal game of PLIES plies (first non-capturing quiet move that keeps the game going, rotating). */
function syntheticGame(id: string): Game {
  const chess = new Chess();
  const moves: string[] = [];
  for (let i = 0; moves.length < PLIES; i++) {
    const legal = chess.moves({ verbose: true });
    const pick = legal[(i * 7) % legal.length];
    if (!pick) break;
    chess.move(pick);
    if (chess.isGameOver()) {
      chess.undo();
      const other = legal.find((m) => {
        chess.move(m);
        const over = chess.isGameOver();
        chess.undo();
        return !over;
      });
      if (!other) break;
      chess.move(other);
      moves.push(other.san);
      continue;
    }
    moves.push(pick.san);
  }
  return { id, hash: id, importId: 'i', importedAt: 1, headers: { white: 'A', black: 'B', result: '*', event: '', site: '', date: '' }, startFen: new Chess().fen(), moves } as unknown as Game;
}

/** Engine returning MULTI_PV lines of PV_LENGTH plies, advancing a fake clock by `stepMs` per search. */
function syntheticEngine(clock: { t: number }, stepMs: number): EngineLike {
  return {
    async analyze({ fen, depth = 16, multiPv = MULTI_PV }) {
      clock.t += stepMs;
      const legal = new Chess(fen).moves({ verbose: true });
      const lines = Array.from({ length: Math.min(multiPv, legal.length) }, (_, k) => ({
        multipv: k + 1,
        depth,
        score: { kind: 'cp' as const, value: 20 - k * 15 },
        pv: Array.from({ length: PV_LENGTH }, (_, j) => (j === 0 ? `${legal[k]!.from}${legal[k]!.to}` : 'e2e4')),
      }));
      return { fen, depth, multiPv, lines, complete: true, timeMs: stepMs } as PositionAnalysis;
    },
  };
}

interface WriteStats {
  writes: number;
  bytes: number;
}

/** Runs one analysis and counts what onProgress + the final save would write. */
async function measureRun(game: Game, stepMs: number, throttled: boolean): Promise<WriteStats & { updates: number }> {
  const clock = { t: 0 };
  const stats = { writes: 0, bytes: 0, updates: 0 };
  const write = async (a: GameAnalysis) => {
    stats.writes++;
    stats.bytes += JSON.stringify(a).length;
  };
  const save = throttled ? progressSaver(write, PROGRESS_SAVE_INTERVAL_MS, () => clock.t) : write;
  const result = await analyzeGame(game, { depth: 16, multiPv: MULTI_PV }, {
    engine: syntheticEngine(clock, stepMs),
    onProgress: async (a) => {
      stats.updates++;
      await save(a);
    },
  });
  await write(result); // the runner always saves the final state
  return stats;
}

const report: Record<string, unknown> = { plies: PLIES, library: LIBRARY, multiPv: MULTI_PV, pvLength: PV_LENGTH, intervalMs: PROGRESS_SAVE_INTERVAL_MS };

afterAll(() => {
  const file = process.env.PA1_REPORT_FILE;
  if (file) writeFileSync(file, JSON.stringify(report, null, 2));
});

describe('PA-1 writes during one analysis (synthetic 80-ply game)', () => {
  it('a fresh analysis at the measured median speed writes far fewer times', async () => {
    const game = syntheticGame('g');
    expect(game.moves).toHaveLength(PLIES);
    const before = await measureRun(game, MEDIAN_POSITION_MS, false);
    const after = await measureRun(game, MEDIAN_POSITION_MS, true);
    report.freshAnalysis = { before, after };
    expect(before.updates).toBe(PLIES + 1);
    expect(before.writes).toBe(PLIES + 2);
    expect(after.writes).toBeLessThanOrEqual(Math.ceil(((PLIES + 1) * MEDIAN_POSITION_MS) / PROGRESS_SAVE_INTERVAL_MS) + 1);
    expect(after.bytes).toBeLessThan(before.bytes / 2);
  });

  it('a re-analysis served by the cache (instant positions) writes once plus the final state', async () => {
    const game = syntheticGame('g');
    const before = await measureRun(game, 0, false);
    const after = await measureRun(game, 0, true);
    report.cachedReanalysis = { before, after };
    expect(before.writes).toBe(PLIES + 2);
    expect(after.writes).toBe(2);
  });
});

describe('PA-1 reads on a library of 200 analysed games', () => {
  let objectsRead = 0;
  let bytesRead = 0;

  beforeAll(async () => {
    setDb(new ChessQuestDB('pa1-measurement'));
    const engine = syntheticEngine({ t: 0 }, 0);
    const template = await analyzeGame(syntheticGame('t'), { depth: 16, multiPv: MULTI_PV }, { engine });
    const rows: GameAnalysis[] = Array.from({ length: LIBRARY }, (_, i) => ({ ...template, gameId: `g${i}`, status: i === 0 ? 'running' : 'complete' }));
    await getDb().analyses.bulkPut(rows);
    report.analysisBytes = JSON.stringify(template).length;
    getDb().analyses.hook('reading', (obj: GameAnalysis) => {
      objectsRead++;
      bytesRead += JSON.stringify(obj).length;
      return obj;
    });
  });

  async function measure<T>(name: string, fn: () => Promise<T>): Promise<{ objects: number; bytes: number; ms: number }> {
    objectsRead = 0;
    bytesRead = 0;
    const t = performance.now();
    await fn();
    const out = { objects: objectsRead, bytes: bytesRead, ms: Math.round((performance.now() - t) * 10) / 10 };
    report[name] = out;
    return out;
  }

  it('the games list status query reads no analysis record', async () => {
    const before = await measure('statusBefore', async () => new Map((await getDb().analyses.toArray()).map((a) => [a.gameId, a.status])));
    const after = await measure('statusAfter', () => analysisStatuses());
    expect(before.objects).toBe(LIBRARY);
    expect(after.objects).toBe(0);
    expect(after.bytes).toBe(0);
    expect((await analysisStatuses()).size).toBe(LIBRARY);
  });

  it('the stats pages load only complete analyses', async () => {
    const before = await measure('statsBefore', () => getDb().analyses.toArray());
    const after = await measure('statsAfter', () => listCompleteAnalyses());
    expect(before.objects).toBe(LIBRARY);
    expect(after.objects).toBe(LIBRARY - 1);
  });

  it('progress writes of a running analysis re-run the live queries: counted before and after', async () => {
    // Counts how many times each live query runs while the running analysis is saved 20 times.
    const runs = { all: 0, complete: 0, statuses: 0 };
    // The baseline is taken after each query's first result, not after a fixed delay (a slow runner
    // would otherwise count the initial run as a re-run; pre-integration review).
    const firstResults: Promise<void>[] = [];
    const watch = <T,>(query: () => Promise<T>) => {
      let first!: () => void;
      firstResults.push(new Promise<void>((r) => (first = r)));
      return liveQuery(query).subscribe(() => first());
    };
    const subs = [
      watch(async () => (runs.all++, getDb().analyses.toArray())),
      watch(async () => (runs.complete++, listCompleteAnalyses())),
      watch(async () => (runs.statuses++, analysisStatuses())),
    ];
    await Promise.all(firstResults);
    const initial = { ...runs };
    const running = (await getDb().analyses.get('g0')) as GameAnalysis;
    for (let i = 0; i < 20; i++) {
      await getDb().analyses.put({ ...running, updatedAt: i });
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 50));
    subs.forEach((s) => s.unsubscribe());
    const reruns = { all: runs.all - initial.all, complete: runs.complete - initial.complete, statuses: runs.statuses - initial.statuses };
    report.liveQueryRerunsPer20Writes = reruns;
    // A full-table query re-runs on every write; the complete-only query is not affected by a running row.
    expect(reruns.all).toBeGreaterThan(0);
    expect(reruns.complete).toBe(0);
  });
});
