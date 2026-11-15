import { expect, test } from '@playwright/test';

// Sprint 4.8 pre-closure audit, MEDIUM 1: leaving the analysis screen while the analysis runs and
// coming back used to leave the controls on "Analisando…" after the run ended, until a reload.

/** The "Opera game" (33 plies): a full-depth analysis lasts long enough to leave and come back. */
const LONG_PGN = `[Event "Opera"]
[White "A"]
[Black "B"]
[Result "1-0"]
[Date "1858.11.02"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

test('coming back to a running analysis, the controls follow it to the end', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(LONG_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await page.getByTestId('game-row').click();
  await page.getByTestId('run-deep').click();
  await expect(page.getByTestId('stop-analysis')).toBeVisible();

  // Leave inside the app (the run goes on in this tab) and come back while it still runs.
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Partidas' }).click();
  await page.getByTestId('game-row').click();
  await expect(page.getByTestId('stop-analysis')).toBeVisible();
  await expect(page.getByTestId('analysis-status')).toHaveText('Analisando…');

  // When the run ends, the remounted controls show it, without a reload.
  await expect(page.getByTestId('analysis-status')).toHaveText('Análise concluída', { timeout: 150_000 });
  await expect(page.getByTestId('run-deep')).toBeVisible();
  await expect(page.getByTestId('stop-analysis')).toHaveCount(0);
});
