import { expect, test, type Page } from '@playwright/test';
import { BLUNDER_PGN } from './helpers';

// Sprint 3 audit, phase 7 (M8): keyboard access, accessible names, table width.
const NAV_LABELS = ['Dashboard', 'Partidas', 'Treinar', 'Aberturas', 'Evolução', 'Configurações'];

async function importGame(page: Page): Promise<void> {
  await page.goto('/#/games');
  await page.getByTestId('pgn-input').setInputFiles({ name: 'aluno.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(BLUNDER_PGN) });
  await expect(page.getByTestId('game-row')).toHaveCount(1);
}

test('a game can be opened for analysis with the keyboard only', async ({ page }) => {
  await importGame(page);
  await page.locator('body').focus();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'game-link';
  }
  expect(reached, 'the game link is reachable with Tab').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/analysis\//);
  await expect(page.getByTestId('fen')).toBeVisible();
});

test('navigation links keep their accessible names at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  for (const name of NAV_LABELS) {
    await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  // The labels are visually hidden, not shown as text in the bar.
  const box = await nav.getByText('Configurações').boundingBox();
  expect((box?.width ?? 0) <= 1).toBe(true);
});

for (const width of [1100, 1300]) {
  test(`the games table fits without horizontal scrolling at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await importGame(page);
    const overflow = await page.locator('table.table').evaluate((t) => {
      const wrap = t.parentElement as HTMLElement;
      return wrap.scrollWidth - wrap.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('columnheader', { name: 'Análise' })).toBeInViewport();
  });
}
