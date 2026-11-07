import { expect, test, type Page } from '@playwright/test';
import { Chess } from 'chess.js';
import { BLUNDER_PGN, playMove, readTable } from './helpers';

// Sprint 4.2: PGN paste, move-quality badges, and the exercise screen hierarchy.

const mate = (value: number) => ({ kind: 'mate', value });
const cp = (value: number) => ({ kind: 'cp', value });

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

async function openApp(page: Page): Promise<void> {
  await page.goto('/#/train');
  await expect(page.getByText(/Treinar/).first()).toBeVisible();
}

function baseExercise(over: Record<string, unknown>) {
  return {
    source: 'game',
    theme: 'missed_mate',
    skill: 'patterns',
    acceptableMoves: [],
    solutionLine: [],
    referenceLines: [],
    difficulty: 2,
    ambiguous: false,
    tolerance: 5,
    createdAt: Date.now(),
    srs: { box: 0, dueAt: Date.now() },
    analysisDepth: 16,
    ...over,
  };
}

// Queen mates in one on f8; Qf7 instead stalemates (judged without the engine).
const QUEEN = '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1';
const queenExercise = (id: string) =>
  baseExercise({
    id,
    fen: QUEEN,
    sideToMove: 'w',
    objective: 'Encontre o mate em 1.',
    bestMove: { uci: 'f1f8', san: 'Qf8#', score: mate(1) },
    kind: 'mate',
    goal: { kind: 'mate', maxUserMoves: 1, targetWin: 100, mateIn: 1 },
    tree: { fen: QUEEN, accepted: [{ uci: 'f1f8', san: 'Qf8#', score: mate(1) }], replies: {}, depth: 99 },
  });

test.describe('PGN paste', () => {
  test('pasted text goes through the same import, dedup and report as a file', async ({ page }) => {
    await page.goto('/#/games');
    const submit = page.getByTestId('pgn-paste-submit');
    await expect(submit).toBeDisabled();
    await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
    await submit.click();
    await expect(page.getByTestId('import-result')).toContainText('Texto colado');
    await expect(page.getByTestId('import-result')).toContainText('1 importada(s)');
    await expect(page.getByTestId('game-row')).toHaveCount(1);
    await expect(page.getByTestId('pgn-paste')).toHaveValue('');

    // Same game again: reported as a duplicate, nothing new stored.
    await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
    await submit.click();
    await expect(page.getByTestId('import-result')).toContainText('1 duplicada(s)');
    await expect(page.getByTestId('game-row')).toHaveCount(1);

    // Invalid text: the error is in the report and the text stays for correction.
    await page.getByTestId('pgn-paste').fill('1. e4 e5 2. Ke3 Zz9 *');
    await submit.click();
    await expect(page.getByTestId('import-result')).toContainText('com erro');
    await expect(page.getByTestId('pgn-paste')).toHaveValue('1. e4 e5 2. Ke3 Zz9 *');
  });
});

test.describe('exercise screen hierarchy and badges', () => {
  test('one prompt says whose turn and the goal; secondary info starts collapsed', async ({ page }) => {
    await openApp(page);
    await put(page, 'exercises', [queenExercise('q-prompt')]);
    await page.goto('/#/train/q-prompt');
    await expect(page.getByTestId('task-title')).toHaveText('Sua vez · Brancas jogam');
    await expect(page.getByTestId('task-goal')).toHaveText('Encontre o mate em 1.');
    await expect(page.getByTestId('board-legend')).toContainText('Tabuleiro do lado das Brancas');
    // Origin, history and tolerance notes are behind a summary, not open on the page.
    await expect(page.getByTestId('exercise-details')).not.toHaveAttribute('open', '');
    await expect(page.getByText('Nenhuma tentativa registrada.')).toBeHidden();
    // While playing there is no "solve again" yet: one thing to do at a time.
    await expect(page.getByTestId('retry')).toHaveCount(0);
  });

  test('the correct move gets the best-move badge on its destination square', async ({ page }) => {
    await openApp(page);
    await put(page, 'exercises', [queenExercise('q-best')]);
    await page.goto('/#/train/q-best');
    await playMove(page, 'exercise-board', 'f1f8');
    const badge = page.locator('#exercise-board-square-f8 [data-testid="move-badge"]');
    await expect(badge).toHaveAttribute('data-class', 'best');
    await expect(badge).toHaveAccessibleName('Lance: Melhor lance');
    await expect(page.getByTestId('task-title')).toHaveText('Resolvido');
    await expect(page.getByTestId('legend-badge')).toContainText('Melhor lance');
    await expect(page.getByTestId('retry')).toHaveClass(/btn-primary/);
  });

  test('a losing move gets a severe badge, and the next action is to see the solution', async ({ page }) => {
    await openApp(page);
    await put(page, 'exercises', [queenExercise('q-bad')]);
    await page.goto('/#/train/q-bad');
    await playMove(page, 'exercise-board', 'f1f7'); // stalemate: the forced mate is gone
    await expect(page.getByTestId('task-title')).toHaveText('Não foi dessa vez');
    await expect(page.locator('#exercise-board-square-f7 [data-testid="move-badge"]')).toHaveAttribute('data-class', 'blunder');
    await expect(page.getByTestId('reveal')).toHaveClass(/btn-primary/);
    await expect(page.getByTestId('retry')).not.toHaveClass(/btn-primary/);
  });

  test('a Black exercise shows the board from Black and highlights the opponent move that led to it', async ({ page }) => {
    await page.goto('/#/games');
    await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
    await page.getByTestId('pgn-paste-submit').click();
    await expect(page.getByTestId('game-row')).toHaveCount(1);
    const [game] = await readTable<{ id: string }>(page, 'games');
    // Ply 6 is 3...exd4: the position comes right after White's 3.Nd4.
    const c = new Chess();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Nd4']) c.move(san);
    const fen = c.fen();
    await put(page, 'exercises', [
      baseExercise({
        id: 'black-ex',
        gameId: game!.id,
        ply: 6,
        fen,
        sideToMove: 'b',
        theme: 'hanging_piece',
        skill: 'tactics',
        objective: 'Ganhe material.',
        bestMove: { uci: 'e5d4', san: 'exd4', score: cp(-300) },
        kind: 'single',
        goal: { kind: 'single', maxUserMoves: 1, targetWin: 90 },
        tree: { fen, accepted: [{ uci: 'e5d4', san: 'exd4', score: cp(-300) }], replies: {}, depth: 18 },
      }),
    ]);
    await page.goto('/#/train/black-ex');
    await expect(page.getByTestId('task-title')).toHaveText('Sua vez · Pretas jogam');
    await expect(page.getByTestId('legend-last-move')).toHaveText('Último lance do adversário: Nd4');
    await expect(page.getByTestId('board-legend')).toContainText('Tabuleiro do lado das Pretas');
    // The highlighted squares are the opponent's move (f3 → d4).
    for (const sq of ['f3', 'd4']) {
      const bg = await page.locator(`#exercise-board-square-${sq} > div`).last().evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(bg, sq).toContain('217, 178, 106');
    }
    await playMove(page, 'exercise-board', 'e5d4');
    await expect(page.locator('#exercise-board-square-d4 [data-testid="move-badge"]')).toHaveAttribute('data-class', 'best');
    await expect(page.getByTestId('legend-last-move')).toHaveText('Seu lance: exd4');
  });
});

test('analysis board shows the stored classification of the displayed move', async ({ page }) => {
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  const [game] = await readTable<{ id: string }>(page, 'games');
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Nd4', 'exd4']) fens.push((replay.move(san), replay.fen()));
  const review = (ply: number, uci: string, san: string, classification: string, color: 'w' | 'b') => ({
    ply, san, uci, color, fenBefore: fens[ply - 1], fenAfter: fens[ply], evalBefore: cp(30), evalAfter: cp(30), bestLine: [], winBefore: 50, winAfter: 50, winLoss: 0, classification, flags: [], depth: 16,
  });
  await put(page, 'analyses', [
    {
      gameId: game!.id,
      status: 'complete',
      settings: { depth: 16, multiPv: 3 },
      positions: [],
      reviews: [review(4, 'b8c6', 'Nc6', 'best', 'b'), { ...review(5, 'f3d4', 'Nd4', 'blunder', 'w'), bestMoveUci: 'f3e5', bestMoveSan: 'Nxe5' }, review(6, 'e5d4', 'exd4', 'inconclusive', 'b')],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/#/analysis/${game!.id}?ply=5`);
  const badge = page.locator('#analysis-board-square-d4 [data-testid="move-badge"]');
  await expect(badge).toHaveAttribute('data-class', 'blunder');
  await expect(badge).toHaveText('??');
  // The strip under the board says which move is shown, its class, and what the green arrow means.
  await expect(page.getByTestId('move-strip')).toContainText('3. Nd4');
  await expect(page.getByTestId('move-strip')).toContainText('Erro grave');
  await expect(page.getByTestId('move-strip')).toContainText('melhor era Nxe5');
  await page.getByTestId('prev').click();
  await expect(page.locator('#analysis-board-square-c6 [data-testid="move-badge"]')).toHaveAttribute('data-class', 'best');
  await expect(page.locator('[data-testid="move-badge"]')).toHaveCount(1);
  // Inconclusive moves get no badge: the engine data does not support a verdict.
  await page.getByTestId('last').click();
  await expect(page.locator('[data-testid="move-badge"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('phone (360×800, touch)', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 360, height: 800 } });

  test('exercise: prompt above the board, 44 px actions, no horizontal scroll', async ({ page }) => {
    await openApp(page);
    await put(page, 'exercises', [queenExercise('q-phone')]);
    await page.goto('/#/train/q-phone');
    const prompt = await page.getByTestId('task-prompt').boundingBox();
    const board = await page.getByTestId('exercise-board').boundingBox();
    expect(prompt!.y + prompt!.height).toBeLessThanOrEqual(board!.y);
    for (const id of ['hint', 'reveal']) {
      const b = await page.getByTestId(id).boundingBox();
      expect(b!.height, id).toBeGreaterThanOrEqual(44);
    }
    const summary = await page.locator('.details-panel > summary').boundingBox();
    expect(summary!.height).toBeGreaterThanOrEqual(44);
    await page.locator('#exercise-board-square-f1').tap();
    await page.locator('#exercise-board-square-f8').tap();
    await expect(page.locator('#exercise-board-square-f8 [data-testid="move-badge"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: 'test-results/sprint4-2-exercise-phone.png', fullPage: true });
  });

  test('games: the paste box fits and imports', async ({ page }) => {
    await page.goto('/#/games');
    await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
    const submit = page.getByTestId('pgn-paste-submit');
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await submit.tap();
    await expect(page.getByTestId('import-result')).toContainText('1 importada(s)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});
