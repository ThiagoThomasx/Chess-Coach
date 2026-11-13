import { expect, type Page } from '@playwright/test';
import { Chess } from 'chess.js';

export const BLUNDER_PGN = `[Event "Casual"]
[White "Aluno"]
[Black "Rival"]
[Result "0-1"]
[Date "2026.10.01"]
[TimeControl "600"]

1. e4 e5 2. Nf3 Nc6 3. Nd4 exd4 0-1`;

/** Clicks origin then destination square (click-to-move). */
export async function playMove(page: Page, boardId: string, uci: string): Promise<void> {
  await page.locator(`#${boardId}-square-${uci.slice(0, 2)}`).click();
  await page.locator(`#${boardId}-square-${uci.slice(2, 4)}`).click();
}

/** Reads one record set straight from IndexedDB (to know the stored solution without guessing). */
export async function readTable<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(async (t) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chessquest');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<unknown[]>((resolve) => {
      const q = db.transaction(t).objectStore(t).getAll();
      q.onsuccess = () => resolve(q.result);
    });
    db.close();
    return rows;
  }, table) as Promise<T[]>;
}

// ---- Shared seed for the B2 / audit specs (Sprint 4.6) ----

const cp = (value: number) => ({ kind: 'cp', value });

export async function putRows(page: Page, store: string, rows: unknown[]): Promise<void> {
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

export function baseExercise(over: Record<string, unknown>) {
  return {
    source: 'game',
    theme: 'hanging_piece',
    skill: 'tactics',
    objective: 'Encontre o melhor lance nesta posição.',
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

const replay = new Chess();
export const BLUNDER_FENS = [replay.fen()];
for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Nd4', 'exd4']) BLUNDER_FENS.push((replay.move(san), replay.fen()));

/** Imports the blunder game by paste, stores a complete analysis for it and the exercise derived from 3.Nd4 (ply 5). */
export async function seedAnalysedGame(page: Page): Promise<{ gameId: string; exerciseId: string }> {
  await page.goto('/#/games');
  await page.getByTestId('pgn-paste').fill(BLUNDER_PGN);
  await page.getByTestId('pgn-paste-submit').click();
  await expect(page.getByTestId('game-row')).toHaveCount(1);
  const [game] = await readTable<{ id: string }>(page, 'games');
  const gameId = game!.id;
  // The player plays White in this game (as a player name would have set on import).
  await putRows(page, 'games', [{ ...game, userColor: 'w' }]);
  const review = (ply: number, uci: string, san: string, classification: string, color: 'w' | 'b', winLoss = 0) => ({
    ply, san, uci, color, fenBefore: BLUNDER_FENS[ply - 1], fenAfter: BLUNDER_FENS[ply], evalBefore: cp(30), evalAfter: cp(30), bestLine: [], winBefore: 50, winAfter: 50 - winLoss, winLoss, classification, flags: [], depth: 16,
  });
  await putRows(page, 'analyses', [
    {
      gameId,
      status: 'complete',
      settings: { depth: 16, multiPv: 3 },
      positions: [],
      reviews: [
        review(3, 'g1f3', 'Nf3', 'best', 'w'),
        review(4, 'b8c6', 'Nc6', 'best', 'b'),
        { ...review(5, 'f3d4', 'Nd4', 'blunder', 'w', 36.4), bestMoveUci: 'f3e5', bestMoveSan: 'Nxe5' },
        review(6, 'e5d4', 'exd4', 'best', 'b'),
      ],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);
  const best = { uci: 'f3e5', san: 'Nxe5', score: cp(250) };
  await putRows(page, 'exercises', [
    baseExercise({ id: 'from-nd4', fen: BLUNDER_FENS[4], gameId, ply: 5, sideToMove: 'w', bestMove: best, acceptableMoves: [best], solutionLine: ['f3e5'] }),
    // Same game id but a ply that does not lead to its position: must never be linked.
    baseExercise({ id: 'stale', fen: BLUNDER_FENS[4], gameId, ply: 3, sideToMove: 'w', bestMove: best, acceptableMoves: [best], solutionLine: ['f3e5'] }),
  ]);
  return { gameId, exerciseId: 'from-nd4' };
}
