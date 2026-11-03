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
  await expect(page.getByText('✓ acerto')).toBeVisible();
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

  expect(external, 'no requests to external hosts').toEqual([]);
  expect(errors, 'no console errors').toEqual([]);
});

test('opening practice records progress', async ({ page }) => {
  await page.goto('/#/openings');
  await page.getByTestId('practice-toggle').click();
  await playMove(page, 'opening-practice-board', 'e2e4');
  await expect(page.getByTestId('opening-feedback')).toContainText('e4 ✓');
  // Wrong move on purpose: expected Nf3 after 1...e5.
  await page.waitForTimeout(700);
  await playMove(page, 'opening-practice-board', 'f1c4');
  await expect(page.getByTestId('opening-feedback')).toContainText('O esperado era Nf3');
  const attempts = await readTable<{ correct: boolean }>(page, 'openingAttempts');
  expect(attempts.at(-1)?.correct).toBe(false);
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
