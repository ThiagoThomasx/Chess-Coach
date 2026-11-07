import { expect, test, type Page } from '@playwright/test';
import { BLUNDER_PGN, readTable } from './helpers';

// Sprint 4.3: the game → exercise → profile loop never fails silently.

async function put(page: Page, store: string, rows: unknown[]): Promise<void> {
  await page.evaluate(
    async ({ store, rows }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('chessquest');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        for (const r of rows) tx.objectStore(store).put(r);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { store, rows },
  );
}

test('setting the color after the analysis creates the exercises without re-analysing', async ({ page }) => {
  // No player names configured: the imported game has no color.
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);

  await page.getByTestId('game-row').click();
  await page.getByTestId('run-quick').click();
  await expect(page.getByTestId('analysis-status')).toHaveText('Análise concluída', { timeout: 120_000 });
  // The toast no longer claims exercises were updated: it asks for the color.
  await expect(page.getByText('Análise concluída. Defina sua cor na lista de partidas para gerar exercícios')).toBeVisible();
  expect(await readTable(page, 'exercises')).toHaveLength(0);

  await page.goto('/#/games');
  await page.getByLabel('Cor usada por você').selectOption('w');
  await expect(page.getByText(/Cor salva\. Perfil atualizado/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await readTable<{ sideToMove: string }>(page, 'exercises')).length, { timeout: 60_000 }).toBeGreaterThan(0);
  const exercises = await readTable<{ sideToMove: string }>(page, 'exercises');
  expect(exercises.every((e) => e.sideToMove === 'w')).toBe(true);
  const events = await readTable<{ source: string }>(page, 'skillEvents');
  expect(events.some((e) => e.source === 'game')).toBe(true);
});

test('a screen that cannot render shows a recoverable message instead of a blank page', async ({ page }) => {
  await page.goto('/#/train');
  await expect(page.getByText(/Treinar/).first()).toBeVisible();
  // Invalid stored data (a position that is not a FEN) makes the solver throw while rendering.
  await put(page, 'exercises', [
    {
      id: 'broken',
      fen: 'not-a-fen',
      source: 'game',
      sideToMove: 'w',
      objective: 'x',
      theme: 'positional',
      skill: 'strategy',
      bestMove: { uci: 'e2e4', san: 'e4', score: { kind: 'cp', value: 0 } },
      acceptableMoves: [],
      solutionLine: [],
      referenceLines: [],
      difficulty: 1,
      ambiguous: false,
      tolerance: 5,
      createdAt: Date.now(),
      srs: { box: 0, dueAt: Date.now() },
      analysisDepth: 16,
    },
  ]);
  await page.goto('/#/train/broken');
  await expect(page.getByTestId('route-error')).toBeVisible();
  await expect(page.getByText('Não foi possível exibir esta tela')).toBeVisible();
  // Navigation stays usable and leaving the screen recovers.
  await page.getByRole('link', { name: 'Voltar ao dashboard' }).click();
  await expect(page.getByTestId('route-error')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
});
