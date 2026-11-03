import { UciEngine } from './UciEngine';
import { createWorkerTransport } from './workerTransport';

let engine: UciEngine | null = null;

/** App-wide engine instance (one Stockfish worker, jobs serialized by UciEngine). */
export function getEngine(): UciEngine {
  if (!engine || engine.getState() === 'terminated') engine = new UciEngine(() => createWorkerTransport());
  return engine;
}

export function shutdownEngine(): void {
  engine?.terminate();
  engine = null;
}
