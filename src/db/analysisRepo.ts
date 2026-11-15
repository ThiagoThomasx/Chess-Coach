import type { AnalysisStatus, Bookmark, GameAnalysis, PositionAnalysis, SkillEvent } from '../types/domain';
import { fenKey, type EvalCache } from '../services/analysis/gameAnalyzer';
import { newId } from '../utils/hash';
import { gameEvidenceTime } from '../services/games/gameDate';
import { heldAnalysisLocks } from '../services/analysis/analysisLock';
import { getDb } from './database';

export async function getAnalysis(gameId: string): Promise<GameAnalysis | undefined> {
  return getDb().analyses.get(gameId);
}

export async function saveAnalysis(a: GameAnalysis): Promise<void> {
  await getDb().analyses.put(a);
}

/**
 * Saves an analysis only while its game exists, checked in the write's own transaction: a game
 * deleted while its analysis runs is not given its analysis back (Sprint 4.6 audit, AC-1).
 * False when the game is gone and nothing was written.
 */
export async function saveAnalysisIfGameExists(a: GameAnalysis): Promise<boolean> {
  const db = getDb();
  return db.transaction('rw', db.games, db.analyses, async () => {
    if (!(await db.games.get(a.gameId))) return false;
    await db.analyses.put(a);
    return true;
  });
}

/**
 * Status of every analysis, read from the `status` index only: no record (and so none of
 * its positions) is loaded or cloned (Sprint 4.6, PA-1). For lists that show only the status.
 */
export async function analysisStatuses(): Promise<Map<string, AnalysisStatus>> {
  const out = new Map<string, AnalysisStatus>();
  await getDb()
    .analyses.orderBy('status')
    .eachKey((status, cursor) => {
      out.set(String(cursor.primaryKey), status as AnalysisStatus);
    });
  return out;
}

/** Complete analyses only, through the `status` index: running or paused ones are not loaded (Sprint 4.6, PA-1). */
export async function listCompleteAnalyses(): Promise<GameAnalysis[]> {
  return getDb().analyses.where('status').equals('complete').toArray();
}

/**
 * Analyses left "running" by a closed tab (or a failed final save) become "paused" so they can be
 * resumed. One whose game lock is held is still running in another tab and stays as it is
 * (Sprint 4.8, T-1); without Web Locks every "running" record counts as interrupted, as before.
 * Each record is paused only if it did not change since it was read, in the write's own
 * transaction: a run that saved meanwhile keeps its state. `gameIds` limits the recovery to
 * those games; `afterRead` is a test seam that runs between the read and the write.
 * Resolves to the number of analyses paused.
 */
export async function recoverInterruptedAnalyses(gameIds?: readonly string[], afterRead?: () => Promise<unknown>): Promise<number> {
  const db = getDb();
  const running = await db.analyses.where('status').equals('running').toArray();
  const held = await heldAnalysisLocks();
  const orphans = running.filter((a) => (!gameIds || gameIds.includes(a.gameId)) && !held?.has(a.gameId));
  await afterRead?.();
  if (!orphans.length) return 0;
  return db.transaction('rw', db.analyses, async () => {
    let paused = 0;
    for (const a of orphans) {
      const now = await db.analyses.get(a.gameId);
      if (now?.status !== 'running' || now.updatedAt !== a.updatedAt) continue;
      await db.analyses.put({ ...now, status: 'paused' });
      paused++;
    }
    return paused;
  });
}

/** IndexedDB-backed cache that reuses any stored search meeting the requested depth and MultiPV. */
export const dbEvalCache: EvalCache = {
  async get(fen, depth, multiPv) {
    const row = await getDb().evalCache.get(fenKey(fen));
    if (!row || !row.complete || row.depth < depth || row.multiPv < multiPv) return undefined;
    const { key: _k, storedAt: _s, ...rest } = row;
    return { ...rest, fen, lines: rest.lines.slice(0, multiPv), multiPv };
  },
  async put(a: PositionAnalysis) {
    const key = fenKey(a.fen);
    const existing = await getDb().evalCache.get(key);
    if (existing && existing.depth >= a.depth && existing.multiPv >= a.multiPv) return;
    await getDb().evalCache.put({ ...a, key, storedAt: Date.now() });
  },
};

/** Replaces the game-derived skill evidence for a game (idempotent on re-analysis). */
export async function replaceGameSkillEvents(gameId: string, events: SkillEvent[]): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.skillEvents, async () => {
    await db.skillEvents.where('ref.gameId').equals(gameId).and((e) => e.source === 'game').delete();
    if (events.length) await db.skillEvents.bulkAdd(events);
  });
}

/**
 * Re-dates stored game evidence to the time its game was played (Sprint 4.4).
 * Evidence saved before stored the analysis time. Only the `at` of
 * `source: 'game'` events changes: nothing is created or deleted and the
 * engine is not used. Idempotent (events already right are left alone), so
 * it can run on every start. Returns how many events were re-dated.
 */
export async function redateGameEvidence(): Promise<number> {
  const db = getDb();
  return db.transaction('rw', db.games, db.skillEvents, async () => {
    const games = new Map((await db.games.toArray()).map((g) => [g.id, g]));
    const stale = (await db.skillEvents.where('source').equals('game').toArray()).flatMap((e) => {
      const game = e.ref.gameId ? games.get(e.ref.gameId) : undefined;
      if (!game || e.id === undefined) return [];
      const at = gameEvidenceTime(game, e.at);
      return at === e.at ? [] : [{ key: e.id, changes: { at } }];
    });
    if (stale.length) await db.skillEvents.bulkUpdate(stale);
    return stale.length;
  });
}

export async function listBookmarks(gameId?: string): Promise<Bookmark[]> {
  const db = getDb();
  const rows = gameId ? await db.bookmarks.where('gameId').equals(gameId).toArray() : await db.bookmarks.toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function toggleBookmark(gameId: string, ply: number, fen: string, note = ''): Promise<boolean> {
  const db = getDb();
  const existing = (await db.bookmarks.where('gameId').equals(gameId).toArray()).find((b) => b.ply === ply);
  if (existing) {
    await db.bookmarks.delete(existing.id);
    return false;
  }
  await db.bookmarks.add({ id: newId(), gameId, ply, fen, note, createdAt: Date.now() });
  return true;
}

export async function markBookmarkReviewed(id: string): Promise<void> {
  const db = getDb();
  const b = await db.bookmarks.get(id);
  if (b) await db.bookmarks.put({ ...b, reviewedAt: Date.now() });
}
