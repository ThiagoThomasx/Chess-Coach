import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { EngineTransport } from '../../src/services/engine/UciEngine';

const BRIDGE = fileURLToPath(new URL('./sf-bridge.cjs', import.meta.url));

/**
 * The real Stockfish 19 WASM build (the file the app serves) in a child process: its Node
 * detection fails inside Vitest, so it runs through sf-bridge.cjs (see docs/ARCHITECTURE.md, #13).
 */
export function nodeTransport(): EngineTransport {
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
