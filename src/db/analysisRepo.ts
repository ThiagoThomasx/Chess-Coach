import type { Bookmark, GameAnalysis, PositionAnalysis, SkillEvent } from '../types/domain';
import { fenKey, type EvalCache } from '../services/analysis/gameAnalyzer';
import { newId } from '../utils/hash';
import { gameEvidenceTime } from '../services/games/gameDate';
import { getDb } from './database';

export async function getAnalysis(gameId: string): Promise<GameAnalysis | undefined> {
  return getDb().analyses.get(gameId);
}

export async function saveAnalysis(a: GameAnalysis): Promise<void> {
  await getDb().analyses.put(a);
}

export async function listAnalyses(): Promise<GameAnalysis[]> {
  return getDb().analyses.toArray();
}

/** Analyses left in "running" state by a closed tab become "paused" so they can be resumed. */
export async function recoverInterruptedAnalyses(): Promise<number> {
  const db = getDb();
  const running = await db.analyses.where('status').equals('running').toArray();
  await Promise.all(running.map((a) => db.analyses.put({ ...a, status: 'paused' })));
  return running.length;
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
