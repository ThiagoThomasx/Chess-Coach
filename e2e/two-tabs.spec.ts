import { expect, test, type Page } from '@playwright/test';
import { readTable } from './helpers';

// Sprint 4.8, T-1: one analysis per game across tabs. Two pages of one browser context share the
// IndexedDB and the Web Locks of the origin, like two tabs of the same browser.

/** The "Opera game" (33 plies): a full-depth analysis still runs while the second tab opens. */
const LONG_PGN = `[Event "Opera"]
[White "A"]
[Black "B"]
[Result "1-0"]
[Date "1858.11.02"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const PAUSED = 'Análise incompleta — pode ser retomada';
const ELSEWHERE = 'Analisando em outra aba…';

/** Imports the long game and starts its full analysis; resolves to the analysis URL. */
async function startLongAnalysis(page: Page): Promise<string> {
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(LONG_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await page.getByTestId('game-row').click();
  await page.getByTestId('run-deep').click();
  await expect(page.getByTestId('stop-analysis')).toBeVisible();
  // At least one save, so the stored record is "running" when the second tab opens.
  await expect.poll(async () => (await readTable<{ status: string }>(page, 'analyses'))[0]?.status).toBe('running');
  return page.url();
}

/**
 * Samples, every 100 ms for `ms`, the status shown on screen and the stored one, from inside the
 * page: a window of a second or two would not slip between two samples.
 */
async function sampleStatuses(page: Page, ms: number): Promise<{ shown: string[]; stored: string[] }> {
  return page.evaluate(async (duration) => {
    const shown = new Set<string>();
    const stored = new Set<string>();
    const readStored = () =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open('chessquest');
        req.onsuccess = () => {
          const db = req.result;
          const q = db.transaction('analyses').objectStore('analyses').getAll();
          q.onsuccess = () => {
            resolve(String((q.result[0] as { status?: string } | undefined)?.status));
            db.close();
          };
        };
      });
    const end = Date.now() + duration;
    while (Date.now() < end) {
      shown.add(document.querySelector('[data-testid="analysis-status"]')?.textContent ?? '');
      stored.add(await readStored());
      await new Promise((r) => setTimeout(r, 100));
    }
    return { shown: [...shown], stored: [...stored] };
  }, ms);
}

test('T-1: a second tab never takes a live analysis for paused and offers no button for it', async ({ page, context }) => {
  test.setTimeout(90_000);
  const url = await startLongAnalysis(page);

  const other = await context.newPage();
  await other.goto(url);
  // From the load on, through the start-up recovery of this tab.
  const seen = await sampleStatuses(other, 3000);
  expect(seen.stored).not.toContain('paused');
  expect(seen.shown).not.toContain(PAUSED);

  await expect(other.getByTestId('analysis-status')).toHaveText(ELSEWHERE);
  await expect(other.getByTestId('analysis-elsewhere')).toBeVisible();
  // "Interromper" here could not stop the other tab's run, and starting would duplicate it.
  await expect(other.getByTestId('stop-analysis')).toHaveCount(0);
  await expect(other.getByTestId('run-deep')).toHaveCount(0);
  await expect(other.getByTestId('run-quick')).toHaveCount(0);

  // The owner stops: the second tab offers to resume, without reloading.
  await page.getByTestId('stop-analysis').click();
  await expect(page.getByTestId('analysis-status')).toHaveText(PAUSED);
  await expect(other.getByTestId('analysis-status')).toHaveText(PAUSED);
  await expect(other.getByTestId('run-deep')).toBeVisible();
});

test('T-1: when the tab that runs the analysis closes, the other one can resume it without reloading', async ({ page, context }) => {
  test.setTimeout(90_000);
  const url = await startLongAnalysis(page);
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByTestId('analysis-status')).toHaveText(ELSEWHERE);

  // Closing the tab ends its run without a final save: the record is left "running".
  await page.close();
  await expect(other.getByTestId('analysis-status')).toHaveText(PAUSED);
  await expect.poll(async () => (await readTable<{ status: string }>(other, 'analyses'))[0]?.status).toBe('paused');

  // Resuming continues from the stored positions.
  await other.getByTestId('run-deep').click();
  await expect(other.getByTestId('stop-analysis')).toBeVisible();
  await expect(other.getByTestId('analysis-status')).toHaveText('Analisando…');
  await other.getByTestId('stop-analysis').click();
  await expect(other.getByTestId('analysis-status')).toHaveText(PAUSED);
});
