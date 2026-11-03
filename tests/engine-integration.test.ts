// Runs the real Stockfish 19 WASM build (the same file the app serves) in Node.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterAll } from 'vitest';
import { UciEngine, type EngineTransport } from '../src/services/engine/UciEngine';
import { analyzeGame } from '../src/services/analysis/gameAnalyzer';
import { parsePgnText } from '../src/services/pgn/parsePgn';
import { SHORT_BLUNDER_GAME } from './fixtures';

const BRIDGE = fileURLToPath(new URL('./support/sf-bridge.cjs', import.meta.url));

function nodeTransport(): EngineTransport {
  const child = spawn(process.execPath, [BRIDGE], { stdio: ['pipe', 'pipe', 'inherit'] });
  const listeners: ((l: string) => void)[] = [];
  const errors: ((e: Error) => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (l) => listeners.forEach((fn) => fn(l)));
  child.on('error', (e) => errors.forEach((fn) => fn(e)));
  return {
    send: (c) => child.stdin.write(`${c}\n`),
    onLine: (fn) => listeners.push(fn),
    onError: (fn) => errors.push(fn),
    terminate: () => child.kill(),
  };
}

const engine = new UciEngine(nodeTransport);
afterAll(() => engine.terminate());

describe('Stockfish WASM (real engine)', () => {
  it('initializes and identifies itself', async () => {
    await engine.init();
    expect(engine.name).toMatch(/Stockfish/);
  }, 60_000);

  it('finds a back-rank mate in 1 for White', async () => {
    const r = await engine.analyze({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', depth: 10 });
    expect(r.complete).toBe(true);
    expect(r.lines[0]?.pv[0]).toBe('a1a8');
    expect(r.lines[0]?.score).toEqual({ kind: 'mate', value: 1 });
  }, 60_000);

  it('reports Black mates with a negative White-POV score', async () => {
    const r = await engine.analyze({ fen: 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', depth: 10 });
    expect(r.lines[0]?.pv[0]).toBe('a8a1');
    expect(r.lines[0]?.score).toEqual({ kind: 'mate', value: -1 });
  }, 60_000);

  it('returns several distinct lines with MultiPV', async () => {
    const r = await engine.analyze({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 8, multiPv: 3 });
    expect(r.lines).toHaveLength(3);
    expect(new Set(r.lines.map((l) => l.pv[0])).size).toBe(3);
  }, 60_000);

  it('analyzes a real game and flags the knight blunder', async () => {
    const game = { ...parsePgnText(SHORT_BLUNDER_GAME).games[0]!, importId: 'x', importedAt: 0 };
    const a = await analyzeGame(game, { depth: 12, multiPv: 2 }, { engine });
    expect(a.status).toBe('complete');
    const nd4 = a.reviews.find((r) => r.san === 'Nd4');
    expect(nd4 && ['mistake', 'blunder']).toBeTruthy();
    expect(['mistake', 'blunder']).toContain(nd4?.classification);
    expect(nd4?.flags).toContain('material_loss');
  }, 120_000);
});
