import { describe, expect, it } from 'vitest';
import { analyzeGame, isReusable, terminalAnalysis, summarize, type EngineLike, type EvalCache } from '../src/services/analysis/gameAnalyzer';
import { parsePgnText } from '../src/services/pgn/parsePgn';
import { positionsOf } from '../src/services/chess/position';
import { materialBalance } from '../src/services/chess/material';
import type { Game, PositionAnalysis } from '../src/types/domain';
import { SHORT_BLUNDER_GAME, OPERA_GAME } from './fixtures';

const toGame = (pgn: string): Game => ({ ...parsePgnText(pgn).games[0]!, importId: 'i', importedAt: 0 });

/** Deterministic fake: White-POV score = material balance ×100; best move = first legal move. */
function materialEngine(): EngineLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async analyze({ fen, depth = 12, multiPv = 1 }) {
      calls.push(fen);
      const score = { kind: 'cp' as const, value: materialBalance(fen, 'w') * 100 };
      return { fen, depth, multiPv, lines: [{ multipv: 1, score, pv: [], depth }], complete: true, timeMs: 1 };
    },
  };
}

describe('game analysis orchestration', () => {
  it('evaluates every position and produces one review per ply', async () => {
    const game = toGame(SHORT_BLUNDER_GAME);
    const engine = materialEngine();
    const a = await analyzeGame(game, { depth: 12, multiPv: 1 }, { engine });
    expect(a.status).toBe('complete');
    expect(a.positions).toHaveLength(game.moves.length + 1);
    expect(a.reviews).toHaveLength(game.moves.length);
  });

  it('resumes a paused analysis without recomputing finished positions', async () => {
    const game = toGame(OPERA_GAME);
    const signal = { aborted: false };
    const engine = materialEngine();
    let seen = 0;
    const paused = await analyzeGame(game, { depth: 12, multiPv: 1 }, {
      engine,
      signal,
      onProgress: () => {
        seen++;
        if (seen === 10) signal.aborted = true;
      },
    });
    expect(paused.status).toBe('paused');
    const done = paused.positions.filter(Boolean).length;
    expect(done).toBe(10);

    const engine2 = materialEngine();
    const resumed = await analyzeGame(game, { depth: 12, multiPv: 1 }, { engine: engine2 }, paused);
    expect(resumed.status).toBe('complete');
    // Positions 0..9 reused; the final mate is terminal and needs no engine call.
    expect(engine2.calls.length).toBe(game.moves.length + 1 - 10 - 1);
  });

  it('reuses compatible cached evaluations and skips weaker ones', async () => {
    const game = toGame(SHORT_BLUNDER_GAME);
    const fens = positionsOf(game.moves);
    const store = new Map<string, PositionAnalysis>();
    const cache: EvalCache = {
      async get(fen, depth) {
        const p = store.get(fen);
        return p && p.depth >= depth ? p : undefined;
      },
      async put(p) {
        store.set(p.fen, p);
      },
    };
    await analyzeGame(game, { depth: 12, multiPv: 1 }, { engine: materialEngine(), cache });
    const e2 = materialEngine();
    await analyzeGame(game, { depth: 12, multiPv: 1 }, { engine: e2, cache });
    expect(e2.calls).toHaveLength(0);
    const e3 = materialEngine();
    await analyzeGame(game, { depth: 18, multiPv: 1 }, { engine: e3, cache });
    expect(e3.calls.length).toBe(fens.length);
  });

  it('keeps partial results and reports an error state when the engine fails', async () => {
    const game = toGame(SHORT_BLUNDER_GAME);
    let n = 0;
    const engine: EngineLike = {
      async analyze(req) {
        if (++n === 3) throw new Error('motor caiu');
        return materialEngine().analyze(req);
      },
    };
    const a = await analyzeGame(game, { depth: 12, multiPv: 1 }, { engine });
    expect(a.status).toBe('error');
    expect(a.error).toMatch(/motor caiu/);
    expect(a.positions.filter(Boolean)).toHaveLength(2);
  });

  it('never treats incomplete searches as reusable', () => {
    const p: PositionAnalysis = { fen: 'x', depth: 20, multiPv: 1, lines: [{ multipv: 1, score: { kind: 'cp', value: 0 }, pv: [], depth: 20 }], complete: false, timeMs: 1 };
    expect(isReusable(p, { depth: 12, multiPv: 1 })).toBe(false);
    expect(isReusable({ ...p, complete: true }, { depth: 12, multiPv: 1 })).toBe(true);
    expect(isReusable({ ...p, complete: true }, { depth: 12, multiPv: 3 })).toBe(false);
  });

  it('evaluates terminal positions without the engine', () => {
    const mated = positionsOf(['f3', 'e5', 'g4', 'Qh4#'])[4] as string;
    const t = terminalAnalysis(mated);
    expect(t?.terminal).toBe('checkmate');
    expect(t?.lines[0]?.score.kind).toBe('mate');
    expect(t?.lines[0]?.score.value).toBeLessThan(0); // White is mated
  });

  it('summarizes per side', async () => {
    const a = await analyzeGame(toGame(SHORT_BLUNDER_GAME), { depth: 12, multiPv: 1 }, { engine: materialEngine() });
    const s = summarize(a.reviews, 'w');
    expect(s.conclusive).toBe(3);
    expect(s.avgWinLoss).not.toBeNull();
  });
});
