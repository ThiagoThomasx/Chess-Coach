import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChessQuestDB, defineSchema, getDb, SCHEMA_VERSION, SCHEMA_VERSIONS, setDb, TABLE_NAMES } from '../src/db/database';
import { importPgn, listGames, getGame, deleteGame, listImports, setUserColor } from '../src/db/gamesRepo';
import { getAnalysis, saveAnalysis, recoverInterruptedAnalyses, dbEvalCache, toggleBookmark, listBookmarks } from '../src/db/analysisRepo';
import { addExercise, recordAttempt, attemptsFor, getExercise, listSkillEvents } from '../src/db/trainingRepo';
import { loadSettings, saveSettings } from '../src/db/settings';
import { exportBackup, restoreBackup, validateBackup, clearData } from '../src/services/backup/backup';
import { emptyAnalysis } from '../src/services/analysis/gameAnalyzer';
import { toggleRepertoire, recordOpeningAttempt, listRepertoire, addCustomOpening } from '../src/db/openingsRepo';
import type { Exercise } from '../src/types/domain';
import { normalizeExercise } from '../src/services/exercises/sequence';
import { OPERA_GAME, SHORT_BLUNDER_GAME } from './fixtures';

let n = 0;
beforeEach(() => {
  setDb(new ChessQuestDB(`test-${++n}`));
});

const exerciseFixture = (gameId: string): Exercise => ({
  id: 'ex1',
  fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
  source: 'game',
  gameId,
  ply: 5,
  sideToMove: 'w',
  objective: 'Encontre o mate em 1.',
  theme: 'missed_mate',
  skill: 'patterns',
  bestMove: { uci: 'a1a8', san: 'Ra8#', score: { kind: 'mate', value: 1 } },
  acceptableMoves: [{ uci: 'a1a8', san: 'Ra8#', score: { kind: 'mate', value: 1 } }],
  solutionLine: ['a1a8'],
  referenceLines: [],
  difficulty: 1,
  ambiguous: false,
  tolerance: 5,
  createdAt: 1,
  srs: { box: 0, dueAt: 1 },
  analysisDepth: 16,
});

describe('games persistence', () => {
  it('imports, lists, deduplicates and records history', async () => {
    const first = await importPgn(`${OPERA_GAME}\n\n${SHORT_BLUNDER_GAME}`, 'games.pgn', ['Aluno']);
    expect(first.record.imported).toBe(2);
    const second = await importPgn(OPERA_GAME, 'again.pgn', []);
    expect(second.record.imported).toBe(0);
    expect(second.record.duplicates).toBe(1);
    expect(await listGames()).toHaveLength(2);
    expect(await listImports()).toHaveLength(2);
  });

  it('reopens data after the database connection is recreated (app restart)', async () => {
    const name = `restart-${n}`;
    setDb(new ChessQuestDB(name));
    const { imported } = await importPgn(SHORT_BLUNDER_GAME, 'a.pgn', ['Aluno']);
    const id = imported[0]!.id;
    const a = emptyAnalysis(imported[0]!, { depth: 12, multiPv: 1 });
    await saveAnalysis({ ...a, status: 'running' });
    await addExercise(exerciseFixture(id));

    setDb(new ChessQuestDB(name)); // new connection, same storage
    expect((await getGame(id))?.moves).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Nd4', 'exd4']);
    expect(await recoverInterruptedAnalyses()).toBe(1);
    expect((await getAnalysis(id))?.status).toBe('paused');
    expect((await getExercise('ex1'))?.fen).toBe(exerciseFixture(id).fen);
  });

  it('updates user color and deletes a game with its derived data', async () => {
    const { imported } = await importPgn(SHORT_BLUNDER_GAME, 'a.pgn', []);
    const id = imported[0]!.id;
    await setUserColor(id, 'b');
    expect((await getGame(id))?.userColor).toBe('b');
    await addExercise(exerciseFixture(id));
    await deleteGame(id);
    expect(await getGame(id)).toBeUndefined();
    expect(await getExercise('ex1')).toBeUndefined();
  });
});

describe('analysis cache and bookmarks', () => {
  it('reuses cached evaluations only when deep enough', async () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
    await dbEvalCache.put({ fen, depth: 14, multiPv: 2, complete: true, timeMs: 5, lines: [] });
    expect(await dbEvalCache.get(fen.replace(' 0 1', ' 3 9'), 12, 1)).toBeDefined();
    expect(await dbEvalCache.get(fen, 18, 1)).toBeUndefined();
    expect(await dbEvalCache.get(fen, 12, 3)).toBeUndefined();
  });

  it('toggles bookmarks', async () => {
    expect(await toggleBookmark('g', 3, 'f')).toBe(true);
    expect(await listBookmarks('g')).toHaveLength(1);
    expect(await toggleBookmark('g', 3, 'f')).toBe(false);
    expect(await listBookmarks('g')).toHaveLength(0);
  });
});

describe('training persistence', () => {
  it('records attempts, reschedules and logs skill evidence atomically', async () => {
    const ex = exerciseFixture('g');
    expect((await addExercise(ex)).added).toBe(true);
    expect((await addExercise({ ...ex, id: 'other' })).added).toBe(false); // same FEN
    const { exercise: updated } = await recordAttempt(ex, { exerciseId: ex.id, at: 1000, correct: false, hintsUsed: 1, revealed: true, timeMs: 30_000, moves: ['a1a7'] }, [1, 3]);
    expect(updated.srs.box).toBe(0);
    expect(await attemptsFor(ex.id)).toHaveLength(1);
    const events = await listSkillEvents();
    expect(events[0]).toMatchObject({ skill: 'patterns', outcome: 0, ref: { exerciseId: 'ex1' } });
  });

  it('treats a repeat right after seeing the answer as practice (audit A1)', async () => {
    const ex = exerciseFixture('g');
    await addExercise(ex);
    const attempt = (at: number, hintsUsed: number) => ({ exerciseId: ex.id, at, correct: true, hintsUsed, revealed: false, timeMs: 5_000, moves: ['a1a8'] });
    const first = await recordAttempt(ex, attempt(1_000, 3), [1, 3]);
    expect(first.practice).toBe(false);
    // "Resolver de novo" a minute later, now without hints.
    const repeat = await recordAttempt(first.exercise, attempt(61_000, 0), [1, 3]);
    expect(repeat.practice).toBe(true);
    expect(repeat.exercise.srs).toEqual(first.exercise.srs);
    expect(await attemptsFor(ex.id)).toHaveLength(1);
    expect((await listSkillEvents()).some((e) => e.independent)).toBe(false);
    // After the practice window, a clean solve is real retrieval again.
    const later = await recordAttempt(first.exercise, attempt(1_000 + 11 * 60_000, 0), [1, 3]);
    expect(later.practice).toBe(false);
    expect(later.exercise.srs.box).toBe(1);
  });

  it('persists settings merged over defaults', async () => {
    expect((await loadSettings()).analysisDepth).toBe(16);
    await saveSettings({ analysisDepth: 20, playerNames: ['Aluno'] });
    const s = await loadSettings();
    expect(s.analysisDepth).toBe(20);
    expect(s.thresholds.minDepth).toBeGreaterThan(0);
  });

  it('tracks repertoire drills and reschedules errors', async () => {
    await toggleRepertoire('italian', 'main', 'w');
    await recordOpeningAttempt({ openingId: 'italian', lineId: 'main', at: 5000, correct: false, errorPly: 4 }, [1, 3]);
    const [entry] = await listRepertoire();
    expect(entry?.srs.box).toBe(0);
    expect((await listSkillEvents()).at(-1)?.skill).toBe('openings');
  });

  it('rejects illegal custom opening lines', async () => {
    await expect(addCustomOpening('X', 'w', ['e4', 'e4'], [])).rejects.toThrow(/ilegal/);
    expect((await addCustomOpening('Minha', 'w', ['d4', 'd5', 'c4'], [])).mainLine.moves).toHaveLength(3);
  });
});

describe('exercise deduplication is atomic (Sprint 3.1)', () => {
  const sameSpot = (id: string, moveNo: number): Exercise => ({
    ...exerciseFixture('g'),
    id,
    fen: `6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 ${moveNo}`,
  });

  it('two concurrent inserts of the same position store one exercise', async () => {
    const results = await Promise.all([addExercise(sameSpot('a', 1)), addExercise(sameSpot('b', 30))]);
    expect(await getDb().exercises.count()).toBe(1);
    expect(results.filter((r) => r.added)).toHaveLength(1);
    expect(results[0].id).toBe(results[1].id);
  });

  it('concurrent inserts from two connections (two tabs) store one exercise', async () => {
    const name = `tabs-${++n}`;
    const tabA = new ChessQuestDB(name);
    const tabB = new ChessQuestDB(name);
    setDb(tabA);
    const fromA = addExercise(sameSpot('a', 1));
    setDb(tabB);
    const fromB = addExercise(sameSpot('b', 30));
    await Promise.all([fromA, fromB]);
    expect(await tabA.exercises.count()).toBe(1);
    tabA.close();
    tabB.close();
  });

  it('a failed insert writes nothing and reports the error', async () => {
    await addExercise(sameSpot('a', 1));
    const clash: Exercise = { ...exerciseFixture('g'), id: 'a', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' };
    await expect(addExercise(clash)).rejects.toThrow();
    const rows = await getDb().exercises.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fen).toBe(sameSpot('a', 1).fen);
  });
});

describe('backup and restore', () => {
  it('round-trips all data', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    await addExercise(exerciseFixture('g'));
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    await clearData('all');
    expect(await listGames()).toHaveLength(0);
    const r = await restoreBackup(backup);
    expect(r.ok).toBe(true);
    expect(await listGames()).toHaveLength(1);
    expect(await getExercise('ex1')).toBeDefined();
  });

  it('refuses invalid backups without touching existing records', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    for (const bad of [null, { format: 'other' }, { format: 'chessquest-backup', schemaVersion: 1, tables: { games: [{ id: 'x', moves: 'no', startFen: 'bad' }] } }, { format: 'chessquest-backup', schemaVersion: 99, tables: {} }]) {
      const r = await restoreBackup(bad);
      expect(r.ok).toBe(false);
    }
    expect(await listGames()).toHaveLength(1);
    expect(validateBackup({ format: 'chessquest-backup', schemaVersion: 1, tables: { unknown: [] } }).errors[0]).toMatch(/desconhecida/);
  });

  it('a partial backup replaces only the tables it contains', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const r = await restoreBackup({ format: 'chessquest-backup', schemaVersion: 2, exportedAt: '', tables: { exercises: [exerciseFixture('g')] } });
    expect(r.ok).toBe(true);
    expect(await listGames()).toHaveLength(1);
    expect(await getExercise('ex1')).toBeDefined();
  });

  it('restores a backup from an older schema with a pre-tree exercise', async () => {
    const legacy = { ...exerciseFixture('g'), kind: undefined, goal: undefined, tree: undefined };
    const r = await restoreBackup({ format: 'chessquest-backup', schemaVersion: 1, exportedAt: '', tables: { exercises: [JSON.parse(JSON.stringify(legacy))] } });
    expect(r.ok).toBe(true);
    const stored = await getExercise('ex1');
    expect(stored?.tree).toBeUndefined();
    expect(normalizeExercise(stored!).tree.accepted.length).toBeGreaterThan(0);
  });

  it('refuses a backup game whose start position is impossible', () => {
    const v = validateBackup({ format: 'chessquest-backup', schemaVersion: 2, tables: { games: [{ id: 'x', moves: [], startFen: '8/8/8/3k4/8/8/8/K6Q w - - 0 1' }] } });
    expect(v.ok).toBe(false);
  });

  it('clears data selectively', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    await addExercise(exerciseFixture('g'));
    await clearData('training');
    expect(await getExercise('ex1')).toBeUndefined();
    expect(await listGames()).toHaveLength(1);
  });
});

describe('schema migration', () => {
  it('upgrades a v1 database: legacy exercises gain a solution tree, data is kept', async () => {
    const name = `migrate-${++n}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ exercises: 'id, gameId, theme, skill, difficulty, srs.dueAt, createdAt, source', games: 'id, &hash, importId, importedAt' });
    const legacy = { ...exerciseFixture('g'), kind: undefined, goal: undefined, tree: undefined };
    await v1.table('exercises').put(legacy);
    v1.close();

    const db = new ChessQuestDB(name);
    setDb(db);
    const ex = await getExercise('ex1');
    expect(ex?.tree?.accepted[0]?.uci).toBe('a1a8');
    expect(ex?.kind).toBe('mate');
    expect(ex?.fen).toBe(legacy.fen);
    expect(db.verno).toBe(2);
  });

  it('declares every schema version explicitly, ending at SCHEMA_VERSION (Sprint 4.3)', () => {
    expect(SCHEMA_VERSIONS.map((v) => v.version)).toEqual([1, 2]);
    expect(SCHEMA_VERSIONS.at(-1)?.version).toBe(SCHEMA_VERSION);
    expect(Object.keys(SCHEMA_VERSIONS[0]?.stores ?? {}).sort()).toEqual([...TABLE_NAMES].sort());
  });

  it('upgrades a v1 database with every table populated, keeping all rows (Sprint 4.3)', async () => {
    const name = `migrate-${++n}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(V1_STORES);
    await v1.table('games').put({ id: 'g1', hash: 'h1', importId: 'i1', importedAt: 1 });
    await v1.table('exercises').put({ ...exerciseFixture('g1'), kind: undefined, goal: undefined, tree: undefined });
    await v1.table('attempts').put({ exerciseId: 'ex1', at: 2, correct: true, hintsUsed: 0, revealed: false, timeMs: 1, moves: [] });
    await v1.table('bookmarks').put({ id: 'b1', gameId: 'g1', createdAt: 3 });
    v1.close();

    const db = new ChessQuestDB(name);
    await db.open();
    expect(db.verno).toBe(2);
    expect(await db.games.count()).toBe(1);
    expect(await db.exercises.count()).toBe(1);
    expect(await db.attempts.count()).toBe(1);
    expect(await db.bookmarks.count()).toBe(1);
    expect((await db.exercises.get('ex1'))?.tree?.accepted[0]?.uci).toBe('a1a8');
    db.close();
  });

  it('opens a v2 database created by the pre-4.3 declarations without touching its rows (Sprint 4.3)', async () => {
    const name = `migrate-${++n}`;
    const old = new Dexie(name);
    old.version(2).stores(V1_STORES); // pre-4.3 code declared the full schema at version 2
    await old.table('games').put({ id: 'g1', hash: 'h1', importId: 'i1', importedAt: 1 });
    await old.table('exercises').put(normalizeExercise(exerciseFixture('g1')));
    await old.table('skillEvents').put({ skill: 'tactics', at: 1, outcome: 1, weight: 1, source: 'exercise', ref: { exerciseId: 'ex1' } });
    old.close();

    const db = new ChessQuestDB(name);
    await db.open();
    expect(db.verno).toBe(2);
    expect(await db.games.count()).toBe(1);
    expect(await db.exercises.count()).toBe(1);
    expect(await db.skillEvents.where('skill').equals('tactics').count()).toBe(1);
    db.close();
  });

  it('a future version added to the list keeps the data of v1 and v2 databases (Sprint 4.3)', async () => {
    const v3 = { version: 3, stores: { games: 'id, &hash, importId, importedAt, userColor' } };
    const withV3 = (dbName: string) => {
      const d = new Dexie(dbName);
      defineSchema(d, [...SCHEMA_VERSIONS, v3]);
      return d;
    };

    // From v2 (current production databases).
    const v2name = `migrate-${++n}`;
    const v2 = new ChessQuestDB(v2name);
    setDb(v2);
    await importPgn(OPERA_GAME, 'a.pgn', ['Aluno']);
    await addExercise(exerciseFixture('g'));
    v2.close();
    const upgraded = withV3(v2name);
    await upgraded.open();
    expect(upgraded.verno).toBe(3);
    expect(await upgraded.table('games').count()).toBe(1);
    expect(await upgraded.table('exercises').count()).toBe(1);
    expect(await upgraded.table('imports').count()).toBe(1);
    upgraded.close();

    // From v1 (oldest databases), straight to v3.
    const v1name = `migrate-${++n}`;
    const v1 = new Dexie(v1name);
    v1.version(1).stores(V1_STORES);
    await v1.table('games').put({ id: 'g1', hash: 'h1', importId: 'i1', importedAt: 1 });
    await v1.table('exercises').put({ ...exerciseFixture('g1'), kind: undefined, goal: undefined, tree: undefined });
    v1.close();
    const fromV1 = withV3(v1name);
    await fromV1.open();
    expect(await fromV1.table('games').count()).toBe(1);
    const ex = (await fromV1.table('exercises').get('ex1')) as Exercise | undefined;
    expect(ex?.tree?.accepted[0]?.uci).toBe('a1a8');
    fromV1.close();
  });
});

/** The v1 schema exactly as shipped in the MVP (ef447c1). */
const V1_STORES = {
  games: 'id, &hash, importId, importedAt',
  imports: 'id, importedAt',
  analyses: 'gameId, status, updatedAt',
  evalCache: 'key, storedAt',
  bookmarks: 'id, gameId, createdAt',
  exercises: 'id, gameId, theme, skill, difficulty, srs.dueAt, createdAt, source',
  attempts: '++id, exerciseId, at',
  skillEvents: '++id, skill, at, source, ref.gameId, ref.exerciseId',
  repertoire: 'id, openingId, side, srs.dueAt',
  customOpenings: 'id',
  openingAttempts: '++id, openingId, lineId, at',
  settings: 'id',
};
