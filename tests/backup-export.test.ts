import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { importPgn, listGames } from '../src/db/gamesRepo';
import { loadSettings, saveSettings } from '../src/db/settings';
import { exportBackup, exportBackupFile, restoreBackup, type BackupDownload } from '../src/services/backup/backup';
import { readBackupStatus, shouldRemindBackup } from '../src/services/backup/dataProtection';
import { OPERA_GAME, SHORT_BLUNDER_GAME } from './fixtures';

// Sprint 4.8, N-1 (semantics): the date of the last backup export is recorded only after the file
// was generated and its download was requested without error. The browser does not tell whether
// the file was saved, so the date means "last export started", never "file saved".

const DAY = 86_400_000;
const EARLIER = Date.UTC(2026, 9, 1);
let n = 0;

beforeEach(() => {
  setDb(new ChessQuestDB(`backup-export-${++n}`));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Collects what the export hands to the browser. */
function recorder(): { start: (d: BackupDownload) => void; downloads: BackupDownload[] } {
  const downloads: BackupDownload[] = [];
  return { start: (d) => void downloads.push(d), downloads };
}

describe('exporting a backup records the date only after the download was requested', () => {
  it('a successful export hands the file over and records its export time', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const { start, downloads } = recorder();
    const file = await exportBackupFile(start);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.name).toMatch(/^chessquest-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const parsed = JSON.parse(await downloads[0]!.blob.text());
    expect(parsed.exportedAt).toBe(file.exportedAt);
    expect(parsed.tables.games).toHaveLength(1);
    expect((await loadSettings()).lastBackupAt).toBe(Date.parse(file.exportedAt));
  });

  it('generating the file alone records nothing', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    await exportBackup();
    expect((await loadSettings()).lastBackupAt).toBeUndefined();
  });

  it('a failure while generating the file records nothing and requests no download', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    await saveSettings({ lastBackupAt: EARLIER });
    // Every read of a game fails, as a storage error would while the file is being generated.
    const failRead = () => {
      throw new Error('leitura falhou');
    };
    getDb().games.hook('reading', failRead);
    const { start, downloads } = recorder();
    try {
      await expect(exportBackupFile(start)).rejects.toThrow('leitura falhou');
    } finally {
      getDb().games.hook('reading').unsubscribe(failRead);
    }
    expect(downloads).toHaveLength(0);
    expect((await loadSettings()).lastBackupAt).toBe(EARLIER);
  });

  it('a failure before the download starts records nothing', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    await saveSettings({ lastBackupAt: EARLIER });
    await expect(
      exportBackupFile(() => {
        throw new Error('o navegador recusou o download');
      }),
    ).rejects.toThrow('o navegador recusou o download');
    expect((await loadSettings()).lastBackupAt).toBe(EARLIER);
  });

  it('the recorded date is the snapshot time, so changes made after it still count as new data', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const file = await exportBackupFile(() => undefined);
    const at = Date.parse(file.exportedAt);
    expect(shouldRemindBackup(await readBackupStatus(), at + 30 * DAY)).toBe(false);
    await new Promise((r) => setTimeout(r, 2));
    await importPgn(SHORT_BLUNDER_GAME, 'b.pgn', []);
    expect(shouldRemindBackup(await readBackupStatus(), at + 30 * DAY)).toBe(true);
    expect(shouldRemindBackup(await readBackupStatus(), at + 13 * DAY)).toBe(false);
  });
});

describe('restoring a backup records its export time', () => {
  it('a successful restore records the export time of the file', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const file = await exportBackup();
    setDb(new ChessQuestDB(`backup-restore-${n}`));
    expect((await restoreBackup(file)).ok).toBe(true);
    expect((await loadSettings()).lastBackupAt).toBe(Date.parse(file.exportedAt));
  });

  it('an invalid backup records nothing', async () => {
    await saveSettings({ lastBackupAt: EARLIER });
    const r = await restoreBackup({ format: 'chessquest-backup', schemaVersion: 99, exportedAt: new Date().toISOString(), tables: {} });
    expect(r.ok).toBe(false);
    expect((await loadSettings()).lastBackupAt).toBe(EARLIER);
  });

  it('a restore that fails while writing changes nothing, the date included', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    await saveSettings({ lastBackupAt: EARLIER });
    const file = await exportBackup();
    // Two games with the same unique hash: valid shape, but the write fails and the transaction aborts.
    const [game] = file.tables.games as Record<string, unknown>[];
    const broken = { ...file, exportedAt: new Date().toISOString(), tables: { ...file.tables, games: [game, { ...game, id: 'other-id' }] } };
    await expect(restoreBackup(broken)).rejects.toThrow();
    expect((await loadSettings()).lastBackupAt).toBe(EARLIER);
    expect(await listGames()).toHaveLength(1);
  });

  it('an export time in the future is limited to now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const file = { ...(await exportBackup()), exportedAt: '2027-01-01T00:00:00.000Z' };
    expect((await restoreBackup(file)).ok).toBe(true);
    expect((await loadSettings()).lastBackupAt).toBe(Date.parse('2026-11-14T12:00:00Z'));
  });

  it('backups made before Sprint 4.8 restore as before', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const old = await exportBackup();
    // Settings without the new fields, as an older version wrote them.
    const settings = (old.tables.settings as Record<string, unknown>[]).map(({ lastBackupAt: _l, persistRequestedAt: _p, ...rest }) => rest);
    setDb(new ChessQuestDB(`backup-old-${n}`));
    expect((await restoreBackup({ ...old, tables: { ...old.tables, settings } })).ok).toBe(true);
    expect((await loadSettings()).lastBackupAt).toBe(Date.parse(old.exportedAt));
    expect(await listGames()).toHaveLength(1);
  });

  it('a backup without a usable export time restores without recording a date', async () => {
    const r = await restoreBackup({ format: 'chessquest-backup', schemaVersion: 2, exportedAt: '', tables: { games: [] } });
    expect(r.ok).toBe(true);
    expect((await loadSettings()).lastBackupAt).toBeUndefined();
  });
});
