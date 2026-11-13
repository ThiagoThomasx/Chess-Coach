import { expect, test } from '@playwright/test';
import { Chess } from 'chess.js';
import { playMove, readTable } from './helpers';

// Two rooks vs king: 1.Ra7 (or Rb7) mates in two whichever king move Black chooses.
const ROOKS = '6k1/8/8/8/8/8/1R6/R5K1 w - - 0 1';

function after(fen: string, ...uci: string[]): string {
  const c = new Chess(fen);
  for (const u of uci) c.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
  return c.fen();
}

function leaf(fen: string) {
  const c = new Chess(fen);
  const mates = c.moves({ verbose: true }).filter((m) => {
    c.move(m);
    const ok = c.isCheckmate();
    c.undo();
    return ok;
  });
  return { fen, accepted: mates.map((m) => ({ uci: m.from + m.to, san: m.san, score: { kind: 'mate', value: 1 } })), replies: {}, depth: 99 };
}

const branches = (u: string) => ['g8f8', 'g8h8'].map((r) => ({ uci: r, san: r === 'g8f8' ? 'Kf8' : 'Kh8', score: { kind: 'mate', value: 1 }, next: leaf(after(ROOKS, u, r)) }));

const exercise = {
  id: 'seq-e2e',
  fen: ROOKS,
  source: 'game',
  sideToMove: 'w',
  objective: 'Encontre o mate em 2.',
  theme: 'missed_mate',
  skill: 'patterns',
  bestMove: { uci: 'a1a7', san: 'Ra7', score: { kind: 'mate', value: 2 } },
  acceptableMoves: [
    { uci: 'a1a7', san: 'Ra7', score: { kind: 'mate', value: 2 } },
    { uci: 'b2b7', san: 'Rb7', score: { kind: 'mate', value: 2 } },
  ],
  solutionLine: ['a1a7', 'g8f8', 'b2b8'],
  referenceLines: [],
  difficulty: 3,
  ambiguous: true,
  tolerance: 5,
  createdAt: Date.now(),
  srs: { box: 0, dueAt: Date.now() },
  analysisDepth: 16,
  kind: 'mate',
  goal: { kind: 'mate', maxUserMoves: 2, targetWin: 100, mateIn: 2 },
  tree: {
    fen: ROOKS,
    accepted: [
      { uci: 'a1a7', san: 'Ra7', score: { kind: 'mate', value: 2 } },
      { uci: 'b2b7', san: 'Rb7', score: { kind: 'mate', value: 2 } },
    ],
    replies: { a1a7: branches('a1a7'), b2b7: branches('b2b7') },
    depth: 99,
  },
};

async function seed(page: import('@playwright/test').Page, ex: typeof exercise): Promise<void> {
  await page.goto('/#/train');
  await expect(page.getByText(/Treinar/).first()).toBeVisible();
  await page.evaluate(async (ex) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chessquest');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('exercises', 'readwrite');
      tx.objectStore('exercises').put(ex);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, ex);
}

test('a two-move exercise continues after the first correct move and is solved on the board', async ({ page }) => {
  await seed(page, exercise);
  await page.goto('/#/train/seq-e2e');
  // The theme is hidden until the attempt ends (audit M1).
  await expect(page.getByTestId('exercise-title')).toHaveText('Exercício');
  await expect(page.getByTestId('sequence-progress')).toContainText('Mate · lance 1 de 2');
  await playMove(page, 'exercise-board', 'a1a7');
  await expect(page.getByTestId('exercise-feedback')).toContainText(/O adversário responde (Kf8|Kh8)/);
  await expect(page.getByTestId('sequence-progress')).toContainText('lance 2 de 2');
  await expect(page.getByTestId('next-review')).toHaveCount(0); // not finished after the first move
  await playMove(page, 'exercise-board', 'b2b8');
  await expect(page.getByTestId('exercise-feedback')).toContainText('xeque-mate');
  await expect(page.getByTestId('next-review')).toContainText('Próxima revisão');
  await expect(page.getByTestId('last-attempt')).toContainText('✓ acerto');
  await expect(page.getByTestId('exercise-title')).toHaveText('Mate disponível');
});

test('hint 1 is informative and solving again right after the answer is only practice (audit A1/A5)', async ({ page }) => {
  await seed(page, { ...exercise, id: 'seq-retry' });
  await page.goto('/#/train/seq-retry');
  await page.getByTestId('hint').click();
  const firstHint = await page.getByTestId('exercise-feedback').textContent();
  expect(firstHint).not.toContain('Encontre o mate em 2');
  expect(firstHint).toMatch(/xeque/);
  await page.getByTestId('hint').click();
  // The last hint names the move, and the button warns about it before (Sprint 4.4, E2).
  await expect(page.getByTestId('hint')).toHaveText(/Mostrar o lance \(conta como revelada\)/);
  await page.getByTestId('hint').click();
  await expect(page.getByTestId('exercise-feedback')).toContainText('O lance é Ra7');
  await expect(page.getByTestId('exercise-feedback')).toContainText('conta como solução revelada');
  // Recorded as soon as the move is shown (audit A2-1), not when it is played.
  await expect.poll(async () => (await readTable<{ exerciseId: string; revealed: boolean }>(page, 'attempts')).filter((a) => a.exerciseId === 'seq-retry' && a.revealed).length).toBe(1);
  await playMove(page, 'exercise-board', 'a1a7');
  await expect(page.getByTestId('sequence-progress')).toContainText('lance 2 de 2');
  await playMove(page, 'exercise-board', 'b2b8');
  await expect(page.getByTestId('next-review')).toBeVisible();
  await expect(page.getByTestId('exercise-feedback')).toContainText('conta como solução revelada');

  await page.getByRole('button', { name: 'Resolver de novo' }).click();
  // Wait for the pieces to animate back to the start position before clicking.
  await expect(page.locator('#exercise-board-square-a1 [data-piece]')).toBeVisible();
  await expect(page.locator('#exercise-board-square-a7 [data-piece]')).toHaveCount(0);
  await playMove(page, 'exercise-board', 'a1a7');
  await expect(page.getByTestId('sequence-progress')).toContainText('lance 2 de 2');
  await playMove(page, 'exercise-board', 'b2b8');
  await expect(page.getByTestId('practice-note')).toBeVisible();
  await expect(page.getByTestId('next-review')).toHaveCount(0);

  const attempts = (await readTable<{ exerciseId: string; hintsUsed: number; correct: boolean; revealed: boolean }>(page, 'attempts')).filter((a) => a.exerciseId === 'seq-retry');
  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.hintsUsed).toBe(3);
  expect(attempts[0]).toMatchObject({ correct: false, revealed: true });
  const events = (await readTable<{ independent: boolean; ref: { exerciseId?: string } }>(page, 'skillEvents')).filter((e) => e.ref.exerciseId === 'seq-retry');
  expect(events.some((e) => e.independent)).toBe(false);
  const stored = (await readTable<{ id: string; srs: { box: number } }>(page, 'exercises')).find((e) => e.id === 'seq-retry');
  expect(stored?.srs.box).toBe(0);
});

test('reloading after the hint that names the move does not turn it into an independent success (audit A2-1)', async ({ page }) => {
  await seed(page, { ...exercise, id: 'seq-reload' });
  await page.goto('/#/train/seq-reload');
  for (let i = 0; i < 3; i++) await page.getByTestId('hint').click();
  await expect(page.getByTestId('exercise-feedback')).toContainText('O lance é Ra7');
  await expect.poll(async () => (await readTable<{ exerciseId: string }>(page, 'attempts')).filter((a) => a.exerciseId === 'seq-reload').length).toBe(1);

  await page.reload();
  await playMove(page, 'exercise-board', 'a1a7');
  await expect(page.getByTestId('sequence-progress')).toContainText('lance 2 de 2');
  await playMove(page, 'exercise-board', 'b2b8');
  // Solved again inside the practice window: nothing new is recorded.
  await expect(page.getByTestId('practice-note')).toBeVisible();

  const attempts = (await readTable<{ exerciseId: string; correct: boolean; revealed: boolean; hintsUsed: number }>(page, 'attempts')).filter((a) => a.exerciseId === 'seq-reload');
  expect(attempts).toEqual([expect.objectContaining({ correct: false, revealed: true, hintsUsed: 3 })]);
  const events = (await readTable<{ independent: boolean; outcome: number; ref: { exerciseId?: string } }>(page, 'skillEvents')).filter((e) => e.ref.exerciseId === 'seq-reload');
  expect(events.every((e) => !e.independent && e.outcome === 0)).toBe(true);
  const stored = (await readTable<{ id: string; srs: { box: number } }>(page, 'exercises')).find((e) => e.id === 'seq-reload');
  expect(stored?.srs.box).toBe(0);
});

test('after the move was named, a later retry on the same screen counts as assisted (audit A2-2)', async ({ page }) => {
  await page.clock.install();
  await seed(page, { ...exercise, id: 'seq-later' });
  await page.goto('/#/train/seq-later');
  for (let i = 0; i < 3; i++) await page.getByTestId('hint').click();
  await expect(page.getByTestId('exercise-feedback')).toContainText('O lance é Ra7');
  await playMove(page, 'exercise-board', 'a1a7');
  await expect(page.getByTestId('sequence-progress')).toContainText('lance 2 de 2');
  await playMove(page, 'exercise-board', 'b2b8');
  await expect(page.getByTestId('next-review')).toBeVisible();

  await page.getByRole('button', { name: 'Resolver de novo' }).click();
  await expect(page.locator('#exercise-board-square-a1 [data-piece]')).toBeVisible();
  await expect(page.locator('#exercise-board-square-a7 [data-piece]')).toHaveCount(0);
  // Past the practice window: the new attempt is recorded, but as assisted, not independent.
  await page.clock.fastForward('11:00');
  await playMove(page, 'exercise-board', 'a1a7');
  await expect(page.getByTestId('sequence-progress')).toContainText('lance 2 de 2');
  await playMove(page, 'exercise-board', 'b2b8');
  await expect(page.getByTestId('next-review')).toBeVisible();

  const attempts = (await readTable<{ exerciseId: string; correct: boolean; revealed: boolean; hintsUsed: number }>(page, 'attempts')).filter((a) => a.exerciseId === 'seq-later');
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toMatchObject({ correct: false, revealed: true });
  expect(attempts[1]).toMatchObject({ correct: true, revealed: false, hintsUsed: 1 });
});

test('a rejected move shows the reply that refutes it; replaying it on the board records nothing (Sprint 4.6, B1)', async ({ page }) => {
  // White rook d2, Black queen d5: Rxd5 wins the queen; Rd4?? hangs the rook to Qxd4.
  const fen = '4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1';
  const best = { uci: 'd2d5', san: 'Rxd5', score: { kind: 'cp', value: 900 } };
  const single = {
    ...exercise,
    id: 'refute-e2e',
    fen,
    objective: 'Encontre o melhor lance.',
    theme: 'hanging_piece',
    skill: 'tactics',
    bestMove: best,
    acceptableMoves: [best],
    solutionLine: ['d2d5'],
    ambiguous: false,
    kind: 'single',
    goal: { kind: 'single', maxUserMoves: 1, targetWin: 99 },
    tree: { fen, accepted: [best], replies: {}, depth: 16 },
  };
  await seed(page, single as unknown as typeof exercise);
  await page.goto('/#/train/refute-e2e');
  // The live region exists before the first feedback, so the first announcement is not lost (audit FA-5).
  await expect(page.getByTestId('exercise-feedback-region')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('exercise-feedback')).toHaveCount(0);

  await playMove(page, 'exercise-board', 'd2d4');
  const feedback = page.getByTestId('exercise-feedback');
  await expect(feedback).toHaveClass(/callout-bad/, { timeout: 30_000 });
  // Stockfish wins the rook at once or after a check: the line shows the capture either way.
  await expect(feedback).toContainText('perde material');
  await expect(feedback).toContainText('O adversário responde');
  await expect(page.getByTestId('refutation-line')).toContainText(/^1… /);
  await expect(page.getByTestId('refutation-line')).toContainText('Qxd4');
  await expect(feedback.locator('> div > p').first()).not.toContainText('p.p.');
  await expect(page.getByTestId('feedback-detail')).toContainText('p.p.');
  await expect(page.getByTestId('next-review')).toContainText('Próxima revisão');
  const attempts = (await readTable(page, 'attempts')).length;

  await page.getByTestId('show-refutation').click();
  // The line plays move by move; it ends on the reply or on a later move of the line.
  await expect(page.getByTestId('legend-last-move')).toContainText('Linha de refutação');
  await expect(page.getByTestId('legend-badge')).toHaveCount(0);
  await expect(page.getByTestId('show-refutation')).toContainText('de novo');
  expect((await readTable(page, 'attempts')).length).toBe(attempts);
});
