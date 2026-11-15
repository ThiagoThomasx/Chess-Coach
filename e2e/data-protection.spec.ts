import { expect, test } from '@playwright/test';
import { BLUNDER_PGN, putRows, readTable } from './helpers';

// Sprint 4.8, N-1: persistent storage asked once after the first import; last backup shown; a
// reminder on the dashboard after 14 days with data that no backup has.

const DAY = 86_400_000;

test('the first import asks once for persistent storage', async ({ page }) => {
  // The browser's answer is stubbed: the test checks that the app asks, and only once.
  await page.addInitScript(() => {
    const w = window as unknown as { persistCalls: number };
    w.persistCalls = 0;
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => false });
    Object.defineProperty(navigator.storage, 'persist', {
      value: async () => {
        w.persistCalls++;
        return false;
      },
    });
  });
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls)).toBe(1);
  await expect.poll(async () => (await readTable<{ persistRequestedAt?: number }>(page, 'settings'))[0]?.persistRequestedAt).toBeGreaterThan(0);

  // A second import does not ask again.
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN.replace('Rival', 'Outro'));
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls)).toBe(1);
});

test('the dashboard reminds about a backup, and exporting one clears the reminder', async ({ page }) => {
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  // The game was imported 20 days ago, and no backup was ever made.
  const [game] = await readTable<Record<string, unknown>>(page, 'games');
  await putRows(page, 'games', [{ ...game, importedAt: Date.now() - 20 * DAY }]);

  await page.goto('/#/');
  await expect(page.getByTestId('backup-reminder')).toContainText('Você ainda não exportou um backup');
  await expect(page.getByTestId('backup-reminder')).toContainText('há 20 dias');

  await page.getByTestId('backup-reminder').getByRole('link', { name: 'Exportar backup em Configurações' }).click();
  await expect(page.getByTestId('last-backup')).toHaveText('Última exportação de backup: nenhuma neste navegador');
  const download = page.waitForEvent('download');
  await page.getByTestId('export-backup').click();
  expect((await download).suggestedFilename()).toMatch(/^chessquest-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByTestId('last-backup')).toHaveText(`Última exportação de backup: ${new Date().toLocaleDateString('pt-BR')}`);

  await page.goto('/#/');
  await expect(page.getByTestId('next-training')).toBeVisible();
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
});

test('an export that the browser cannot start records no date and says so', async ({ page }) => {
  // The browser refuses to create the file's address: the download is never requested.
  await page.addInitScript(() => {
    URL.createObjectURL = () => {
      throw new Error('bloqueado');
    };
  });
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await page.goto('/#/settings');
  await page.getByTestId('export-backup').click();
  await expect(page.getByText('Não foi possível exportar o backup. A data da última exportação não foi alterada.')).toBeVisible();
  await expect(page.getByTestId('last-backup')).toHaveText('Última exportação de backup: nenhuma neste navegador');
  expect((await readTable<{ lastBackupAt?: number }>(page, 'settings'))[0]?.lastBackupAt).toBeUndefined();
});
