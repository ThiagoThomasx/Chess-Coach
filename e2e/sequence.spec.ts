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
  await expect(page.getByTestId('sequence-progress')).toContainText('Mate · lance 1 de 2');
  await playMove(page, 'exercise-board', 'a1a7');
  await expect(page.getByTestId('exercise-feedback')).toContainText(/O adversário responde (Kf8|Kh8)/);
  await expect(page.getByTestId('sequence-progress')).toContainText('lance 2 de 2');
  await expect(page.getByTestId('next-review')).toHaveCount(0); // not finished after the first move
  await playMove(page, 'exercise-board', 'b2b8');
  await expect(page.getByTestId('exercise-feedback')).toContainText('xeque-mate');
  await expect(page.getByTestId('next-review')).toContainText('Próxima revisão');
  await expect(page.getByText('✓ acerto')).toBeVisible();
});

test('hint 1 is informative and solving again right after the answer is only practice (audit A1/A5)', async ({ page }) => {
  await seed(page, { ...exercise, id: 'seq-retry' });
  await page.goto('/#/train/seq-retry');
  await page.getByTestId('hint').click();
  const firstHint = await page.getByTestId('exercise-feedback').textContent();
  expect(firstHint).not.toContain('Encontre o mate em 2');
  expect(firstHint).toMatch(/xeque/);
  await page.getByTestId('hint').click();
  await page.getByTestId('hint').click();
  await expect(page.getByTestId('exercise-feedback')).toContainText('O lance é Ra7');
  await playMove(page, 'exercise-board', 'a1a7');
  await expect(page.getByTestId('sequence-progress')).toContainText('lance 2 de 2');
  await playMove(page, 'exercise-board', 'b2b8');
  await expect(page.getByTestId('next-review')).toBeVisible();

  await page.getByRole('button', { name: 'Resolver de novo' }).click();
  // Wait for the pieces to animate back to the start position before clicking.
  await expect(page.locator('#exercise-board-square-a1 [data-piece]')).toBeVisible();
  await expect(page.locator('#exercise-board-square-a7 [data-piece]')).toHaveCount(0);
  await playMove(page, 'exercise-board', 'a1a7');
  await expect(page.getByTestId('sequence-progress')).toContainText('lance 2 de 2');
  await playMove(page, 'exercise-board', 'b2b8');
  await expect(page.getByTestId('practice-note')).toBeVisible();
  await expect(page.getByTestId('next-review')).toHaveCount(0);

  const attempts = (await readTable<{ exerciseId: string; hintsUsed: number }>(page, 'attempts')).filter((a) => a.exerciseId === 'seq-retry');
  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.hintsUsed).toBe(3);
  const events = (await readTable<{ independent: boolean; ref: { exerciseId?: string } }>(page, 'skillEvents')).filter((e) => e.ref.exerciseId === 'seq-retry');
  expect(events.some((e) => e.independent)).toBe(false);
  const stored = (await readTable<{ id: string; srs: { box: number } }>(page, 'exercises')).find((e) => e.id === 'seq-retry');
  expect(stored?.srs.box).toBe(0);
});
