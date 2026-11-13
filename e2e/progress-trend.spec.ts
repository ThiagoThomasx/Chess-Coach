import { expect, test, type Page } from '@playwright/test';

// Sprint 4.6, B3: "Minhas partidas estão melhorando?" on Evolução, from seeded games and analyses.

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** A white game played on 2026-10-`day` whose analysis has `serious` user errors and 3 opponent blunders. */
function seeded(day: number, serious: number, color: 'w' | null = 'w') {
  const id = `trend-${day}`;
  const review = (ply: number, classification: string) => ({ ply, san: 'e4', uci: 'e2e4', color: ply % 2 === 1 ? 'w' : 'b', fenBefore: START, fenAfter: START, evalBefore: { kind: 'cp', value: 0 }, evalAfter: { kind: 'cp', value: 0 }, bestLine: [], winBefore: 50, winAfter: 50, winLoss: 0, classification, flags: [], depth: 16 });
  const reviews = [...Array.from({ length: serious }, (_, i) => review(2 * i + 1, i % 2 ? 'blunder' : 'mistake')), ...[2, 4, 6].map((p) => review(p, 'blunder'))];
  const game = {
    id,
    hash: id,
    headers: { white: 'Eu', black: 'Rival', result: '*', date: `2026.10.${String(day).padStart(2, '0')}` },
    rawHeaders: {},
    startFen: START,
    moves: [],
    pgn: '',
    ...(color ? { userColor: color } : {}),
    importId: 'imp',
    importedAt: Date.UTC(2026, 10, 1) + (30 - day) * 1000, // imported newest-first: order must come from the game date
    warnings: [],
  };
  const analysis = { gameId: id, status: 'complete', settings: { depth: 16, multiPv: 3 }, positions: [], reviews, startedAt: 1, updatedAt: 1, derivation: 'done' };
  return { game, analysis };
}

async function seed(page: Page, rows: ReturnType<typeof seeded>[]): Promise<void> {
  await page.goto('/#/progress');
  await expect(page.getByRole('heading', { name: 'Evolução', exact: true, level: 1 })).toBeVisible();
  await page.evaluate(async (rows) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chessquest');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['games', 'analyses'], 'readwrite');
      for (const r of rows) {
        tx.objectStore('games').put(r.game);
        tx.objectStore('analyses').put(r.analysis);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, rows);
  await page.reload();
}

test('with fewer than 6 games with the user color, Evolução says there are not enough games', async ({ page }) => {
  await seed(page, [...[1, 2, 3, 4, 5].map((d) => seeded(d, 1)), seeded(6, 5, null)]);
  await expect(page.getByTestId('game-trend-insufficient')).toContainText('Sem partidas suficientes');
  await expect(page.getByTestId('game-trend-insufficient')).toContainText('(há 5)');
  await expect(page.getByText('Análises feitas por dia')).toHaveCount(0);
});

test('recent games with fewer serious errors are shown as an improvement, with both values and the sample', async ({ page }) => {
  // Days 1–10: 3 errors each; days 11–20: 1 error each (opponent blunders never count).
  await seed(page, Array.from({ length: 20 }, (_, i) => seeded(i + 1, i < 10 ? 3 : 1)));
  const trend = page.getByTestId('game-trend');
  await expect(page.getByTestId('game-trend-recent')).toHaveText('1,00');
  await expect(page.getByTestId('game-trend-previous')).toHaveText('3,00');
  await expect(page.getByTestId('game-trend-direction')).toHaveText('Menos erros graves por partida.');
  await expect(page.getByTestId('game-trend-sample')).toContainText('últimas 10 vs. 10 partidas anteriores');
  await expect(trend).toContainText('Últimas 10 partidas');
  await expect(page.getByText('Análises feitas por dia')).toHaveCount(0);
  await expect(page.getByTestId('game-trend-small-sample')).toHaveCount(0);
});

test('a difference below 0.3 errors per game is reported as stable', async ({ page }) => {
  await seed(page, Array.from({ length: 6 }, (_, i) => seeded(i + 1, 2)));
  await expect(page.getByTestId('game-trend-direction')).toHaveText('Estável em relação às partidas anteriores.');
  await expect(page.getByTestId('game-trend-small-sample')).toContainText('um único erro');
});

test('with 3 games per group, a one-error change is shown without the improvement color and flagged as a small sample (review M1)', async ({ page }) => {
  await seed(page, Array.from({ length: 6 }, (_, i) => seeded(i + 1, i === 5 ? 2 : 1)));
  const direction = page.getByTestId('game-trend-direction');
  await expect(direction).toHaveText('Mais erros graves por partida.');
  await expect(direction).not.toHaveClass(/tag-bad|tag-good/);
  await expect(page.getByTestId('game-trend-small-sample')).toContainText('Amostra pequena');
});

for (const width of [375, 390, 430, 768]) {
  test(`the trend panel fits at ${width} px without horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page, Array.from({ length: 12 }, (_, i) => seeded(i + 1, i < 6 ? 2 : 1)));
    const panel = page.getByTestId('game-trend');
    await expect(panel).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits).toBe(true);
    const box = await panel.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
  });
}

test('undated games in the comparison are disclosed and the direction loses its good/bad color (audit AC-5)', async ({ page }) => {
  // 20 games: 18 dated with 3 errors, and 2 undated ones with none, placed as the oldest (in the previous window).
  const rows = Array.from({ length: 18 }, (_, i) => seeded(i + 1, 3));
  const undated = [seeded(28, 0), seeded(29, 0)].map((r) => ({ ...r, game: { ...r.game, headers: { ...r.game.headers, date: '????.??.??' } } }));
  await seed(page, [...rows, ...undated]);
  await expect(page.getByTestId('game-trend-undated')).toHaveText('2 partidas comparadas não têm data no PGN e entram como as mais antigas. Se foram jogadas há pouco, a direção pode estar invertida.');
  await expect(page.getByTestId('game-trend-direction')).toHaveText('Mais erros graves por partida.');
  await expect(page.getByTestId('game-trend-direction')).toHaveClass('tag');
});
