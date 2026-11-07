import { devices, expect, test, type Page } from '@playwright/test';
import { BLUNDER_PGN, playMove, readTable } from './helpers';

// Sprint 4.1: guided daily session. Three mate-in-one exercises are seeded straight into
// IndexedDB (two due reviews, one at the player's level) so the flow does not depend on
// engine timing; solving goes through the real solver and the normal attempt recording.

const MATE = { kind: 'mate', value: 1 } as const;

function mateInOne(id: string, fen: string, uci: string, san: string, dueAt: number, lastReviewedAt?: number) {
  const move = { uci, san, score: MATE };
  return {
    id,
    fen,
    source: 'game',
    sideToMove: 'w',
    objective: 'Encontre o mate em 1.',
    theme: 'missed_mate',
    skill: 'patterns',
    bestMove: move,
    acceptableMoves: [move],
    solutionLine: [uci],
    referenceLines: [],
    difficulty: 1,
    ambiguous: false,
    tolerance: 5,
    createdAt: Date.now(),
    // A due review was attempted before; a never-attempted exercise is new material.
    srs: { box: 0, dueAt, ...(lastReviewedAt ? { lastReviewedAt } : {}) },
    analysisDepth: 16,
    kind: 'mate',
    goal: { kind: 'mate', maxUserMoves: 1, targetWin: 100, mateIn: 1 },
    tree: { fen, accepted: [move], replies: { [uci]: [] }, depth: 99 },
  };
}

async function seed(page: Page): Promise<void> {
  const now = Date.now();
  const exercises = [
    mateInOne('s-a', '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'a1a8', 'Ra8#', now - 2_000, now - 3 * 86_400_000),
    mateInOne('s-b', '7k/6pp/8/8/8/8/6PP/1R5K w - - 0 1', 'b1b8', 'Rb8#', now - 1_000, now - 3 * 86_400_000),
    mateInOne('s-c', '5k2/4ppp1/8/8/8/8/5PPP/Q5K1 w - - 0 1', 'a1a8', 'Qa8#', now + 5 * 86_400_000),
  ];
  // A game makes the recommendation leave the "import" state.
  await page.goto('/#/games');
  await page.getByTestId('pgn-input').setInputFiles({ name: 'a.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(BLUNDER_PGN) });
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  await page.evaluate(async (list) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chessquest');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('exercises', 'readwrite');
      for (const ex of list) tx.objectStore('exercises').put(ex);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, exercises);
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

async function runSession(page: Page, checkLayout = false): Promise<void> {
  await page.goto('/#/train');
  await page.getByTestId('open-session').click();
  await expect(page.getByTestId('session-rec-message')).toContainText('Você tem 2 exercício(s) para revisar hoje.');
  await expect(page.getByTestId('session-plan')).toContainText('2 revisão vencida');
  await expect(page.getByTestId('session-shortfall')).toContainText('Há 3 exercício(s) adequado(s) agora');
  await page.getByTestId('start-session').click();

  // 1. Due review, solved without help.
  await expect(page.getByTestId('session-position')).toHaveText('Exercício 1 de 3');
  if (checkLayout) expect(await hasHorizontalScroll(page)).toBe(false);
  await playMove(page, 'exercise-board', 'a1a8');
  await expect(page.getByTestId('exercise-feedback')).toHaveClass(/callout-good/);
  await page.getByTestId('session-next-exercise').click();

  // 2. Due review, solved after a hint.
  await expect(page.getByTestId('session-position')).toHaveText('Exercício 2 de 3');
  await page.getByTestId('hint').click();
  await playMove(page, 'exercise-board', 'b1b8');
  await expect(page.getByTestId('exercise-feedback')).toHaveClass(/callout-good/);
  await page.getByTestId('session-next-exercise').click();

  // 3. Level exercise: the solution is revealed (counts as an error).
  await expect(page.getByTestId('session-position')).toHaveText('Exercício 3 de 3');
  await page.getByTestId('reveal').click();
  await expect(page.getByTestId('session-next-exercise')).toHaveText(/Ver resumo/);
  await page.getByTestId('session-next-exercise').click();
}

test('guided session: start → solve → summary → updated recommendation', async ({ page }) => {
  await seed(page);
  await runSession(page);

  await expect(page.getByTestId('session-summary')).toBeVisible();
  await expect(page.getByTestId('sum-done')).toHaveText('3');
  await expect(page.getByTestId('sum-independent')).toHaveText('1');
  await expect(page.getByTestId('sum-assisted')).toHaveText('1');
  await expect(page.getByTestId('sum-failed')).toHaveText('1');
  await expect(page.getByTestId('sum-reviews')).toHaveText('2');
  await expect(page.getByTestId('sum-skills')).toHaveText('Reconhecimento de padrões');
  // Before: 2 due reviews. After: the reviews were rescheduled (the revealed one returns in
  // 10 min), so the recommendation moves to the theme just practised, with the session's numbers.
  await expect(page.getByTestId('session-next-message')).toContainText('você resolveu 1 de 3 sem ajuda, 1 com dicas');

  // Exactly one stored attempt per exercise: navigation added nothing.
  const attempts = await readTable<{ exerciseId: string }>(page, 'attempts');
  expect(attempts.map((a) => a.exerciseId).sort()).toEqual(['s-a', 's-b', 's-c']);

  await page.getByTestId('finish-session').click();
  await expect(page.getByTestId('next-training')).toContainText('você resolveu 1 de 3 sem ajuda, 1 com dicas');
});

test('guided session: interrupting keeps results and resumes at the next exercise', async ({ page }) => {
  await seed(page);
  await page.goto('/#/train/session');
  await page.getByTestId('start-session').click();
  await playMove(page, 'exercise-board', 'a1a8');
  await expect(page.getByTestId('exercise-feedback')).toHaveClass(/callout-good/);
  await page.getByTestId('pause-session').click();
  await expect(page).toHaveURL(/#\/train$/);

  // Reload: the plan survives in local storage and the solved exercise does not come back.
  await page.reload();
  await page.goto('/#/train/session');
  await expect(page.getByTestId('session-position')).toHaveText('Exercício 2 de 3');
  await page.getByTestId('session-skip').click();
  await expect(page.getByTestId('session-position')).toHaveText('Exercício 3 de 3');
  await page.getByTestId('end-session').click();
  await expect(page.getByTestId('sum-done')).toHaveText('1');
  const attempts = await readTable<{ exerciseId: string }>(page, 'attempts');
  expect(attempts).toHaveLength(1);
});

test('an ended session is not resumed as active; "continuar" after ending keeps it (audit 4.1.1)', async ({ page }) => {
  await seed(page);
  await page.goto('/#/train/session');
  await page.getByTestId('start-session').click();
  await playMove(page, 'exercise-board', 'a1a8');
  await expect(page.getByTestId('exercise-feedback')).toHaveClass(/callout-good/);

  // Reload after answering, before advancing: the answered exercise does not come back.
  await page.reload();
  await expect(page.getByTestId('session-position')).toHaveText('Exercício 2 de 3');

  // "Encerrar", then "Continuar": still the same session after a reload.
  await page.getByTestId('end-session').click();
  await page.getByRole('button', { name: 'Continuar exercícios' }).click();
  await page.reload();
  await expect(page.getByTestId('session-position')).toHaveText('Exercício 2 de 3');

  // "Encerrar", then leave through the navigation without "Concluir": coming back starts fresh.
  await page.getByTestId('end-session').click();
  await expect(page.getByTestId('session-summary')).toBeVisible();
  // The summary must not promise a later resume: leaving now ends the session.
  await expect(page.getByTestId('sum-pending')).toContainText('use "Continuar exercícios" antes de sair desta tela');
  await expect(page.getByTestId('sum-pending')).not.toContainText('continuar hoje');
  await page.goto('/#/');
  await expect(page.getByTestId('next-training')).toBeVisible();
  await page.goto('/#/train/session');
  await expect(page.getByTestId('start-session')).toBeVisible();
  await expect(page.getByTestId('session-bar')).toHaveCount(0);
  // The new queue does not repeat the exercise solved independently in the ended session.
  await expect(page.getByTestId('start-session')).toHaveText(/Iniciar sessão \(2\)/);
  expect(await readTable(page, 'attempts')).toHaveLength(1);
});

test('two tabs share the stored session without recording anything twice', async ({ page, context }) => {
  await seed(page);
  await page.goto('/#/train/session');
  await page.getByTestId('start-session').click();
  const other = await context.newPage();
  await other.goto('/#/train/session');
  // The second tab resumes the same plan instead of building another one.
  await expect(other.getByTestId('session-position')).toHaveText('Exercício 1 de 3');

  await playMove(page, 'exercise-board', 'a1a8');
  await expect(page.getByTestId('exercise-feedback')).toHaveClass(/callout-good/);
  // The other tab sees the recorded result (live query) and offers to move on, no second attempt.
  await expect(other.getByTestId('session-next-exercise')).toBeVisible();
  await other.getByTestId('session-next-exercise').click();
  await expect(other.getByTestId('session-position')).toHaveText('Exercício 2 de 3');
  expect(await readTable(page, 'attempts')).toHaveLength(1);
  await other.close();
});

test('guided session with no exercises explains why and links to the list', async ({ page }) => {
  await page.goto('/#/train/session');
  await expect(page.getByText('Não há exercícios para uma sessão agora')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver exercícios' })).toBeVisible();
});

test.describe('phone (360×800, touch)', () => {
  const { userAgent, deviceScaleFactor } = devices['Pixel 7'];
  test.use({ userAgent, deviceScaleFactor, isMobile: true, hasTouch: true, viewport: { width: 360, height: 800 } });

  test('the whole session works without horizontal scroll and with 44 px controls', async ({ page }) => {
    await seed(page);
    await page.goto('/#/train/session');
    await page.getByTestId('start-session').click();
    for (const id of ['pause-session', 'end-session', 'session-skip', 'hint', 'reveal']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44);
    }
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.getByTestId('end-session').click();
    await expect(page.getByTestId('session-summary')).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.getByTestId('finish-session').click();
    await runSession(page, true);
    await expect(page.getByTestId('sum-done')).toHaveText('3');
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxes(page: Page, ids: string[]): Promise<Box[]> {
  const out: Box[] = [];
  for (const id of ids) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b, id).not.toBeNull();
    out.push(b!);
  }
  return out;
}

async function expectNoOverlap(page: Page, ids: string[]): Promise<void> {
  const list = await boxes(page, ids);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlaps(list[i]!, list[j]!), `${ids[i]} × ${ids[j]}`).toBe(false);
}

// Audit 4.1.1: the session at the phone and tablet widths of the acceptance criteria (emulated, not a physical device).
for (const width of [360, 390, 430, 768]) {
  test.describe(`session layout at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: true, isMobile: width < 768 });

    test('controls, progress, feedback, interruption and summary fit without overlap or horizontal scroll', async ({ page }) => {
      await seed(page);
      await page.goto('/#/train/session');
      await page.getByTestId('start-session').click();
      await expect(page.getByTestId('session-position')).toHaveText('Exercício 1 de 3');
      for (const [i, b] of (await boxes(page, ['pause-session', 'end-session', 'session-skip'])).entries()) expect(b.height, `control ${i}`).toBeGreaterThanOrEqual(44);
      await expectNoOverlap(page, ['session-position', 'pause-session', 'end-session']);
      await expect(page.locator('.session-bar .progress')).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);

      await playMove(page, 'exercise-board', 'a1a8');
      await expect(page.getByTestId('exercise-feedback')).toHaveClass(/callout-good/);
      await expectNoOverlap(page, ['exercise-feedback', 'session-next-exercise']);
      expect((await page.getByTestId('session-next-exercise').boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await hasHorizontalScroll(page)).toBe(false);

      await page.getByTestId('pause-session').click();
      // Routes are lazy and navigations are transitions: wait for the Training page to render
      // (as a person would) before coming back, or React keeps the session screen mounted.
      await expect(page.getByTestId('open-session')).toBeVisible();
      await page.goto('/#/train/session');
      await expect(page.getByTestId('session-position')).toHaveText('Exercício 2 de 3');

      await page.getByTestId('end-session').click();
      await expect(page.getByTestId('session-summary')).toBeVisible();
      expect((await page.getByTestId('finish-session').boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  });
}
