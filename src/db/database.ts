import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type {
  Attempt,
  Bookmark,
  Exercise,
  Game,
  GameAnalysis,
  ImportRecord,
  Opening,
  OpeningAttempt,
  PositionAnalysis,
  RepertoireEntry,
  Settings,
  SkillEvent,
} from '../types/domain';
import { normalizeExercise } from '../services/exercises/sequence';

export interface EvalCacheRow extends PositionAnalysis {
  key: string; // fenKey
  storedAt: number;
}

export const DB_NAME = 'chessquest';

/** One step of the schema history: the stores that change in it and an optional data upgrade. */
export interface SchemaVersion {
  version: number;
  /** Only the tables added or changed in this version (Dexie inherits the rest). */
  stores: Record<string, string | null>;
  upgrade?: (tx: Transaction) => PromiseLike<unknown> | void;
}

/**
 * The full IndexedDB schema history, oldest first. Dexie needs every version
 * declared: a database is upgraded through each step after its own version.
 *
 * To change the schema, APPEND a new entry. Never edit or remove an existing
 * entry, and never move the full table list to a newer version: a database at
 * an older version would then be upgraded through a version without its
 * tables and lose their rows. `SCHEMA_VERSION` follows the last entry.
 */
export const SCHEMA_VERSIONS: readonly SchemaVersion[] = [
  {
    version: 1,
    stores: {
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
    },
  },
  {
    // v2: exercises gain kind/goal/tree (sequence exercises). Legacy rows are converted.
    version: 2,
    stores: {},
    upgrade: (tx) =>
      tx
        .table('exercises')
        .toCollection()
        .modify((ex: Exercise) => {
          if (!ex.tree) Object.assign(ex, normalizeExercise(ex));
        }),
  },
];

export const SCHEMA_VERSION = SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1]?.version ?? 1;

/** Declares the schema history on a Dexie instance (also used by upgrade tests). */
export function defineSchema(db: Dexie, versions: readonly SchemaVersion[] = SCHEMA_VERSIONS): void {
  for (const v of versions) {
    const declared = db.version(v.version).stores(v.stores);
    if (v.upgrade) declared.upgrade(v.upgrade);
  }
}

export class ChessQuestDB extends Dexie {
  games!: EntityTable<Game, 'id'>;
  imports!: EntityTable<ImportRecord, 'id'>;
  analyses!: EntityTable<GameAnalysis, 'gameId'>;
  evalCache!: EntityTable<EvalCacheRow, 'key'>;
  bookmarks!: EntityTable<Bookmark, 'id'>;
  exercises!: EntityTable<Exercise, 'id'>;
  attempts!: EntityTable<Attempt, 'id'>;
  skillEvents!: EntityTable<SkillEvent, 'id'>;
  repertoire!: EntityTable<RepertoireEntry, 'id'>;
  customOpenings!: EntityTable<Opening, 'id'>;
  openingAttempts!: EntityTable<OpeningAttempt, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor(name: string = DB_NAME) {
    super(name);
    defineSchema(this);
  }
}

export const TABLE_NAMES = [
  'games',
  'imports',
  'analyses',
  'evalCache',
  'bookmarks',
  'exercises',
  'attempts',
  'skillEvents',
  'repertoire',
  'customOpenings',
  'openingAttempts',
  'settings',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

let instance: ChessQuestDB | null = null;

export function getDb(): ChessQuestDB {
  if (!instance) instance = new ChessQuestDB();
  return instance;
}

/** For tests: swap the singleton with a fresh database. */
export function setDb(db: ChessQuestDB): void {
  instance = db;
}
