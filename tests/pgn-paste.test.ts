import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChessQuestDB, setDb } from '../src/db/database';
import { importPastedPgn, importPgn, listGames, listImports, PASTE_SOURCE_NAME } from '../src/db/gamesRepo';
import { MAX_PGN_BYTES } from '../src/services/pgn/parsePgn';
import { OPERA_GAME, SHORT_BLUNDER_GAME } from './fixtures';

let n = 0;
beforeEach(() => {
  setDb(new ChessQuestDB(`paste-${++n}`));
});

describe('importPastedPgn', () => {
  it('imports pasted text through the same path as a file, recorded as pasted text', async () => {
    const { record, imported } = await importPastedPgn(`${OPERA_GAME}\n\n${SHORT_BLUNDER_GAME}`, ['Aluno']);
    expect(record.fileName).toBe(PASTE_SOURCE_NAME);
    expect(record.imported).toBe(2);
    expect(imported).toHaveLength(2);
    expect(imported.find((g) => g.headers.white === 'Aluno')?.userColor).toBe('w');
    expect(await listImports()).toHaveLength(1);
  });

  it('deduplicates against games imported from a file', async () => {
    await importPgn(OPERA_GAME, 'a.pgn', []);
    const { record } = await importPastedPgn(OPERA_GAME, []);
    expect(record.imported).toBe(0);
    expect(record.duplicates).toBe(1);
    expect(await listGames()).toHaveLength(1);
  });

  it('accepts movetext without headers', async () => {
    const { record } = await importPastedPgn('1. e4 e5 2. Nf3 Nc6 3. Nd4 exd4 0-1', []);
    expect(record.imported).toBe(1);
  });

  it('reports invalid text in the import report, like a file', async () => {
    const { record } = await importPastedPgn('1. e4 e5 2. Ke3 Ke6 3. Qh5 Zz9 *', []);
    expect(record.imported).toBe(0);
    expect(record.failures.length).toBeGreaterThan(0);
  });

  it('rejects empty or whitespace-only text without touching the database', async () => {
    await expect(importPastedPgn('   \n\t ', [])).rejects.toThrow(/vazio/i);
    expect(await listImports()).toHaveLength(0);
  });

  it('keeps the same size limit as file import', async () => {
    const { record } = await importPastedPgn(`${OPERA_GAME}${' '.repeat(MAX_PGN_BYTES)}`, []);
    expect(record.imported).toBe(0);
    expect(record.failures[0]?.reason).toMatch(/grande demais/);
  });
});
