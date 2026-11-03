import type { EngineTransport } from '../src/services/engine/UciEngine';

/** Morphy vs. Duke Karl / Count Isouard, Paris 1858 ("Opera Game") — public domain. */
export const OPERA_GAME = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]
[ECO "C41"]
[Opening "Philidor Defense"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

export const SHORT_BLUNDER_GAME = `[Event "Casual"]
[White "Aluno"]
[Black "Rival"]
[Result "0-1"]
[Date "2026.10.01"]

1. e4 e5 2. Nf3 Nc6 3. Nd4 exd4 0-1`;

export interface FakeScript {
  /** Returns info lines (side-to-move POV, like a real engine) for a FEN. */
  respond: (fen: string, depth: number, multipv: number) => { lines: string[]; best: string };
  delayMs?: number;
}

/** A scripted UCI engine used to unit-test the protocol driver without WASM. */
export function fakeTransport(script: FakeScript, opts: { failInit?: boolean; noUciOk?: boolean } = {}): EngineTransport & { sent: string[] } {
  const listeners: ((l: string) => void)[] = [];
  const errors: ((e: Error) => void)[] = [];
  const sent: string[] = [];
  let fen = '';
  let multipv = 1;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let best = '';
  const emit = (l: string) => listeners.forEach((fn) => fn(l));
  return {
    sent,
    send(cmd) {
      sent.push(cmd);
      if (cmd === 'uci') {
        if (opts.failInit) setTimeout(() => errors.forEach((e) => e(new Error('arquivo do motor ausente'))), 1);
        else if (!opts.noUciOk) setTimeout(() => (emit('id name FakeFish 1'), emit('uciok')), 1);
      } else if (cmd === 'isready') setTimeout(() => emit('readyok'), 1);
      else if (cmd.startsWith('setoption name MultiPV value ')) multipv = Number(cmd.split(' ').pop());
      else if (cmd.startsWith('position fen ')) fen = cmd.slice('position fen '.length);
      else if (cmd.startsWith('go')) {
        const depth = Number(/depth (\d+)/.exec(cmd)?.[1] ?? 10);
        const r = script.respond(fen, depth, multipv);
        best = r.best;
        pending = setTimeout(() => {
          r.lines.forEach(emit);
          emit(`bestmove ${r.best}`);
          pending = null;
        }, script.delayMs ?? 2);
      } else if (cmd === 'stop' && pending) {
        clearTimeout(pending);
        pending = null;
        setTimeout(() => emit(`bestmove ${best}`), 1);
      }
    },
    onLine: (fn) => listeners.push(fn),
    onError: (fn) => errors.push(fn),
    terminate() {
      if (pending) clearTimeout(pending);
    },
  };
}
