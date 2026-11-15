import { getDb } from '../../db/database';
import { loadSettings, saveSettings } from '../../db/settings';

/**
 * Protection of the local history (Sprint 4.8, N-1). Everything lives in this browser's storage:
 * the app asks once for persistent storage (the browser then does not evict it under storage
 * pressure) and reminds the player to export a backup.
 */

/** Days without a backup, with new data, before the reminder shows (user decision, Sprint 4.8). */
export const BACKUP_REMINDER_DAYS = 14;
const DAY_MS = 86_400_000;

export interface BackupStatus {
  /** Last backup export whose download was requested, or export time of the backup restored. */
  lastBackupAt?: number;
  /** First game imported: when unprotected data started to exist. */
  firstDataAt?: number;
  /** Latest change to the player's data (games, analyses, exercises, attempts, drills, bookmarks). */
  lastChangeAt?: number;
}

/**
 * True when there is data the last backup does not have and the backup (or, without one, the
 * first data) is at least BACKUP_REMINDER_DAYS old.
 */
export function shouldRemindBackup(s: BackupStatus, now: number): boolean {
  if (s.lastChangeAt === undefined) return false;
  if (s.lastBackupAt !== undefined && s.lastChangeAt <= s.lastBackupAt) return false;
  const since = s.lastBackupAt ?? s.firstDataAt ?? s.lastChangeAt;
  return now - since >= BACKUP_REMINDER_DAYS * DAY_MS;
}

/** Reads the status from the time indexes only (one key per table, no records loaded). */
export async function readBackupStatus(): Promise<BackupStatus> {
  const db = getDb();
  const lastKey = async (index: Promise<unknown>): Promise<number | undefined> => {
    const key = await index;
    return typeof key === 'number' ? key : undefined;
  };
  const [settings, firstDataAt, ...latest] = await Promise.all([
    loadSettings(),
    lastKey(db.games.orderBy('importedAt').firstKey()),
    lastKey(db.games.orderBy('importedAt').lastKey()),
    lastKey(db.analyses.orderBy('updatedAt').lastKey()),
    lastKey(db.exercises.orderBy('createdAt').lastKey()),
    lastKey(db.attempts.orderBy('at').lastKey()),
    lastKey(db.openingAttempts.orderBy('at').lastKey()),
    lastKey(db.bookmarks.orderBy('createdAt').lastKey()),
  ]);
  const times = latest.filter((t): t is number => t !== undefined);
  return {
    ...(settings.lastBackupAt !== undefined ? { lastBackupAt: settings.lastBackupAt } : {}),
    ...(firstDataAt !== undefined ? { firstDataAt } : {}),
    ...(times.length ? { lastChangeAt: Math.max(...times) } : {}),
  };
}

/** The part of `navigator.storage` used here. */
export interface StorageLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export type PersistOutcome = 'granted' | 'denied' | 'already' | 'asked-before' | 'unsupported';

function browserStorage(): StorageLike | undefined {
  return typeof navigator !== 'undefined' ? (navigator as { storage?: StorageLike }).storage : undefined;
}

/**
 * Asks the browser for persistent storage the first time it is called with data to protect (after
 * the first import). Asked once: Firefox shows a prompt, and a "no" is not asked again. Never
 * throws: a refused or failed request only means the data stays in best-effort storage.
 */
export async function requestPersistentStorageOnce(storage: StorageLike | undefined = browserStorage()): Promise<PersistOutcome> {
  if (!storage?.persist) return 'unsupported';
  try {
    if (await storage.persisted?.()) return 'already';
    if ((await loadSettings()).persistRequestedAt !== undefined) return 'asked-before';
    await saveSettings({ persistRequestedAt: Date.now() });
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch (e) {
    console.error('ChessQuest: falha ao pedir armazenamento persistente', e);
    return 'denied';
  }
}

/** The reminder shown on the dashboard, or null when none is due. */
export function backupReminderText(s: BackupStatus, now: number): string | null {
  if (!shouldRemindBackup(s, now)) return null;
  const days = Math.floor((now - (s.lastBackupAt ?? s.firstDataAt ?? now)) / DAY_MS);
  return s.lastBackupAt !== undefined
    ? `Sua última exportação de backup foi há ${days} dias, e há dados novos desde então.`
    : `Você ainda não exportou um backup, e seu histórico está só neste navegador há ${days} dias.`;
}
