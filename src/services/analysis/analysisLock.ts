/**
 * One analysis per game across tabs (Sprint 4.8, T-1). The tab that runs a game's analysis holds
 * the browser's Web Lock for that game; the browser releases it when the run ends or the tab
 * closes, so "running" on disk with a free lock means a run that no tab owns any more.
 *
 * Without the Web Locks API (older browsers) everything runs as before Sprint 4.8: no lock,
 * owner "unknown", and every "running" record counts as interrupted on start.
 */

/** The part of the Web Locks API used here (navigator.locks in browsers and Node). */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[] }>;
}

/** Who runs a game's analysis: this tab, another one, nobody, or unknown (no Web Locks). */
export type AnalysisOwner = 'here' | 'elsewhere' | 'none' | 'unknown';

const LOCK_PREFIX = 'chessquest.analysis.';

let override: LockManagerLike | null | undefined;

/** Tests only: a lock manager to use instead of `navigator.locks` (null = API missing, undefined = default). */
export function setAnalysisLockManager(manager: LockManagerLike | null | undefined): void {
  override = manager;
}

function lockManager(): LockManagerLike | null {
  if (override !== undefined) return override;
  const nav = typeof navigator !== 'undefined' ? (navigator as { locks?: LockManagerLike }) : undefined;
  return nav?.locks ?? null;
}

/** Whether this browser has the Web Locks API (otherwise the pre-4.8 behaviour applies). */
export function hasAnalysisLocks(): boolean {
  return lockManager() !== null;
}

export function analysisLockName(gameId: string): string {
  return LOCK_PREFIX + gameId;
}

/**
 * Runs `work` holding the game's lock. `acquired: false` (and `work` not run) when another tab
 * holds it. The lock is released when `work` settles, failures included.
 */
export async function withAnalysisLock<T>(gameId: string, work: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const locks = lockManager();
  if (!locks) return { acquired: true, value: await work() };
  let result: { acquired: true; value: T } | { acquired: false } = { acquired: false };
  await locks.request(analysisLockName(gameId), { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    result = { acquired: true, value: await work() };
  });
  return result;
}

/** Game ids whose analysis lock is held by some tab (this one included); null without the API. */
export async function heldAnalysisLocks(): Promise<Set<string> | null> {
  const locks = lockManager();
  if (!locks) return null;
  const { held = [] } = await locks.query();
  return new Set(held.map((l) => l.name ?? '').filter((name) => name.startsWith(LOCK_PREFIX)).map((name) => name.slice(LOCK_PREFIX.length)));
}

/**
 * Whether some tab holds the game's lock ('elsewhere' or 'none'), or 'unknown' without the API.
 * The caller tells "here" apart: this module does not know which runs belong to this tab.
 */
export async function analysisOwner(gameId: string): Promise<Exclude<AnalysisOwner, 'here'>> {
  const held = await heldAnalysisLocks();
  if (!held) return 'unknown';
  return held.has(gameId) ? 'elsewhere' : 'none';
}

/**
 * Calls `onReleased` once the game's lock becomes free (the other tab finished or closed). The
 * lock is taken only for that instant. Returns a function that cancels the watch. Without the
 * API nothing is watched.
 */
export function onAnalysisLockReleased(gameId: string, onReleased: () => void): () => void {
  const locks = lockManager();
  if (!locks) return () => undefined;
  const controller = new AbortController();
  locks
    .request(analysisLockName(gameId), { signal: controller.signal }, () => {
      if (!controller.signal.aborted) onReleased();
    })
    .catch((e: unknown) => {
      // An aborted watch rejects with AbortError: expected when the screen goes away.
      if (!controller.signal.aborted) console.error('ChessQuest: falha ao acompanhar a análise de outra aba', e);
    });
  return () => controller.abort();
}
