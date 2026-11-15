import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { importPgn } from '../src/db/gamesRepo';
import { loadSettings } from '../src/db/settings';
import { exportBackup, exportBackupFile, restoreBackup } from '../src/services/backup/backup';
import {
  BACKUP_REMINDER_DAYS,
  backupReminderText,
  readBackupStatus,
  requestPersistentStorageOnce,
  shouldRemindBackup,
  type StorageLike,
} from '../src/services/backup/dataProtection';
import { OPERA_GAME, SHORT_BLUNDER_GAME } from './fixtures';

// Sprint 4.8, N-1: the whole history lives in this browser. Ask once for persistent storage and
// remind the player to export a backup when there is new data and no backup for 14 days.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);
let n = 0;

beforeEach(() => {
  setDb(new ChessQuestDB(`protect-${++n}`));
});

describe('shouldRemindBackup', () => {
  it('stays quiet without data', () => {
    expect(shouldRemindBackup({}, NOW)).toBe(false);
  });

  it('never backed up: reminds once the first data is 14 days old', () => {
    expect(BACKUP_REMINDER_DAYS).toBe(14);
    expect(shouldRemindBackup({ firstDataAt: NOW - 13 * DAY, lastChangeAt: NOW }, NOW)).toBe(false);
    expect(shouldRemindBackup({ firstDataAt: NOW - 14 * DAY, lastChangeAt: NOW }, NOW)).toBe(true);
  });

  it('backed up: reminds only with new data and 14 days since the backup', () => {
    const base = { firstDataAt: NOW - 100 * DAY, lastBackupAt: NOW - 20 * DAY };
    expect(shouldRemindBackup({ ...base, lastChangeAt: NOW - 21 * DAY }, NOW)).toBe(false); // nothing new
    expect(shouldRemindBackup({ ...base, lastChangeAt: NOW - DAY }, NOW)).toBe(true);
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW - 13 * DAY, lastChangeAt: NOW - DAY }, NOW)).toBe(false); // recent backup
  });
});

describe('readBackupStatus', () => {
  it('finds the first and last data and the last backup', async () => {
    expect(await readBackupStatus()).toEqual({});
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const first = await readBackupStatus();
    expect(first.firstDataAt).toBeGreaterThan(0);
    expect(first.lastChangeAt).toBe(first.firstDataAt);
    expect(first.lastBackupAt).toBeUndefined();
    await new Promise((r) => setTimeout(r, 2));
    await importPgn(SHORT_BLUNDER_GAME, 'b.pgn', []);
    const second = await readBackupStatus();
    expect(second.firstDataAt).toBe(first.firstDataAt);
    expect(second.lastChangeAt).toBeGreaterThan(first.lastChangeAt ?? 0);
  });

  it('counts training attempts as new data', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const before = await readBackupStatus();
    await getDb().attempts.add({ exerciseId: 'x', at: (before.lastChangeAt ?? 0) + 5 * DAY, correct: true } as never);
    expect((await readBackupStatus()).lastChangeAt).toBe((before.lastChangeAt ?? 0) + 5 * DAY);
  });
});

describe('the backup records when it was made', () => {
  it('an export whose download was requested is the last backup export in the status', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const file = await exportBackupFile(() => undefined);
    const at = (await loadSettings()).lastBackupAt;
    expect(at).toBe(Date.parse(file.exportedAt));
    expect((await readBackupStatus()).lastBackupAt).toBe(at);
  });

  it('restoring a backup does not remind about the data it brought back', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const file = await exportBackup();
    setDb(new ChessQuestDB(`protect-restore-${n}`));
    expect((await restoreBackup(file)).ok).toBe(true);
    const status = await readBackupStatus();
    expect(status.lastBackupAt).toBe(Date.parse(file.exportedAt));
    expect(shouldRemindBackup(status, (status.lastBackupAt ?? 0) + 30 * DAY)).toBe(false);
  });
});

describe('requestPersistentStorageOnce', () => {
  const storage = (persisted: boolean, grant: boolean) => {
    const calls = { persist: 0 };
    const s: StorageLike = {
      persisted: async () => persisted,
      persist: async () => {
        calls.persist++;
        return grant;
      },
    };
    return { s, calls };
  };

  it('asks once and remembers it asked', async () => {
    const { s, calls } = storage(false, false);
    expect(await requestPersistentStorageOnce(s)).toBe('denied');
    expect(await requestPersistentStorageOnce(s)).toBe('asked-before');
    expect(calls.persist).toBe(1);
    expect((await loadSettings()).persistRequestedAt).toBeGreaterThan(0);
  });

  it('reports a grant', async () => {
    expect(await requestPersistentStorageOnce(storage(false, true).s)).toBe('granted');
  });

  it('does not ask when the storage is already persistent or the API is missing', async () => {
    const { s, calls } = storage(true, true);
    expect(await requestPersistentStorageOnce(s)).toBe('already');
    expect(calls.persist).toBe(0);
    expect(await requestPersistentStorageOnce(undefined)).toBe('unsupported');
    expect((await loadSettings()).persistRequestedAt).toBeUndefined();
  });

  it('a failing request is reported, not thrown', async () => {
    const s: StorageLike = { persisted: async () => false, persist: async () => Promise.reject(new Error('blocked')) };
    expect(await requestPersistentStorageOnce(s)).toBe('denied');
  });
});

describe('backupReminderText', () => {
  it('says how long since the backup, or since the data started without one', () => {
    expect(backupReminderText({ firstDataAt: NOW - 30 * DAY, lastBackupAt: NOW - 15 * DAY, lastChangeAt: NOW }, NOW)).toBe('Sua última exportação de backup foi há 15 dias, e há dados novos desde então.');
    expect(backupReminderText({ firstDataAt: NOW - 20 * DAY, lastChangeAt: NOW }, NOW)).toBe('Você ainda não exportou um backup, e seu histórico está só neste navegador há 20 dias.');
    expect(backupReminderText({ firstDataAt: NOW - 2 * DAY, lastChangeAt: NOW }, NOW)).toBeNull();
  });
});
