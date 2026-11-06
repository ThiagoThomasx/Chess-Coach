import { devices, expect, test, type Page } from '@playwright/test';
import { BLUNDER_PGN } from './helpers';

// Sprint 3.1: touch targets and Openings layout on phones. Emulation with touch
// (pointer: coarse); it does not replace a physical device (docs/SPRINT3-1-RELATORIO.md).

const MIN_TARGET = 44;

async function sizeOf(page: Page, selector: string): Promise<{ w: number; h: number }[]> {
  await page.locator(selector).first().waitFor({ timeout: 10_000 });
  return page.locator(selector).evaluateAll((els) =>
    els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => {
      const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }),
  );
}

async function expectTargets(page: Page, selector: string, minW = MIN_TARGET): Promise<void> {
  const sizes = await sizeOf(page, selector);
  expect(sizes.length, selector).toBeGreaterThan(0);
  for (const s of sizes) {
    expect(s.h, `${selector} height`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(s.w, `${selector} width`).toBeGreaterThanOrEqual(minW);
  }
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

test.describe('phone (360×800, touch)', () => {
  const { userAgent, deviceScaleFactor } = devices['Pixel 7'];
  test.use({ userAgent, deviceScaleFactor, isMobile: true, hasTouch: true, viewport: { width: 360, height: 800 } });

  test('Openings: the board is the first thing on screen and fits the width', async ({ page }) => {
    await page.goto('/#/openings');
    const board = page.getByTestId('opening-board');
    await expect(board).toBeVisible();
    const box = await board.boundingBox();
    expect(box).not.toBeNull();
    // The whole board is above the fold, without scrolling.
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(800);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    expect(await hasHorizontalScroll(page)).toBe(false);
    // Keyboard and screen-reader order follow the visual order: board before the library list.
    const boardFirst = await page.evaluate(() => {
      const boardEl = document.querySelector('[data-testid="opening-board"]');
      const libraryEl = document.querySelector('[data-testid="opening-item"]');
      return !!boardEl && !!libraryEl && !!(boardEl.compareDocumentPosition(libraryEl) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(boardFirst).toBe(true);
    // Move navigation stays right below the board, reachable without hunting.
    const next = page.getByRole('button', { name: 'Avançar' });
    const nextBox = await next.boundingBox();
    expect((nextBox?.y ?? 9999) + (nextBox?.height ?? 0)).toBeLessThanOrEqual(800 + 120);
  });

  test('Openings: picking an opening from the library brings the board back into view', async ({ page }) => {
    await page.goto('/#/openings');
    const item = page.getByTestId('opening-item').nth(2);
    const name = (await item.locator('span').first().innerText()).trim();
    await item.scrollIntoViewIfNeeded();
    await item.tap();
    await expect(page.getByRole('heading', { level: 2, name })).toBeAttached();
    await expect(page.getByTestId('opening-board')).toBeInViewport({ ratio: 0.6 });
  });

  test('Openings: move navigation, move chips and variation tabs are 44 px touch targets', async ({ page }) => {
    await page.goto('/#/openings');
    await expectTargets(page, '.openings .controls .btn');
    await expectTargets(page, '.openings .line-chip .btn', 0);
    await expectTargets(page, '.openings .tabs [role="tab"]', 0);
    // Stepping through the line by touch works.
    await page.getByRole('button', { name: 'Avançar' }).tap();
    await expect(page.locator('.openings .line-chip [aria-current="true"]')).toHaveCount(1);
  });

  test('main navigation and small links/controls are 44 px touch targets', async ({ page }) => {
    // An imported game leaves the empty state, so the dashboard shows its panels and their header links.
    await page.goto('/#/games');
    await page.getByTestId('pgn-input').setInputFiles({ name: 'a.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(BLUNDER_PGN) });
    await expect(page.getByTestId('game-row')).toHaveCount(1);
    // Analysis: back link and move list rows.
    await page.getByTestId('game-link').tap();
    await expectTargets(page, '.page-head .touch-link', 0);
    await expectTargets(page, '.moves button', 0);
    await page.locator('.moves button').nth(1).tap();
    await expect(page.locator('.moves button').nth(1)).toHaveAttribute('aria-current', 'true');
    await page.goto('/#/');
    await expectTargets(page, '.nav a');
    await expectTargets(page, '.panel-head > a', 0);
    await page.goto('/#/settings');
    await expectTargets(page, 'label.check', 0);
    await expectTargets(page, '.page .btn', 0);
    await expectTargets(page, '.page .select', 0);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});

test.describe('desktop (mouse)', () => {
  test('keeps the compact controls and the three-column Openings layout', async ({ page }) => {
    await page.goto('/#/openings');
    const [btn] = await sizeOf(page, '.openings .controls .btn');
    expect(btn).toEqual({ w: 34, h: 34 });
    const library = await page.getByTestId('opening-item').first().boundingBox();
    const board = await page.getByTestId('opening-board').boundingBox();
    expect(library?.x ?? 0).toBeLessThan(board?.x ?? 0);
  });
});
