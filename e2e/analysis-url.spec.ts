import { expect, test } from '@playwright/test';
import { putRows, readTable, seedAnalysedGame } from './helpers';

// Sprint 4.8: the selected move lives in the analysis URL (replacing the history entry).

test('back from the exercise reopens the analysis on the move that led to it', async ({ page }) => {
  const { gameId, exerciseId } = await seedAnalysedGame(page);
  await page.goto(`/#/analysis/${gameId}`);
  await page.getByTestId('move-5').click();
  await expect(page).toHaveURL(new RegExp(`#/analysis/${gameId}[?]ply=5$`));
  await page.getByTestId('open-exercise').click();
  await expect(page).toHaveURL(new RegExp(`#/train/${exerciseId}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#/analysis/${gameId}[?]ply=5$`));
  await expect(page.getByTestId('move-5')).toHaveAttribute('aria-current', 'true');
});

test('stepping through the game does not fill the browser history', async ({ page }) => {
  const { gameId } = await seedAnalysedGame(page);
  await page.goto(`/#/analysis/${gameId}`);
  await expect(page.getByTestId('move-1')).toBeVisible();
  for (const ply of [1, 2, 3]) {
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(new RegExp(`[?]ply=${ply}$`));
  }
  await page.keyboard.press('Home');
  await expect(page).toHaveURL(new RegExp(`#/analysis/${gameId}$`));
  // One step back leaves the analysis: the moves replaced the entry instead of adding new ones.
  await page.goBack();
  await expect(page).toHaveURL(/#\/games$/);
});

test('the dashboard\'s review link reviews the bookmark once and leaves no "review" in the URL (audit AC-2)', async ({ page }) => {
  const { gameId } = await seedAnalysedGame(page);
  await putRows(page, 'bookmarks', [{ id: 'bm-5', gameId, ply: 5, fen: 'x', note: '', createdAt: Date.now() }]);
  await page.goto(`/#/analysis/${gameId}?ply=5&review=1`);
  await expect(page.getByTestId('move-5')).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(new RegExp(`#/analysis/${gameId}[?]ply=5$`));
  await expect.poll(async () => (await readTable<{ reviewedAt?: number }>(page, 'bookmarks'))[0]?.reviewedAt).toBeGreaterThan(0);
});
