import type { Color, Game, ImportRecord } from '../types/domain';
import { parsePgnText, MAX_PGN_BYTES } from '../services/pgn/parsePgn';
import { newId } from '../utils/hash';
import { getDb } from './database';

export interface ImportSummary {
  record: ImportRecord;
  imported: Game[];
}

/** Parses and stores games from PGN text, skipping duplicates by content hash. */
export async function importPgn(text: string, fileName: string, playerNames: readonly string[]): Promise<ImportSummary> {
  const db = getDb();
  const now = Date.now();
  const importId = newId();
  if (text.length > MAX_PGN_BYTES) {
    const record: ImportRecord = { id: importId, fileName, importedAt: now, totalFound: 0, imported: 0, duplicates: 0, failures: [{ index: 0, reason: 'Arquivo grande demais (limite de 20 MB)', snippet: '' }] };
    await db.imports.add(record);
    return { record, imported: [] };
  }
  const parsed = parsePgnText(text, playerNames);
  const imported: Game[] = [];
  let duplicates = 0;
  await db.transaction('rw', db.games, db.imports, async () => {
    const seen = new Set<string>();
    for (const g of parsed.games) {
      if (seen.has(g.hash) || (await db.games.where('hash').equals(g.hash).count()) > 0) {
        duplicates++;
        continue;
      }
      seen.add(g.hash);
      const game: Game = { ...g, importId, importedAt: now };
      await db.games.add(game);
      imported.push(game);
    }
    const record: ImportRecord = { id: importId, fileName, importedAt: now, totalFound: parsed.totalFound, imported: imported.length, duplicates, failures: parsed.failures };
    await db.imports.add(record);
  });
  const record = (await db.imports.get(importId)) as ImportRecord;
  return { record, imported };
}

/** Name recorded in the import report for PGN pasted as text. */
export const PASTE_SOURCE_NAME = 'Texto colado';

/** Imports PGN pasted as text through the same validation, dedup and size limit as a file. */
export async function importPastedPgn(text: string, playerNames: readonly string[]): Promise<ImportSummary> {
  if (text.trim().length === 0) throw new Error('O texto colado está vazio.');
  return importPgn(text, PASTE_SOURCE_NAME, playerNames);
}

export async function listGames(): Promise<Game[]> {
  return getDb().games.orderBy('importedAt').reverse().toArray();
}

export async function getGame(id: string): Promise<Game | undefined> {
  return getDb().games.get(id);
}

/** Sets (or clears) the user's color atomically. False when the game does not exist. */
export async function setUserColor(id: string, color: Color | undefined): Promise<boolean> {
  const db = getDb();
  return db.transaction('rw', db.games, async () => {
    const g = await db.games.get(id);
    if (!g) return false;
    const { userColor: _drop, ...rest } = g;
    await db.games.put(color ? { ...rest, userColor: color } : rest);
    return true;
  });
}

/** Deletes a game and everything derived from it. */
export async function deleteGame(id: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', [db.games, db.analyses, db.bookmarks, db.exercises, db.attempts, db.skillEvents], async () => {
    const exIds = (await db.exercises.where('gameId').equals(id).toArray()).map((e) => e.id);
    await db.attempts.where('exerciseId').anyOf(exIds).delete();
    // Evidence of exercise attempts refers to the exercise only (no gameId): remove it with its exercise,
    // as deleteExercise does, or the profile keeps counting training the user deleted (Sprint 4.5, N1).
    await db.skillEvents.where('ref.exerciseId').anyOf(exIds).delete();
    await db.exercises.where('gameId').equals(id).delete();
    await db.skillEvents.where('ref.gameId').equals(id).delete();
    await db.bookmarks.where('gameId').equals(id).delete();
    await db.analyses.delete(id);
    await db.games.delete(id);
  });
}

export async function listImports(): Promise<ImportRecord[]> {
  return getDb().imports.orderBy('importedAt').reverse().toArray();
}
