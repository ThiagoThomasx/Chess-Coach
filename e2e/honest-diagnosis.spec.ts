import { expect, test } from '@playwright/test';
import { BLUNDER_FENS, BLUNDER_PGN, baseExercise, putRows, readTable } from './helpers';

// Sprint 4.7, PD-3: "Treinar este tema" of an opponent's motif opens only the exercises of that side.

const FENS = [
  '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
  '6k1/5ppp/8/8/8/8/5PPP/1R4K1 w - - 0 1',
  '6k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1',
];

function forkExercise(id: string, fen: string, motifSide?: 'own' | 'opponent') {
  const move = { uci: 'g1h1', san: 'Kh1', score: { kind: 'cp', value: 0 } };
  return baseExercise({ id, fen, theme: 'fork', sideToMove: 'w', bestMove: move, acceptableMoves: [move], solutionLine: ['g1h1'], ...(motifSide ? { motifSide } : {}) });
}

test('the side of a two-sided motif filters the training list until a theme is chosen by hand', async ({ page }) => {
  await page.goto('/#/train');
  await expect(page.getByRole('heading', { name: 'Treinar' })).toBeVisible();
  await putRows(page, 'exercises', [forkExercise('allowed', FENS[0]!, 'opponent'), forkExercise('missed', FENS[1]!, 'own'), forkExercise('legacy', FENS[2]!)]);

  await page.goto('/#/train?theme=fork&side=opponent');
  // Rows written behind Dexie's back are only read by a fresh page.
  await page.reload();
  await expect(page.getByTestId('exercise-card')).toHaveCount(1);
  await expect(page.getByTestId('theme-side')).toContainText('do adversário');

  await page.goto('/#/train?theme=fork&side=own');
  await expect(page.getByTestId('exercise-card')).toHaveCount(2);

  // Choosing the theme in the filter drops the side: every fork exercise is listed.
  await page.getByTestId('filter-theme').selectOption('');
  await page.getByTestId('filter-theme').selectOption('fork');
  await expect(page.getByTestId('exercise-card')).toHaveCount(3);
  await expect(page.getByTestId('theme-side')).toHaveCount(0);
  await expect(page).not.toHaveURL(/side=/);
});

// Sprint 4.7, PD-2 (closing review M1): "Criar exercício desta posição" applies the same rule as the
// automatic derivation. The stored analysis says 3.Nd4 went from +12 to +5 (still decisive); the
// solution tree is searched by the real engine, but the conversion goal comes from the stored line.
test('manual creation refuses a conversion from a move that kept the decisive advantage, and accepts one that gave it away', async ({ page }) => {
  test.setTimeout(120_000);
  const cp = (value: number) => ({ kind: 'cp', value });
  const line = (uci: string, value: number) => [{ multipv: 1, depth: 12, score: cp(value), pv: [uci] }];
  const position = (ply: number, uci: string, value: number) => ({ fen: BLUNDER_FENS[ply], depth: 12, multiPv: 3, lines: line(uci, value), complete: true, timeMs: 1 });

  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  const [game] = await readTable<{ id: string }>(page, 'games');
  const gameId = game!.id;
  await putRows(page, 'games', [{ ...game, userColor: 'w' }]);
  // Shallow tree searches keep the test fast; the tree is not deeper than the stored analysis.
  await putRows(page, 'settings', [{ id: 'app', analysisDepth: 12 }]);

  const seed = async (afterNd4: number, winAfter: number, classification: string) =>
    putRows(page, 'analyses', [
      {
        gameId,
        status: 'complete',
        settings: { depth: 12, multiPv: 3 },
        positions: [null, null, null, null, position(4, 'f1c4', 1200), position(5, 'a7a6', afterNd4), null],
        reviews: [
          {
            ply: 5, san: 'Nd4', uci: 'f3d4', color: 'w', fenBefore: BLUNDER_FENS[4], fenAfter: BLUNDER_FENS[5], evalBefore: cp(1200), evalAfter: cp(afterNd4),
            bestLine: ['f1c4'], bestMoveUci: 'f1c4', bestMoveSan: 'Bc4', winBefore: 97.5, winAfter, winLoss: 97.5 - winAfter, classification, flags: [], depth: 12,
          },
        ],
        startedAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

  await seed(500, 86.3, 'mistake');
  await page.goto(`/#/analysis/${gameId}?ply=5`);
  await page.reload();
  await page.getByTestId('create-exercise').click();
  await expect(page.getByText('manteve a vantagem decisiva', { exact: false })).toBeVisible({ timeout: 90_000 });
  expect(await readTable(page, 'exercises')).toHaveLength(0);

  // Control: the same position, but the move gave the decisive advantage away (+12 → +1).
  await seed(100, 59.1, 'blunder');
  await page.reload();
  await page.getByTestId('create-exercise').click();
  // Once stored, the panel links the new exercise ("Abrir exercício", Sprint 4.6 B2).
  await expect.poll(async () => (await readTable(page, 'exercises')).length, { timeout: 90_000 }).toBe(1);
  await expect(page.getByTestId('open-exercise')).toBeVisible();
  const created = await readTable<{ ply: number; goal?: { kind: string } }>(page, 'exercises');
  expect(created).toHaveLength(1);
  expect(created[0]?.goal?.kind).toBe('conversion');
});

