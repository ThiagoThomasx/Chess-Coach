// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { ChessQuestDB, setDb } from '../src/db/database';
import { getGame, importPgn } from '../src/db/gamesRepo';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { setAnalysisLockManager } from '../src/services/analysis/analysisLock';
import { startAnalysis } from '../src/services/analysis/analysisRunner';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import { useActiveRun } from '../src/features/analysis/useActiveRun';
import type { Game } from '../src/types/domain';
import { SHORT_BLUNDER_GAME } from './fixtures';

// Sprint 4.8 pre-closure audit, MEDIUM 1: the analysis controls know whether this tab runs the
// game's analysis, also when they mount (again) while it runs, and see it end.

const settings = { ...DEFAULT_SETTINGS, analysisDepth: 10 };
let n = 0;

beforeEach(() => {
  setDb(new ChessQuestDB(`active-run-${++n}`));
  // jsdom has no Web Locks: the runner works as without the API.
  setAnalysisLockManager(null);
});
afterEach(() => {
  cleanup();
  setAnalysisLockManager(undefined);
});

/** An engine whose searches wait until `open()` is called; `fail` makes them throw instead. */
function gatedEngine(fail = false): { engine: EngineLike; open: () => void } {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((r) => (open = r));
  return {
    open,
    engine: {
      async analyze({ fen, depth = 10, multiPv = 1 }) {
        await gate;
        if (fail) throw new Error('motor falhou');
        return { fen, depth, multiPv, lines: [{ multipv: 1, score: { kind: 'cp', value: 10 }, pv: [], depth }], complete: true, timeMs: 1 };
      },
    },
  };
}

async function game(): Promise<Game> {
  return (await getGame((await importPgn(SHORT_BLUNDER_GAME, 'a.pgn', [])).imported[0]!.id))!;
}

describe('useActiveRun', () => {
  it('is false when this tab runs nothing for the game', () => {
    const { result } = renderHook(() => useActiveRun('g1'));
    expect(result.current[0]).toBe(false);
  });

  it('mounted while the run goes on (back to the screen), it is true and turns false when the run ends', async () => {
    const g = await game();
    const { engine, open } = gatedEngine();
    const run = startAnalysis(g, settings, engine);
    const { result } = renderHook(() => useActiveRun(g.id));
    expect(result.current[0]).toBe(true);
    open();
    expect((await run).analysis.status).toBe('complete');
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it('also turns false when the run it found ends in error', async () => {
    const g = await game();
    const { engine, open } = gatedEngine(true);
    const run = startAnalysis(g, settings, engine);
    const { result } = renderHook(() => useActiveRun(g.id));
    expect(result.current[0]).toBe(true);
    open();
    await run.catch(() => undefined);
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it('a run started from this screen is driven by the setter, as before', () => {
    const { result } = renderHook(() => useActiveRun('g1'));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});
