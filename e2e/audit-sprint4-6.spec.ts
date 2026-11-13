import { expect, test } from '@playwright/test';
import { putRows, readTable, seedAnalysedGame } from './helpers';

// Sprint 4.6 consolidated audit: reproductions of findings in the real app (docs/SPRINT4-6-AUDITORIA-CONSOLIDADA.md).

type Bookmark = { id: string; ply: number; reviewedAt?: number };

test('AC-2: a bookmark created on a position opened by link is not marked reviewed at once', async ({ page }) => {
  const { gameId } = await seedAnalysedGame(page);
  // Arrive at the move as the exercise origin ("Revisar o lance na partida") or a dashboard pattern link does.
  await page.goto(`/#/analysis/${gameId}?ply=5`);
  await expect(page.getByTestId('move-5')).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'Marcar posição para revisão' }).click();
  await expect(page.getByRole('button', { name: 'Remover marcação de revisão' })).toBeVisible();
  // Give the page time to run its effects, then read the stored bookmark.
  await page.waitForTimeout(500);
  const [mark] = await readTable<Bookmark>(page, 'bookmarks');
  expect(mark?.ply).toBe(5);
  expect(mark?.reviewedAt).toBeUndefined();
  // It stays pending on the dashboard ("Revisões pendentes" counts it, and it is listed).
  await page.goto('/#/');
  await expect(page.getByTestId('stat-pending-reviews')).toHaveText('1'); // this bookmark (new exercises are not reviews)
  await page.getByTestId('dash-more').locator('summary').click();
  await expect(page.locator(`a[href="#/analysis/${gameId}?ply=5&review=1"]`)).toBeVisible();
});

test('AC-2: only the dashboard\'s bookmark link counts as reviewing; other links to the same move do not', async ({ page }) => {
  const { gameId, exerciseId } = await seedAnalysedGame(page);
  await putRows(page, 'bookmarks', [{ id: 'bm-5', gameId, ply: 5, fen: 'x', note: '', createdAt: Date.now() }]);
  // The exercise origin link opens the move without touching the bookmark.
  await page.goto(`/#/train/${exerciseId}`);
  await page.getByTestId('reveal').click();
  await page.getByTestId('origin-link').click();
  await expect(page.getByTestId('move-5')).toHaveAttribute('aria-current', 'true');
  await page.waitForTimeout(500);
  expect((await readTable<Bookmark>(page, 'bookmarks'))[0]?.reviewedAt).toBeUndefined();
  // Opening it from the dashboard's "marked for review" list does review it.
  await page.goto('/#/');
  await page.getByTestId('dash-more').locator('summary').click();
  await page.locator(`a[href="#/analysis/${gameId}?ply=5&review=1"]`).click();
  await expect(page.getByTestId('move-5')).toHaveAttribute('aria-current', 'true');
  await expect.poll(async () => (await readTable<Bookmark>(page, 'bookmarks'))[0]?.reviewedAt).toBeGreaterThan(0);
});
