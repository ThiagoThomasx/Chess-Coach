import Dexie, { type EntityTable } from 'dexie';
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

export interface EvalCacheRow extends PositionAnalysis {
  key: string; // fenKey
  storedAt: number;
}

export const DB_NAME = 'chessquest';
export const SCHEMA_VERSION = 1;

/**
 * IndexedDB schema. Bump `SCHEMA_VERSION` and add a new `.version()` block
 * (with an upgrade function when needed) for every schema change.
 */
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
    this.version(SCHEMA_VERSION).stores({
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
    });
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
