import { expect, test } from '@playwright/test';
import { baseExercise, putRows } from './helpers';

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
