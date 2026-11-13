import { expect, test } from '@playwright/test';
import { BLUNDER_FENS as FENS, BLUNDER_PGN, baseExercise, playMove, putRows as put, readTable, seedAnalysedGame } from './helpers';

// Sprint 4.6, B2: analysed game → move with an error → derived exercise → its origin → back to the analysis.

const mate = (value: number) => ({ kind: 'mate', value });

test('a move with a derived exercise shows a text badge that opens that exercise', async ({ page }) => {
  const { gameId, exerciseId } = await seedAnalysedGame(page);
  await page.goto(`/#/analysis/${gameId}`);
  const badge = page.getByRole('link', { name: 'Ex.: abrir o exercício do lance 3. Nd4' });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('Ex.');
  await expect(page.getByTestId('moves-exercise-legend')).toContainText('lance com exercício');
  // Only the move whose position is the exercise's: no badge on the stale ply 3, nor on other moves.
  await expect(page.locator('[data-testid^="move-exercise-"]')).toHaveCount(1);
  await expect(page.getByTestId('move-exercise-3')).toHaveCount(0);
  // Keyboard: the badge is reachable and opens the exercise with Enter.
  await badge.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/train/${exerciseId}$`));
  await expect(page.locator('#exercise-board-square-e1')).toBeVisible();
});

test('the analysis action opens the existing exercise instead of creating another', async ({ page }) => {
  const { gameId, exerciseId } = await seedAnalysedGame(page);
  await page.goto(`/#/analysis/${gameId}?ply=5`);
  await expect(page.getByTestId('create-exercise')).toHaveCount(0);
  const open = page.getByTestId('open-exercise');
  await expect(open).toHaveText('Abrir exercício');
  await open.click();
  await expect(page).toHaveURL(new RegExp(`#/train/${exerciseId}$`));
  expect(await readTable(page, 'exercises')).toHaveLength(2);
});

// Real engine: the exercise tree is computed by Stockfish when the button is pressed.
test('creating an exercise turns the action into "Abrir exercício" and never duplicates it', async ({ page }) => {
  await page.goto('/#/games');
  // No player name: the game has no color, so nothing is derived automatically and the position starts without an exercise.
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await page.getByTestId('game-link').click();
  await page.getByTestId('run-quick').click();
  await expect(page.getByTestId('analysis-status')).toHaveText('Análise concluída', { timeout: 120_000 });
  await page.getByTestId('move-5').click();
  await expect(page.getByTestId('move-exercise-5')).toHaveCount(0);
  await expect(page.getByTestId('open-exercise')).toHaveCount(0);
  const create = page.getByTestId('create-exercise');
  await expect(create).toBeEnabled();
  await create.click();
  const open = page.getByTestId('open-exercise');
  await expect(open).toBeVisible({ timeout: 120_000 });
  await expect(create).toHaveCount(0);
  await expect(page.getByTestId('move-exercise-5')).toBeVisible();
  const stored = await readTable<{ id: string; gameId: string; ply: number }>(page, 'exercises');
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ ply: 5 });
  await open.click();
  await expect(page).toHaveURL(new RegExp(`#/train/${stored[0]!.id}$`));
  // Back on the same move, the action still opens the same exercise; nothing new was stored.
  await page.goBack();
  await expect(page.getByTestId('open-exercise')).toBeVisible();
  await page.getByTestId('open-exercise').click();
  await expect(page).toHaveURL(new RegExp(`#/train/${stored[0]!.id}$`));
  expect(await readTable(page, 'exercises')).toHaveLength(1);
});

test('the origin appears only after revealing, and leads back to the original game and move', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { gameId, exerciseId } = await seedAnalysedGame(page);
  await page.goto(`/#/train/${exerciseId}`);
  await expect(page.locator('#exercise-board-square-e1')).toBeVisible();
  await expect(page.getByTestId('exercise-origin')).toHaveCount(0);
  // The details keep only a plain reference: no shortcut to the game's analysis before the attempt ends.
  await expect(page.getByTestId('details-origin')).toHaveText('Exercício de uma partida sua · meia-jogada 5');
  await expect(page.locator('[data-testid="exercise-details"] a[href*="analysis"]')).toHaveCount(0);

  await page.getByTestId('reveal').click();
  const origin = page.getByTestId('exercise-origin');
  await expect(origin).toBeVisible();
  await expect(origin).toContainText('Aluno × Rival');
  await expect(page.getByTestId('origin-summary')).toHaveText(
    'Na partida, você jogou 3. Nd4 — classificado como erro grave, com perda de 36.4 p.p. de expectativa de vitória. O melhor lance era Nxe5.',
  );
  const back = page.getByRole('link', { name: 'Revisar o lance na partida: 3. Nd4, Aluno × Rival' });
  await back.click();
  await expect(page).toHaveURL(new RegExp(`#/analysis/${gameId}\\?ply=5$`));
  await expect(page.getByTestId('move-5')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('move-strip')).toContainText('3. Nd4');
  await expect(page.getByTestId('fen')).toHaveText(FENS[5]!);
  // Retrying hides the origin again until the new attempt ends.
  await page.goBack();
  await expect(page.getByTestId('exercise-origin')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the origin also appears after solving the exercise', async ({ page }) => {
  const { exerciseId } = await seedAnalysedGame(page);
  await page.goto(`/#/train/${exerciseId}`);
  await playMove(page, 'exercise-board', 'f3e5');
  await expect(page.getByTestId('exercise-feedback')).toContainText('correto');
  await expect(page.getByTestId('exercise-origin')).toBeVisible();
  await page.getByTestId('retry').click();
  await expect(page.getByTestId('exercise-origin')).toHaveCount(0);
});

// Queen mates in one on f8.
const QUEEN = '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1';
const queenBest = { uci: 'f1f8', san: 'Qf8#', score: mate(1) };

test('exercises without a game show no origin and keep the normal flow', async ({ page }) => {
  await page.goto('/#/train');
  await put(page, 'exercises', [
    baseExercise({ id: 'no-game', fen: QUEEN, sideToMove: 'w', theme: 'missed_mate', objective: 'Encontre o mate em 1.', bestMove: queenBest, acceptableMoves: [queenBest], solutionLine: ['f1f8'] }),
    baseExercise({ id: 'opening', source: 'opening', fen: QUEEN, sideToMove: 'w', theme: 'missed_mate', objective: 'Encontre o mate em 1.', bestMove: queenBest, acceptableMoves: [queenBest], solutionLine: ['f1f8'] }),
  ]);

  await page.goto('/#/train/no-game');
  await expect(page.getByTestId('details-origin')).toHaveText('Exercício sem partida de origem');
  await playMove(page, 'exercise-board', 'f1f8');
  await expect(page.getByTestId('exercise-feedback')).toContainText('xeque-mate');
  await expect(page.getByTestId('next-review')).toContainText('Próxima revisão');
  await expect(page.getByTestId('exercise-origin')).toHaveCount(0);
  await expect(page.locator('a[href*="analysis"]')).toHaveCount(0);

  await page.goto('/#/train/opening');
  await expect(page.getByTestId('details-origin')).toHaveText('Exercício de abertura');
  await page.getByTestId('reveal').click();
  await expect(page.getByTestId('reference-solution')).toBeVisible();
  await expect(page.getByTestId('exercise-origin')).toHaveCount(0);
  await expect(page.locator('a[href*="analysis"]')).toHaveCount(0);
});

test('a deleted origin game leaves no broken link', async ({ page }) => {
  const { exerciseId } = await seedAnalysedGame(page);
  // An exercise left without its game (as a partial backup restore could leave it).
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('chessquest');
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('games', 'readwrite');
      tx.objectStore('games').clear();
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.goto(`/#/train/${exerciseId}`);
  await page.getByTestId('reveal').click();
  await expect(page.getByTestId('origin-missing')).toHaveText('A partida de origem não está mais disponível.');
  await expect(page.getByTestId('origin-link')).toHaveCount(0);
});

for (const width of [375, 390, 430, 768, 1280]) {
  test(`badge and origin fit without horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    const { gameId, exerciseId } = await seedAnalysedGame(page);
    await page.goto(`/#/analysis/${gameId}?ply=5`);
    await expect(page.getByTestId('move-exercise-5')).toBeVisible();
    await expect(page.getByTestId('open-exercise')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const box = await page.getByTestId('move-exercise-5').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
    await page.goto(`/#/train/${exerciseId}`);
    await page.getByTestId('reveal').click();
    await expect(page.getByTestId('origin-link')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
