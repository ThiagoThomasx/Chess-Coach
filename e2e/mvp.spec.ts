import { expect, test } from '@playwright/test';
import { BLUNDER_PGN, playMove, readTable } from './helpers';

// The MVP definition of done (section 22), end to end, against the production
// build with the real Stockfish WASM engine running in a Web Worker.
test('import → analyze → explain → exercise → solve → reload → profile', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url());
  });

  // 1. Open the app: useful empty state, no fake stats.
  await page.goto('/');
  await expect(page.getByText('Comece importando uma partida')).toBeVisible();

  // Player name so the user's color is detected on import.
  await page.goto('/#/settings');
  await page.getByTestId('player-names').fill('Aluno');
  await page.getByTestId('player-names').blur();

  // 2. Import a PGN.
  await page.goto('/#/games');
  await page.getByTestId('pgn-input').setInputFiles({ name: 'aluno.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(BLUNDER_PGN) });
  await expect(page.getByTestId('import-result')).toContainText('1 importada(s)');
  await expect(page.getByTestId('game-row')).toHaveCount(1);

  // Importing again is detected as a duplicate.
  await page.getByTestId('pgn-input').setInputFiles({ name: 'again.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(BLUNDER_PGN) });
  await expect(page.getByTestId('import-result')).toContainText('1 duplicada(s)');
  await expect(page.getByTestId('game-row')).toHaveCount(1);

  // 3. Navigate through the moves.
  await page.getByTestId('game-row').click();
  const fen = page.getByTestId('fen');
  await expect(fen).toContainText('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
  await page.getByTestId('next').click();
  await expect(fen).toContainText('4P3');
  await page.getByTestId('last').click();
  await expect(fen).toContainText('3pP3'); // ...exd4

  // 4–5. Local Stockfish analysis with evaluations and alternatives.
  await page.getByTestId('run-quick').click();
  await expect(page.getByTestId('analysis-status')).toHaveText('Análise concluída', { timeout: 120_000 });

  // 6–7. The blunder 3.Nd4 is identified and explained from verified facts.
  await page.getByTestId('move-5').click();
  const explanation = page.getByTestId('explanation');
  await expect(explanation).toContainText(/Erro grave|Erro/);
  await expect(explanation).toContainText('Peça desprotegida');
  await expect(explanation).toContainText('exd4');
  // Sprint 3: the kind of error is named, and the better alternative's continuation is shown.
  await expect(page.getByTestId('error-kind')).toHaveText('Erro tático');
  await expect(explanation).toContainText('O que acontece depois da alternativa');
  await expect(page.locator('.engine-line').first()).toBeVisible();

  // 8. The position becomes an exercise (auto-generated, or via the button).
  await page.getByTestId('create-exercise').click();
  await page.getByTestId('open-created-exercise').click();
  await expect(page.locator('#exercise-board-square-e1')).toBeVisible();

  // 9–11. Solve it on the board with the stored best move; feedback + persisted result.
  const [exercise] = await readTable<{ bestMove: { uci: string }; id: string }>(page, 'exercises');
  expect(exercise).toBeDefined();
  await playMove(page, 'exercise-board', exercise!.bestMove.uci);
  await expect(page.getByTestId('exercise-feedback')).toContainText('correto');
  await expect(page.getByTestId('next-review')).toContainText('Próxima revisão');

  // 12–13. Close/reopen: game, analysis and exercise history are still there.
  await page.reload();
  await expect(page.getByTestId('last-attempt')).toContainText('✓ acerto');
  await page.goto('/#/games');
  await expect(page.getByTestId('game-row')).toContainText('Analisada');
  await page.getByTestId('game-row').click();
  await expect(page.getByTestId('analysis-status')).toHaveText('Análise concluída');

  // 14. The result shows up in the skill profile.
  await page.goto('/#/progress');
  await expect(page.getByTestId('skill-threats')).toContainText(/evidência/);
  await expect(page.getByTestId('skill-threats')).not.toContainText('Sem dados');
  // One game is too little evidence for a point estimate: only the interval is shown (audit B4).
  await expect(page.getByTestId('skill-threats')).toContainText(/entre \d+% e \d+%/);
  await expect(page.getByTestId('skill-threats').locator('.pt')).toHaveCount(0);

  // The dashboard groups competences by state and counts analyzed games (Sprint 3).
  await page.goto('/#/');
  await expect(page.getByTestId('stat-analyzed')).toHaveText('1');
  await expect(page.getByTestId('skill-states')).toBeVisible();
  await expect(page.getByTestId('skill-state-insufficient')).toContainText('Identificação de ameaças');

  expect(external, 'no requests to external hosts').toEqual([]);
  expect(errors, 'no console errors').toEqual([]);
});

test('opening practice records progress', async ({ page }) => {
  await page.goto('/#/openings');
  await page.getByTestId('practice-toggle').click();
  await playMove(page, 'opening-practice-board', 'e2e4');
  await expect(page.getByTestId('opening-feedback')).toContainText('e4 ✓');
  // Losing move on purpose (2.Ba6?? bxa6): the engine confirms it, so it counts as an error.
  await page.waitForTimeout(700);
  await playMove(page, 'opening-practice-board', 'f1a6');
  await expect(page.getByTestId('opening-feedback')).toContainText('O esperado era Nf3', { timeout: 30_000 });
  const attempts = await readTable<{ correct: boolean }>(page, 'openingAttempts');
  expect(attempts.at(-1)?.correct).toBe(false);
});

test('opening practice accepts a transposition (audit M3)', async ({ page }) => {
  await page.goto('/#/openings');
  await page.getByTestId('practice-toggle').click();
  await playMove(page, 'opening-practice-board', 'e2e4');
  await page.waitForTimeout(700);
  // 2.Bc4 Nc6 3.Nf3 reaches the line position after 3.Bc4.
  await playMove(page, 'opening-practice-board', 'f1c4');
  await expect(page.getByTestId('opening-feedback')).toContainText('transposição');
  await expect(page.locator('#opening-practice-board-square-c6 [data-piece]')).toBeVisible();
  await playMove(page, 'opening-practice-board', 'g1f3');
  await expect(page.getByTestId('opening-feedback')).toContainText('Nf3 ✓');
  const attempts = await readTable<{ correct: boolean }>(page, 'openingAttempts');
  expect(attempts.filter((a) => !a.correct)).toHaveLength(0);
});

test('a playable move outside the line ends the drill without an error (audit M3)', async ({ page }) => {
  await page.goto('/#/openings');
  await page.getByTestId('practice-toggle').click();
  await playMove(page, 'opening-practice-board', 'e2e4');
  await page.waitForTimeout(700);
  await playMove(page, 'opening-practice-board', 'b1c3');
  await expect(page.getByTestId('opening-feedback')).toContainText('fora do repertório, mas é jogável', { timeout: 30_000 });
  const attempts = await readTable<{ correct: boolean }>(page, 'openingAttempts');
  expect(attempts.filter((a) => !a.correct)).toHaveLength(0);
});

test('backup export produces a valid file', async ({ page }) => {
  await page.goto('/#/settings');
  const download = page.waitForEvent('download');
  await page.getByTestId('export-backup').click();
  const file = await download;
  const path = await file.path();
  const { readFile } = await import('node:fs/promises');
  const json = JSON.parse(await readFile(path, 'utf8')) as { format: string; tables: Record<string, unknown[]> };
  expect(json.format).toBe('chessquest-backup');
  expect(Object.keys(json.tables)).toContain('games');
});

test('invalid backup is refused without touching data', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('restore-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"x"}') });
  await expect(page.getByText(/Backup recusado/)).toBeVisible();
});

// Sprint 3.1: a storage failure while creating an exercise is reported and the button recovers.
test('a failed exercise write shows an error and does not leave the button stuck', async ({ page }) => {
  await page.goto('/#/games');
  await page.getByTestId('pgn-input').setInputFiles({ name: 'a.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(BLUNDER_PGN) });
  await page.getByTestId('game-link').click();
  await page.getByTestId('run-quick').click();
  await expect(page.getByTestId('analysis-status')).toHaveText('Análise concluída', { timeout: 120_000 });
  await page.getByTestId('move-5').click();
  // Every IndexedDB cursor now fails, as with a quota or I/O error inside the transaction.
  await page.evaluate(() => {
    IDBObjectStore.prototype.openCursor = () => {
      throw new DOMException('simulated storage failure', 'UnknownError');
    };
  });
  const create = page.getByTestId('create-exercise');
  await create.click();
  await expect(page.locator('.toasts')).toContainText('Não foi possível salvar o exercício');
  await expect(create).toBeEnabled();
  await expect(create).toContainText('Criar exercício desta posição');
});
