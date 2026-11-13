import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { deleteGame, getGame, importPgn } from '../src/db/gamesRepo';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { startAnalysis, subscribe } from '../src/services/analysis/analysisRunner';
import type { GameAnalysis } from '../src/types/domain';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import { OPERA_GAME } from './fixtures';

// Sprint 4.6 consolidated audit: reproductions of the findings (docs/SPRINT4-6-AUDITORIA-CONSOLIDADA.md).

const settings = { ...DEFAULT_SETTINGS, analysisDepth: 12 };
let n = 0;

beforeEach(() => {
  setDb(new ChessQuestDB(`audit-46-${++n}`));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AC-1: deleting a game while its analysis runs', () => {
  it('stops the run and leaves no analysis behind for the deleted game', async () => {
    const r = await importPgn(OPERA_GAME, 'opera.pgn', ['Morphy']);
    const game = (await getGame(r.imported[0]!.id))!;
    let calls = 0;
    const engine: EngineLike = {
      async analyze({ fen, depth = 12, multiPv = 1 }) {
        calls++;
        // The user deletes the game from the list while the 4th position is being searched.
        if (calls === 4) await deleteGame(game.id);
        vi.setSystemTime(Date.now() + 3000);
        return { fen, depth, multiPv, lines: [{ multipv: 1, score: { kind: 'cp', value: 10 }, pv: [], depth }], complete: true, timeMs: 3000 };
      },
    };
    await startAnalysis(game, settings, engine);
    expect(await getDb().games.get(game.id)).toBeUndefined();
    expect(await getDb().analyses.get(game.id)).toBeUndefined();
    // The engine is freed for other work right after the position it was searching.
    expect(calls).toBeLessThanOrEqual(5);
  });
});

describe('AC-3: a storage failure during an analysis', () => {
  it('ends the run as an error, stored and announced, instead of leaving it "running"', async () => {
    const r = await importPgn(OPERA_GAME, 'opera.pgn', ['Morphy']);
    const game = (await getGame(r.imported[0]!.id))!;
    let calls = 0;
    const engine: EngineLike = {
      async analyze({ fen, depth = 12, multiPv = 1 }) {
        calls++;
        vi.setSystemTime(Date.now() + 3000);
        return { fen, depth, multiPv, lines: [{ multipv: 1, score: { kind: 'cp', value: 10 }, pv: [], depth }], complete: true, timeMs: 3000 };
      },
    };
    // The 3rd write to the analyses table fails (quota, I/O): a progress save in the middle of the run.
    let writes = 0;
    const fail = () => {
      if (++writes === 3) throw new Error('simulated storage failure');
    };
    getDb().analyses.hook('creating', fail);
    getDb().analyses.hook('updating', fail);
    const seen: GameAnalysis[] = [];
    const off = subscribe(game.id, (a) => seen.push(a));
    await expect(startAnalysis(game, settings, engine)).rejects.toThrow();
    off();
    // The screen is told the run is over (useLiveAnalysis drops its running copy on a non-running status).
    expect(seen.at(-1)?.status).toBe('error');
    // And the stored record is not left 'running' for the rest of the session.
    expect((await getDb().analyses.get(game.id))?.status).toBe('error');
    expect(calls).toBeGreaterThan(0);
  });
});

describe('AC-7: refutation consequence (B1) at its limits', () => {
  // White: Ke1, Rd2; Black: Ke8, Qd5 (same position as tests/refutation.test.ts).
  const ROOK_QUEEN = '4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1';
  const cp = (value: number) => ({ kind: 'cp' as const, value });

  it('does not claim a material loss when the reference line cannot be compared (not settled)', async () => {
    const { consequenceOf } = await import('../src/services/exercises/refutation');
    // The user's line settles a rook down, but the reference line stops on a capture: the best move might lose
    // the same material, so "perde material" would blame the move for something the position already had.
    const text = consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(-600), reference: cp(-200), pv: ['d2d4', 'd5d4', 'e1f1', 'e8e7'], referencePv: ['d2d4', 'd5d4'] });
    expect(text).not.toMatch(/material/);
    expect(text).toBe('a posição passa de desvantagem para posição perdida');
  });

  it('band edges: 80 and 60 belong to the upper band, 40 and 20 to the lower one', async () => {
    const { consequenceOf } = await import('../src/services/exercises/refutation');
    const { winPercentFor } = await import('../src/services/analysis/evaluation');
    // Find the centipawn values whose win% crosses each edge, to pin the band of the exact edge.
    const cpFor = (target: number) => {
      let v = -2000;
      while (winPercentFor(cp(v), 'w') < target) v++;
      return v;
    };
    const at80 = cpFor(80);
    const at60 = cpFor(60);
    const above40 = cpFor(40.0001);
    const above20 = cpFor(20.0001);
    const s = (played: number, reference: number) => consequenceOf({ fen: ROOK_QUEEN, solver: 'w', played: cp(played), reference: cp(reference) });
    expect(s(at80 - 1, at80)).toBe('a posição passa de vantagem decisiva para vantagem');
    expect(s(at60 - 1, at60)).toBe('a posição passa de vantagem para igualdade');
    expect(s(above40 - 1, above40)).toBe('a posição passa de igualdade para desvantagem');
    expect(s(above20 - 1, above20)).toBe('a posição passa de desvantagem para posição perdida');
    // Black's view mirrors White's.
    expect(consequenceOf({ fen: ROOK_QUEEN, solver: 'b', played: cp(-at80 + 1), reference: cp(-at80) })).toBe('a posição passa de vantagem decisiva para vantagem');
  });
});
