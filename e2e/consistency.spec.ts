import { expect, test, type Page } from '@playwright/test';
import { BLUNDER_PGN, playMove, readTable } from './helpers';

// Sprint 4.5: the profile and the counters stay true when individually correct actions combine.

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

async function importGame(page: Page): Promise<string> {
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  const [game] = await readTable<{ id: string }>(page, 'games');
  return game!.id;
}

const DAY = 86_400_000;
const MATE_IN_ONE = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
const exercise = (id: string, srs: { box: number; dueAt: number; lastReviewedAt?: number }, gameId?: string, fen = MATE_IN_ONE) => ({
  id,
  fen,
  source: 'game',
  ...(gameId ? { gameId } : {}),
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
  createdAt: Date.now() - DAY,
  srs,
  analysisDepth: 16,
});

test('a review that becomes due while the app stays open shows up in the sidebar (Sprint 4.5, C3)', async ({ page }) => {
  await page.clock.install();
  await importGame(page);
  const now = await page.evaluate(() => Date.now());
  await put(page, 'exercises', [exercise('soon', { box: 1, dueAt: now + 2 * 60_000, lastReviewedAt: now - DAY })]);
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await expect(nav.locator('.count')).toHaveCount(0);
  // No database write: only time passes.
  await page.clock.fastForward('03:00');
  await expect(nav.getByLabel('1 revisões pendentes')).toHaveText('1');
});

test('Evolução counts due reviews with the same rule as the dashboard (Sprint 4.5, N3)', async ({ page }) => {
  await importGame(page);
  const past = Date.now() - 3_600_000;
  await put(page, 'exercises', [
    exercise('new-1', { box: 0, dueAt: past }, undefined, '6k1/5ppp/8/8/8/8/5PPP/1R4K1 w - - 0 1'),
    exercise('new-2', { box: 0, dueAt: past }, undefined, '6k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1'),
    exercise('due', { box: 1, dueAt: past, lastReviewedAt: past - DAY }),
  ]);
  // Rows written behind Dexie's back: reload so every screen reads them.
  await page.reload();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  expect(await readTable(page, 'exercises')).toHaveLength(3);
  await page.goto('/#/');
  await expect(page.getByTestId('stat-pending-reviews')).toHaveText('1');
  // Loaded fresh on this screen, so the first value shown is the final one (no transient match).
  await page.goto('/#/progress');
  await page.reload();
  await expect(page.getByTestId('skill-profile')).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'Revisões pendentes' }).locator('.stat-value')).toHaveText('1');
});

test('a new player with only year-old games gets a historical diagnosis, not "needs review" (Sprint 4.5, D-4 B)', async ({ page }) => {
  await importGame(page); // the dashboard shows the competences once a game exists
  const yearAgo = Date.now() - 365 * DAY;
  // 60 game moves on strategy, one year old, about 40% successful (as derived from analysed games).
  const events = Array.from({ length: 60 }, (_, i) => ({ skill: 'strategy', at: yearAgo - i * DAY, outcome: i % 10 < 4 ? 1 : 0, weight: 0.2, independent: true, source: 'game', ref: { gameId: 'old', ply: i + 1 } }));
  await put(page, 'skillEvents', events);
  await page.goto('/#/progress');
  const row = page.getByTestId('skill-strategy');
  await expect(row).toContainText('Sem evidência recente');
  await expect(row).not.toContainText('Precisa revisar');
  await expect(row).not.toContainText(/recente \d|estável|subindo|caindo/);
  await expect(row.getByTestId('skill-history')).toContainText(/Diagnóstico histórico: 4\d% .*60 evidência\(s\) de \d{2}\/\d{4} a \d{2}\/\d{4}/);
  await page.goto('/#/');
  await expect(page.getByTestId('skill-state-no_recent')).toContainText('Estratégia');
  await expect(page.getByTestId('skill-state-review')).not.toContainText('Estratégia');
});

test('deleting a trained game removes the evidence of its exercises from the profile (Sprint 4.5, N1)', async ({ page }) => {
  const gameId = await importGame(page);
  await put(page, 'exercises', [exercise('trained', { box: 0, dueAt: Date.now() }, gameId)]);
  await page.goto('/#/train/trained');
  await playMove(page, 'exercise-board', 'a1a8');
  await expect(page.getByTestId('next-review')).toBeVisible();
  await expect.poll(async () => (await readTable<{ ref: { exerciseId?: string } }>(page, 'skillEvents')).filter((e) => e.ref.exerciseId === 'trained').length).toBeGreaterThan(0);

  await page.goto('/#/games');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Excluir partida' }).click();
  await expect(page.getByTestId('game-row')).toHaveCount(0);

  expect((await readTable<{ ref: { exerciseId?: string } }>(page, 'skillEvents')).filter((e) => e.ref.exerciseId === 'trained')).toHaveLength(0);
  expect(await readTable(page, 'attempts')).toHaveLength(0);
});

test('evidence of exercises deleted before Sprint 4.5 is cleaned on the next start (decision D-5)', async ({ page }) => {
  await page.goto('/#/');
  await put(page, 'skillEvents', [
    { skill: 'tactics', at: Date.now() - DAY, outcome: 0, weight: 1, independent: false, source: 'exercise', ref: { exerciseId: 'deleted-long-ago' } },
    { skill: 'openings', at: Date.now() - DAY, outcome: 1, weight: 0.5, independent: true, source: 'opening', ref: { lineId: 'l' } },
  ]);
  await page.reload();
  await expect.poll(async () => (await readTable<{ source: string }>(page, 'skillEvents')).map((e) => e.source)).toEqual(['opening']);
});
