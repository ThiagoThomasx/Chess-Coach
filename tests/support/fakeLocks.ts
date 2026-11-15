import type { LockManagerLike } from '../../src/services/analysis/analysisLock';

interface Waiter {
  grant: () => void;
  reject: (e: unknown) => void;
}

/**
 * A Web Locks stand-in for jsdom (which has no navigator.locks), with the parts of the spec the app
 * uses: exclusive locks, `ifAvailable`, a FIFO queue per name and `signal` to cancel a queued
 * request. `holdElsewhere` plays another tab; `pending` shows queued requests (e.g. a watcher).
 */
export class FakeLocks implements LockManagerLike {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, Waiter[]>();
  queries = 0;
  /** Replaces `query()` when set (e.g. to make it fail or answer later). */
  queryOverride: (() => Promise<{ held?: { name?: string }[] }>) | undefined;

  async query(): Promise<{ held?: { name?: string }[] }> {
    this.queries++;
    if (this.queryOverride) return this.queryOverride();
    return { held: [...this.held].map((name) => ({ name })) };
  }

  async request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown> {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (this.held.has(name)) {
      if (options.ifAvailable) return callback(null);
      await new Promise<void>((grant, reject) => {
        const waiter: Waiter = { grant, reject };
        this.queue(name).push(waiter);
        options.signal?.addEventListener('abort', () => {
          const q = this.queue(name);
          const i = q.indexOf(waiter);
          if (i >= 0) q.splice(i, 1);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.release(name);
    }
  }

  /** Takes the lock as another tab would; the returned function releases it. */
  holdElsewhere(name: string): () => void {
    if (this.held.has(name)) throw new Error(`${name} already held`);
    this.held.add(name);
    return () => this.release(name);
  }

  isHeld(name: string): boolean {
    return this.held.has(name);
  }

  pending(name: string): number {
    return this.queue(name).length;
  }

  private release(name: string): void {
    this.held.delete(name);
    const next = this.queue(name).shift();
    if (next) {
      this.held.add(name);
      next.grant();
    }
  }

  private queue(name: string): Waiter[] {
    const q = this.queues.get(name) ?? [];
    this.queues.set(name, q);
    return q;
  }
}
