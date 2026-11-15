import { getDb, SCHEMA_VERSION, TABLE_NAMES, type TableName } from '../../db/database';
import { isValidFen } from '../chess/position';
import { normalizeSettings } from '../../db/settings';
import { dayKey } from '../stats/stats';

export const BACKUP_FORMAT = 'chessquest-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  tables: Partial<Record<TableName, unknown[]>>;
}

/** Reads every table into a backup file. Records nothing: see `exportBackupFile`. */
export async function exportBackup(): Promise<BackupFile> {
  const db = getDb();
  const tables: Partial<Record<TableName, unknown[]>> = {};
  const exportedAt = Date.now();
  await db.transaction('r', TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) tables[t] = await db.table(t).toArray();
  });
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date(exportedAt).toISOString(), tables };
}

/** A generated backup, ready to be handed to the browser as a download. */
export interface BackupDownload {
  name: string;
  blob: Blob;
}

/** Name of the backup file, on the local calendar day (a backup at 22h in Brazil is not named after the next UTC day, audit FA-3). */
export function backupFileName(at: number): string {
  return `chessquest-backup-${dayKey(at)}.json`;
}

/**
 * Generates the backup file and requests its download (`startDownload`); only then records the
 * export time as the last backup export (Sprint 4.8, N-1). A failure while reading, serializing or
 * requesting the download records nothing and is passed on. The browser does not tell whether the
 * file was saved: the date means "last export started", not "file saved".
 */
export async function exportBackupFile(startDownload: (download: BackupDownload) => void): Promise<BackupFile> {
  const file = await exportBackup();
  const exportedAt = Date.parse(file.exportedAt);
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  startDownload({ name: backupFileName(exportedAt), blob });
  const db = getDb();
  await db.transaction('rw', db.settings, () => stampLastBackup(exportedAt));
  return file;
}

/**
 * Records `at` (limited to now: a clock ahead must not silence the reminder, review 4.8 M3) as the
 * last backup export. Call inside a transaction that includes the settings table.
 */
async function stampLastBackup(at: number): Promise<void> {
  const settings = getDb().settings;
  await settings.put({ ...normalizeSettings(await settings.get('app')), lastBackupAt: Math.min(at, Date.now()) });
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
    // The data now is exactly the file's: it counts as exported at the file's export time (Sprint 4.8,
    // N-1), also for files made before 4.8. Inside the transaction: a failed restore records nothing.
    const exportedAt = Date.parse(backup.exportedAt);
    if (Number.isFinite(exportedAt)) await stampLastBackup(exportedAt);
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
