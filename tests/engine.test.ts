import { describe, expect, it } from 'vitest';
import { parseBestMove, parseInfoLine } from '../src/services/engine/uci';
import { UciEngine, EngineError } from '../src/services/engine/UciEngine';
import { fakeTransport } from './fixtures';

describe('UCI parsing', () => {
  it('parses cp, mate, multipv and pv', () => {
    const i = parseInfoLine('info depth 18 seldepth 25 multipv 2 score cp -34 nodes 1000 time 120 pv e7e5 g1f3');
    expect(i).toMatchObject({ depth: 18, multipv: 2, score: { kind: 'cp', value: -34 }, pv: ['e7e5', 'g1f3'], timeMs: 120 });
    expect(parseInfoLine('info depth 5 score mate -2 pv h7h8')?.score).toEqual({ kind: 'mate', value: -2 });
    expect(parseInfoLine('info depth 0 score mate 0')?.score).toEqual({ kind: 'mate', value: -0.5 });
    expect(parseInfoLine('info depth 10 score cp 20 lowerbound pv e2e4')?.bound).toBe('lower');
    expect(parseInfoLine('bestmove e2e4')).toBeNull();
  });

  it('parses bestmove, including no-move results', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ best: 'e2e4', ponder: 'e7e5' });
    expect(parseBestMove('bestmove (none)')).toEqual({ best: null });
  });
});

const standard = {
  respond: (fen: string, depth: number) => {
    const stm = fen.split(' ')[1];
    // Score reported from side-to-move POV like a real engine.
    return {
      lines: [`info depth ${depth} multipv 1 score cp ${stm === 'w' ? 25 : -25} pv e2e4 e7e5`, `info depth ${depth} multipv 2 score mate 3 pv d2d4`],
      best: 'e2e4',
    };
  },
};

describe('UciEngine', () => {
  it('initializes, reads the engine name and returns White-POV results', async () => {
    const t = fakeTransport(standard);
    const e = new UciEngine(() => t);
    await e.init();
    expect(e.getState()).toBe('ready');
    expect(e.name).toBe('FakeFish 1');
    const r = await e.analyze({ fen: '8/8/8/8/8/8/8/K6k b - - 0 1', depth: 12, multiPv: 2 });
    expect(r.complete).toBe(true);
    expect(r.depth).toBe(12);
    expect(r.lines[0]?.score).toEqual({ kind: 'cp', value: 25 }); // -25 for black → +25 White POV
    expect(r.lines[1]?.score).toEqual({ kind: 'mate', value: -3 });
    expect(r.bestMove).toBe('e2e4');
    expect(t.sent).toContain('setoption name MultiPV value 2');
  });

  it('serializes concurrent jobs so only one search runs at a time', async () => {
    const t = fakeTransport({ ...standard, delayMs: 5 });
    const e = new UciEngine(() => t);
    const fens = ['4k3/8/8/8/8/8/8/4K3 w - - 0 1', '4k3/8/8/8/8/8/8/4K3 b - - 0 1', '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'];
    const results = await Promise.all(fens.map((fen) => e.analyze({ fen, depth: 8 })));
    expect(results.map((r) => r.fen)).toEqual(fens);
    // Each "go" must be preceded by its own "position" command, in order.
    const gos = t.sent.filter((c) => c.startsWith('position') || c.startsWith('go'));
    expect(gos.filter((c) => c.startsWith('go'))).toHaveLength(3);
    expect(gos[0]).toContain(fens[0]);
    expect(gos[2]).toContain(fens[1]);
  });

  it('stop() returns a partial result marked incomplete', async () => {
    const t = fakeTransport({ ...standard, delayMs: 200 });
    const e = new UciEngine(() => t);
    await e.init();
    const p = e.analyze({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', depth: 30 });
    await new Promise((r) => setTimeout(r, 10));
    e.stop();
    const r = await p;
    expect(r.complete).toBe(false);
  });

  it('cancelAll rejects running and queued jobs with code "cancelled"', async () => {
    const t = fakeTransport({ ...standard, delayMs: 100 });
    const e = new UciEngine(() => t);
    await e.init();
    const a = e.analyze({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', depth: 30 });
    const b = e.analyze({ fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1', depth: 30 });
    await new Promise((r) => setTimeout(r, 5));
    e.cancelAll();
    await expect(a).rejects.toMatchObject({ code: 'cancelled' });
    await expect(b).rejects.toMatchObject({ code: 'cancelled' });
    expect(e.pendingJobs).toBe(0);
  });

  it('reports initialization errors (e.g. missing engine file)', async () => {
    const e = new UciEngine(() => fakeTransport(standard, { failInit: true }));
    await expect(e.init()).rejects.toBeInstanceOf(EngineError);
    expect(e.getState()).toBe('error');
  });

  it('reports errors thrown while creating the transport', async () => {
    const e = new UciEngine(() => {
      throw new Error('Worker indisponível');
    });
    await expect(e.analyze({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' })).rejects.toThrow(/Worker indisponível/);
  });

  describe('recovery (audit M5)', () => {
    const FEN = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

    it('restarts the engine after a crash, so the next analysis runs', async () => {
      const created: ReturnType<typeof fakeTransport>[] = [];
      const e = new UciEngine(() => {
        const t = fakeTransport(standard, { crashOnGo: created.length === 0 });
        created.push(t);
        return t;
      });
      await expect(e.analyze({ fen: FEN, depth: 8 })).rejects.toMatchObject({ code: 'transport' });
      const r = await e.analyze({ fen: FEN, depth: 8 });
      expect(r.complete).toBe(true);
      expect(created).toHaveLength(2);
      expect(e.getState()).toBe('ready');
    });

    it('rejects a stalled search with "timeout" and keeps the queue going on a fresh engine', async () => {
      const created: ReturnType<typeof fakeTransport>[] = [];
      const e = new UciEngine(() => {
        const t = fakeTransport(standard, { hangOnGo: created.length === 0 });
        created.push(t);
        return t;
      }, { stallTimeoutMs: 50 });
      const stalled = e.analyze({ fen: FEN, depth: 8 });
      const next = e.analyze({ fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1', depth: 8 });
      await expect(stalled).rejects.toMatchObject({ code: 'timeout' });
      expect((await next).complete).toBe(true);
      expect(created).toHaveLength(2);
    });

    it('refuses an illegal position without sending it to the engine', async () => {
      const t = fakeTransport(standard);
      const e = new UciEngine(() => t);
      await expect(e.analyze({ fen: '8/8/8/3k4/8/8/8/K6Q w - - 0 1' })).rejects.toMatchObject({ code: 'invalid_position' });
      expect(t.sent.some((c) => c.startsWith('go'))).toBe(false);
    });
  });

  it('rejects jobs after terminate()', async () => {
    const e = new UciEngine(() => fakeTransport(standard));
    await e.init();
    e.terminate();
    await expect(e.analyze({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' })).rejects.toMatchObject({ code: 'terminated' });
  });
});
