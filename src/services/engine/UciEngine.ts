import type { EngineLine, PositionAnalysis } from '../../types/domain';
import { positionProblem, sideToMove } from '../chess/position';
import { toWhitePov } from '../analysis/evaluation';
import { parseBestMove, parseInfoLine } from './uci';

/** Minimal bidirectional line transport (Web Worker in the browser, stdin/stdout-like in Node). */
export interface EngineTransport {
  send(command: string): void;
  onLine(listener: (line: string) => void): void;
  onError(listener: (err: Error) => void): void;
  terminate(): void;
}

export interface AnalyzeRequest {
  fen: string;
  depth?: number;
  movetimeMs?: number;
  multiPv?: number;
  /** Optional: restrict search to these UCI moves. */
  searchMoves?: string[];
  onProgress?: (partial: PositionAnalysis) => void;
}

export type EngineState = 'idle' | 'initializing' | 'ready' | 'error' | 'terminated';

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: 'init_failed' | 'timeout' | 'terminated' | 'cancelled' | 'transport' | 'invalid_position',
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

interface Job {
  req: AnalyzeRequest;
  resolve: (r: PositionAnalysis) => void;
  reject: (e: Error) => void;
  cancelled: boolean;
}

const INIT_TIMEOUT_MS = 20_000;
/** A search that prints nothing for this long is considered stuck (Stockfish reports at least every few seconds). */
export const STALL_TIMEOUT_MS = 30_000;

export interface UciEngineOptions {
  stallTimeoutMs?: number;
}

/**
 * UCI protocol driver. Owns a single engine instance and serializes analysis
 * jobs through a FIFO queue, so at most one search runs at any time.
 */
export class UciEngine {
  private state: EngineState = 'idle';
  private readonly queue: Job[] = [];
  private current: Job | null = null;
  private lines = new Map<number, EngineLine>();
  private startedAt = 0;
  private waiters: { match: (l: string) => boolean; resolve: () => void }[] = [];
  private initPromise: Promise<void> | null = null;
  private stopRequested = false;
  private listeners = new Set<(s: EngineState) => void>();
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private readonly stallTimeoutMs: number;
  name = 'Stockfish';

  constructor(
    private readonly createTransport: () => EngineTransport,
    opts: UciEngineOptions = {},
  ) {
    this.stallTimeoutMs = opts.stallTimeoutMs ?? STALL_TIMEOUT_MS;
  }

  getState(): EngineState {
    return this.state;
  }

  onStateChange(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: EngineState): void {
    this.state = s;
    this.listeners.forEach((l) => l(s));
  }

  private transport: EngineTransport | null = null;

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.setState('initializing');
    this.transport?.terminate();
    this.waiters = [];
    this.initPromise = new Promise<void>((resolve, reject) => {
      let t: EngineTransport;
      const fail = (err: Error) => {
        this.setState('error');
        this.initPromise = null;
        reject(new EngineError(`Falha ao iniciar o motor: ${err.message}`, 'init_failed'));
      };
      try {
        t = this.createTransport();
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.transport = t;
      const timer = setTimeout(() => fail(new Error('tempo esgotado aguardando "uciok"')), INIT_TIMEOUT_MS);
      // Messages from a transport that was already replaced are ignored.
      t.onError((err) => {
        if (this.transport !== t) return;
        clearTimeout(timer);
        if (this.state === 'initializing') fail(err);
        else this.handleFatal(err);
      });
      t.onLine((line) => {
        if (this.transport === t) this.handleLine(line);
      });
      this.waitFor((l) => l.startsWith('id name '), () => undefined, (l) => {
        this.name = l.slice('id name '.length).trim();
      });
      this.waitFor((l) => l === 'uciok')
        .then(() => {
          t.send('setoption name UCI_AnalyseMode value true');
          t.send('isready');
          return this.waitFor((l) => l === 'readyok');
        })
        .then(() => {
          clearTimeout(timer);
          this.setState('ready');
          resolve();
          this.pump();
        })
        .catch(() => undefined);
      t.send('uci');
    });
    return this.initPromise;
  }

  private waitFor(match: (l: string) => boolean, onMatch?: () => void, capture?: (l: string) => void): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push({
        match: (l) => {
          if (!match(l)) return false;
          capture?.(l);
          return true;
        },
        resolve: () => {
          onMatch?.();
          resolve();
        },
      });
    });
  }

  private handleLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    const idx = this.waiters.findIndex((w) => w.match(line));
    if (idx >= 0) {
      const [w] = this.waiters.splice(idx, 1);
      w?.resolve();
      return;
    }
    const job = this.current;
    if (!job) return;
    this.armWatchdog();
    if (line.startsWith('info ')) {
      const info = parseInfoLine(line);
      if (!info || !info.score || !info.pv || info.depth === undefined || info.bound) return;
      const stm = sideToMove(job.req.fen);
      this.lines.set(info.multipv, {
        multipv: info.multipv,
        score: toWhitePov(info.score, stm),
        pv: info.pv,
        depth: info.depth,
      });
      if (job.req.onProgress && info.multipv === 1) job.req.onProgress(this.snapshot(job, false));
      return;
    }
    if (line.startsWith('bestmove')) {
      const bm = parseBestMove(line);
      const result = { ...this.snapshot(job, !this.stopRequested), ...(bm?.best ? { bestMove: bm.best } : {}) };
      this.clearWatchdog();
      this.current = null;
      this.stopRequested = false;
      if (job.cancelled) job.reject(new EngineError('Análise cancelada', 'cancelled'));
      else job.resolve(result);
      this.pump();
    }
  }

  private snapshot(job: Job, complete: boolean): PositionAnalysis {
    const requested = job.req.multiPv ?? 1;
    const lines = [...this.lines.values()]
      .filter((l) => l.multipv <= requested)
      .sort((a, b) => a.multipv - b.multipv);
    const depth = lines.length ? Math.min(...lines.map((l) => l.depth)) : 0;
    return {
      fen: job.req.fen,
      depth,
      multiPv: requested,
      lines,
      complete,
      timeMs: Date.now() - this.startedAt,
    };
  }

  private handleFatal(err: Error): void {
    this.recover(new EngineError(`O motor falhou durante a análise e foi reiniciado (${err.message}).`, 'transport'));
  }

  /**
   * Fails the running job, discards the (crashed or stuck) worker and, when
   * jobs are waiting, starts a fresh one so the queue keeps going.
   */
  private recover(err: EngineError): void {
    this.clearWatchdog();
    const job = this.current;
    this.current = null;
    this.stopRequested = false;
    job?.reject(err);
    const t = this.transport;
    this.transport = null;
    this.initPromise = null;
    t?.terminate();
    this.setState('error');
    if (this.queue.length) this.init().catch((e: Error) => this.rejectAll(e));
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => this.recover(new EngineError('O motor parou de responder nesta posição e foi reiniciado.', 'timeout')), this.stallTimeoutMs);
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  /** Queues an analysis. Resolves with the final result (complete=false if stopped early). */
  analyze(req: AnalyzeRequest): Promise<PositionAnalysis> {
    if (this.state === 'terminated') return Promise.reject(new EngineError('Motor encerrado', 'terminated'));
    // Impossible positions can crash the engine: refuse them before they reach it.
    const problem = positionProblem(req.fen);
    if (problem) return Promise.reject(new EngineError(`Posição impossível (${problem}); não foi enviada ao motor.`, 'invalid_position'));
    return new Promise((resolve, reject) => {
      this.queue.push({ req, resolve, reject, cancelled: false });
      if (this.state === 'ready') this.pump();
      else if (this.state === 'idle' || this.state === 'error') this.init().catch((e: Error) => this.rejectAll(e));
    });
  }

  private rejectAll(e: Error): void {
    const all = [...this.queue];
    this.queue.length = 0;
    all.forEach((j) => j.reject(e));
  }

  private pump(): void {
    if (this.current || this.state !== 'ready' || !this.transport) return;
    let job = this.queue.shift();
    while (job && job.cancelled) {
      job.reject(new EngineError('Análise cancelada', 'cancelled'));
      job = this.queue.shift();
    }
    if (!job) return;
    this.current = job;
    this.lines = new Map();
    this.startedAt = Date.now();
    this.stopRequested = false;
    const t = this.transport;
    const { req } = job;
    t.send(`setoption name MultiPV value ${Math.max(1, Math.min(5, req.multiPv ?? 1))}`);
    t.send(`position fen ${req.fen}`);
    const limits = req.movetimeMs ? `movetime ${req.movetimeMs}` : `depth ${req.depth ?? 16}`;
    const sm = req.searchMoves?.length ? ` searchmoves ${req.searchMoves.join(' ')}` : '';
    t.send(`go ${limits}${sm}`);
    this.armWatchdog();
  }

  /** Stops the running search; its promise resolves with complete=false. */
  stop(): void {
    if (this.current && this.transport) {
      this.stopRequested = true;
      this.transport.send('stop');
    }
  }

  /** Cancels all queued and running jobs (they reject with code "cancelled"). */
  cancelAll(): void {
    this.queue.forEach((j) => (j.cancelled = true));
    if (this.current) {
      this.current.cancelled = true;
      this.stop();
    }
    this.pump();
  }

  get pendingJobs(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  terminate(): void {
    this.clearWatchdog();
    this.cancelAll();
    this.rejectAll(new EngineError('Motor encerrado', 'terminated'));
    if (this.current) {
      this.current.reject(new EngineError('Motor encerrado', 'terminated'));
      this.current = null;
    }
    this.transport?.terminate();
    this.transport = null;
    this.initPromise = null;
    this.setState('terminated');
  }
}
