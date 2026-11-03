import { getDb, SCHEMA_VERSION, TABLE_NAMES, type TableName } from '../../db/database';
import { isValidFen } from '../chess/position';

export const BACKUP_FORMAT = 'chessquest-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  tables: Partial<Record<TableName, unknown[]>>;
}

export async function exportBackup(): Promise<BackupFile> {
  const db = getDb();
  const tables: Partial<Record<TableName, unknown[]>> = {};
  await db.transaction('r', TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) tables[t] = await db.table(t).toArray();
  });
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), tables };
}

export interface BackupValidation {
  ok: boolean;
  errors: string[];
  counts: Partial<Record<TableName, number>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Primary-key field per table; rows without it are rejected. */
const KEY_FIELD: Partial<Record<TableName, string>> = {
  games: 'id',
  imports: 'id',
  analyses: 'gameId',
  evalCache: 'key',
  bookmarks: 'id',
  exercises: 'id',
  repertoire: 'id',
  customOpenings: 'id',
  settings: 'id',
};

/** Structural validation performed BEFORE any record is touched. */
export function validateBackup(data: unknown): BackupValidation {
  const errors: string[] = [];
  const counts: Partial<Record<TableName, number>> = {};
  if (!isObj(data)) return { ok: false, errors: ['O arquivo não contém um objeto JSON'], counts };
  if (data.format !== BACKUP_FORMAT) errors.push('Formato desconhecido: não é um backup do ChessQuest');
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) errors.push(`Versão de esquema incompatível (${String(data.schemaVersion)})`);
  if (!isObj(data.tables)) {
    errors.push('Seção "tables" ausente');
    return { ok: false, errors, counts };
  }
  for (const [name, rows] of Object.entries(data.tables)) {
    if (!(TABLE_NAMES as readonly string[]).includes(name)) {
      errors.push(`Tabela desconhecida: ${name}`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`Tabela ${name} não é uma lista`);
      continue;
    }
    const t = name as TableName;
    counts[t] = rows.length;
    const key = KEY_FIELD[t];
    rows.forEach((r, i) => {
      if (!isObj(r)) return errors.push(`${name}[${i}] não é um objeto`);
      if (key && typeof r[key] !== 'string') errors.push(`${name}[${i}] sem chave "${key}"`);
      if (t === 'games' && (!Array.isArray(r.moves) || typeof r.startFen !== 'string' || !isValidFen(r.startFen))) errors.push(`games[${i}] com lances ou FEN inválidos`);
      if (t === 'exercises' && (typeof r.fen !== 'string' || !isValidFen(r.fen))) errors.push(`exercises[${i}] com FEN inválido`);
      return undefined;
    });
    if (errors.length > 20) break;
  }
  return { ok: errors.length === 0, errors: errors.slice(0, 20), counts };
}

/**
 * Restores a validated backup in a single transaction: either every table is
 * replaced, or (on any error) nothing changes.
 */
export async function restoreBackup(data: unknown): Promise<BackupValidation> {
  const v = validateBackup(data);
  if (!v.ok) return v;
  const backup = data as BackupFile;
  const db = getDb();
  await db.transaction('rw', TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) {
      const rows = backup.tables[t];
      if (!rows) continue;
      await db.table(t).clear();
      await db.table(t).bulkAdd(rows);
    }
  });
  return v;
}

export type ClearScope = 'analyses' | 'training' | 'openings' | 'all';

export async function clearData(scope: ClearScope): Promise<void> {
  const db = getDb();
  const map: Record<ClearScope, TableName[]> = {
    analyses: ['analyses', 'evalCache'],
    training: ['exercises', 'attempts', 'skillEvents', 'bookmarks'],
    openings: ['repertoire', 'openingAttempts', 'customOpenings'],
    all: [...TABLE_NAMES],
  };
  const tables = map[scope];
  await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
    for (const t of tables) await db.table(t).clear();
  });
}

export async function storageEstimate(): Promise<{ usage?: number; quota?: number; persisted?: boolean; counts: Record<string, number> }> {
  const db = getDb();
  const counts: Record<string, number> = {};
  for (const t of TABLE_NAMES) counts[t] = await db.table(t).count();
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const est = nav?.storage?.estimate ? await nav.storage.estimate() : undefined;
  const persisted = nav?.storage?.persisted ? await nav.storage.persisted() : undefined;
  return { ...(est?.usage !== undefined ? { usage: est.usage } : {}), ...(est?.quota !== undefined ? { quota: est.quota } : {}), ...(persisted !== undefined ? { persisted } : {}), counts };
}
