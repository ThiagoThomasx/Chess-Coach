import type { EngineTransport } from './UciEngine';

/** Path of the locally served Stockfish build (copied from node_modules by scripts/copy-engine.mjs). */
export const ENGINE_SCRIPT = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;

/**
 * Runs Stockfish inside a dedicated Web Worker. The engine script is itself a
 * worker that speaks UCI over postMessage, so no extra wrapper is required.
 */
export function createWorkerTransport(scriptUrl: string = ENGINE_SCRIPT): EngineTransport {
  if (typeof Worker === 'undefined') throw new Error('Web Workers não são suportados neste ambiente');
  const worker = new Worker(scriptUrl);
  const lineListeners: ((l: string) => void)[] = [];
  const errorListeners: ((e: Error) => void)[] = [];
  worker.onmessage = (ev: MessageEvent) => {
    const data: unknown = ev.data;
    if (typeof data !== 'string') return;
    for (const line of data.split('\n')) lineListeners.forEach((l) => l(line));
  };
  worker.onerror = (ev: ErrorEvent) => {
    ev.preventDefault();
    const err = new Error(ev.message || 'Não foi possível carregar o arquivo do motor (engine/stockfish-19-lite-single.js)');
    errorListeners.forEach((l) => l(err));
  };
  return {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (fn) => lineListeners.push(fn),
    onError: (fn) => errorListeners.push(fn),
    terminate: () => worker.terminate(),
  };
}
