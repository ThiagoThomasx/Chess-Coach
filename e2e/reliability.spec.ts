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

async function clear(page: Page, store: string): Promise<void> {
  await page.evaluate(async (store) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chessquest');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, store);
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
  // Evolução says why the game is left out of the statistics (audit P3-4).
  await page.goto('/#/progress');
  await expect(page.getByText('1 partida(s) analisada(s) sem a sua cor definida não entram aqui.')).toBeVisible();

  await page.goto('/#/games');
  await page.getByLabel('Cor usada por você').selectOption('w');
  await expect(page.getByText(/Cor salva\. Perfil atualizado/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await readTable<{ sideToMove: string }>(page, 'exercises')).length, { timeout: 60_000 }).toBeGreaterThan(0);
  const exercises = await readTable<{ sideToMove: string }>(page, 'exercises');
  expect(exercises.every((e) => e.sideToMove === 'w')).toBe(true);
  const events = await readTable<{ source: string }>(page, 'skillEvents');
  expect(events.some((e) => e.source === 'game')).toBe(true);
  expect((await readTable<{ derivation?: string }>(page, 'analyses'))[0]?.derivation).toBe('done');

  // A tab closed mid-derivation leaves the color saved, the work undone and the mark pending:
  // the next start finishes it (audit P2-1).
  const [analysis] = await readTable<Record<string, unknown>>(page, 'analyses');
  await clear(page, 'exercises');
  await clear(page, 'skillEvents');
  await put(page, 'analyses', [{ ...analysis, derivation: 'pending' }]);
  await page.reload();
  await expect.poll(async () => (await readTable(page, 'exercises')).length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await readTable<{ derivation?: string }>(page, 'analyses'))[0]?.derivation, { timeout: 60_000 }).toBe('done');
  expect((await readTable<{ sideToMove: string }>(page, 'exercises')).every((e) => e.sideToMove === 'w')).toBe(true);
  expect((await readTable<{ source: string }>(page, 'skillEvents')).some((e) => e.source === 'game')).toBe(true);
  // Sprint 4.4 (E1): the evidence is dated when the game was played ([Date "2026.10.01"]), not today.
  expect((await readTable<{ source: string; at: number }>(page, 'skillEvents')).filter((e) => e.source === 'game').every((e) => e.at === Date.UTC(2026, 9, 1))).toBe(true);

  // Evidence stored before Sprint 4.4 (dated by the analysis) is re-dated by the game on the next start.
  const stored = await readTable<{ id: number; source: string }>(page, 'skillEvents');
  await put(page, 'skillEvents', stored.map((e) => (e.source === 'game' ? { ...e, at: Date.UTC(2026, 10, 1) } : e)));
  await page.reload();
  await expect
    .poll(async () => (await readTable<{ source: string; at: number }>(page, 'skillEvents')).filter((e) => e.source === 'game').every((e) => e.at === Date.UTC(2026, 9, 1)), { timeout: 30_000 })
    .toBe(true);

  // Clearing the color says what happens to the profile (audit P3-4).
  await page.goto('/#/games');
  await page.getByLabel('Cor usada por você').selectOption('');
  await expect(page.getByText('Cor removida. Os lances desta partida deixam de contar no seu perfil.')).toBeVisible();
  await expect.poll(async () => (await readTable<{ source: string }>(page, 'skillEvents')).filter((e) => e.source === 'game').length).toBe(0);
});

/** A long game (the "Opera game", 33 plies) so a full-depth analysis is still running while the color is set. */
const LONG_PGN = `[Event "Opera"]
[White "A"]
[Black "B"]
[Result "1-0"]
[Date "1858.11.02"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

test('a color set while the analysis runs says the exercises come when it finishes (audit P3-4)', async ({ page }) => {
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(LONG_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await page.getByTestId('game-row').click();
  await page.getByTestId('run-deep').click();
  await expect(page.getByTestId('stop-analysis')).toBeVisible();
  // Leaving the screen does not stop the analysis; the list shows it running.
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Partidas' }).click();
  await page.getByLabel('Cor usada por você').selectOption('b');
  await expect(page.getByText('Cor salva. Os exercícios serão gerados quando a análise terminar.')).toBeVisible();
  expect((await readTable<{ userColor?: string }>(page, 'games'))[0]?.userColor).toBe('b');
});

const exerciseRow = (id: string, srs: { box: number; dueAt: number; lastReviewedAt?: number }) => ({
  id,
  fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
  source: 'game',
  sideToMove: 'w',
  objective: 'Encontre o mate.',
  theme: 'missed_mate',
  skill: 'patterns',
  bestMove: { uci: 'a1a8', san: 'Ra8#', score: { kind: 'mate', value: 1 } },
  acceptableMoves: [{ uci: 'a1a8', san: 'Ra8#', score: { kind: 'mate', value: 1 } }],
  solutionLine: ['a1a8'],
  referenceLines: [],
  difficulty: 1,
  ambiguous: false,
  tolerance: 5,
  createdAt: Date.now() - 86_400_000,
  srs,
  analysisDepth: 16,
});

test('the sidebar counts due reviews only, like the dashboard (Sprint 4.4, E3)', async ({ page }) => {
  // One imported game, so the dashboard shows its statistics instead of the first-steps screen.
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await page.goto('/#/');
  const past = Date.now() - 3_600_000;
  await put(page, 'exercises', [
    exerciseRow('new-1', { box: 0, dueAt: past }), // never attempted: new material, not a review
    exerciseRow('new-2', { box: 0, dueAt: past }),
    exerciseRow('due', { box: 1, dueAt: past, lastReviewedAt: past - 86_400_000 }),
    exerciseRow('later', { box: 1, dueAt: Date.now() + 86_400_000, lastReviewedAt: past }),
  ]);
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  // Before Sprint 4.4 it said "3 revisões pendentes" (the two new exercises counted as reviews).
  await expect(nav.getByLabel('1 revisões pendentes')).toHaveText('1');
  await expect(page.getByTestId('stat-pending-reviews')).toHaveText('1');
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
