import type { Page } from '@playwright/test';

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
