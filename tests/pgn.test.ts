import { describe, expect, it } from 'vitest';
import { parsePgnText, splitPgn, detectUserColor, buildHeaders } from '../src/services/pgn/parsePgn';
import { positionProblem } from '../src/services/chess/position';
import { OPERA_GAME, SHORT_BLUNDER_GAME } from './fixtures';

describe('PGN import', () => {
  it('parses a real game with metadata', () => {
    const r = parsePgnText(OPERA_GAME);
    expect(r.failures).toHaveLength(0);
    const g = r.games[0];
    expect(g?.moves).toHaveLength(33);
    expect(g?.moves.at(-1)).toBe('Rd8#');
    expect(g?.headers.white).toBe('Paul Morphy');
    expect(g?.headers.eco).toBe('C41');
    expect(g?.headers.result).toBe('1-0');
  });

  it('splits files with several games', () => {
    const text = `${OPERA_GAME}\n\n${SHORT_BLUNDER_GAME}\n`;
    expect(splitPgn(text)).toHaveLength(2);
    const r = parsePgnText(text);
    expect(r.games).toHaveLength(2);
    expect(r.totalFound).toBe(2);
  });

  it('reports empty files', () => {
    const r = parsePgnText('   \n');
    expect(r.games).toHaveLength(0);
    expect(r.failures[0]?.reason).toMatch(/vazio/);
  });

  it('keeps valid games when another in the file is broken', () => {
    const broken = '[Event "X"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Ke3 Ke6 3. Qxh8 *';
    const r = parsePgnText(`${broken}\n\n${OPERA_GAME}`);
    expect(r.games).toHaveLength(1);
    expect(r.failures).toHaveLength(1);
  });

  it('accepts games with incomplete metadata and records warnings', () => {
    const r = parsePgnText('1. d4 d5 2. c4 *');
    expect(r.games).toHaveLength(1);
    expect(r.games[0]?.headers.white).toBe('Desconhecido');
    expect(r.games[0]?.warnings.length).toBeGreaterThan(0);
  });

  it('parses comments, NAGs and variations', () => {
    const r = parsePgnText('[White "A"]\n[Black "B"]\n\n1. e4 {bom} e5 $1 (1... c5 2. Nf3) 2. Nf3 *');
    expect(r.failures).toHaveLength(0);
    expect(r.games[0]?.moves).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('produces identical hashes for the same game (duplicate detection)', () => {
    const a = parsePgnText(OPERA_GAME).games[0];
    const b = parsePgnText(OPERA_GAME).games[0];
    expect(a?.hash).toBe(b?.hash);
    expect(a?.id).not.toBe(b?.id);
  });

  it('treats Elo as metadata and detects the user color by name', () => {
    const h = buildHeaders({ White: 'Ana', Black: 'Bia', Result: '1-0', WhiteElo: '1500', BlackElo: '?' });
    expect(h.whiteElo).toBe(1500);
    expect(h.blackElo).toBeUndefined();
    expect(detectUserColor(h, ['bia'])).toBe('b');
    expect(detectUserColor(h, [])).toBeUndefined();
    const r = parsePgnText(SHORT_BLUNDER_GAME, ['Aluno']);
    expect(r.games[0]?.userColor).toBe('w');
  });

  it('supports games starting from a custom FEN', () => {
    const r = parsePgnText('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd7 *');
    expect(r.games[0]?.startFen).toBe('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
  });
});

describe('illegal positions (audit M5)', () => {
  it('names the problem of an impossible position', () => {
    expect(positionProblem('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeNull();
    expect(positionProblem('8/8/8/3k4/8/8/8/K6Q w - - 0 1')).toMatch(/xeque/);
    expect(positionProblem('8/8/8/3k4/8/8/8/7Q w - - 0 1')).toMatch(/rei/);
    expect(positionProblem('P3k3/8/8/8/8/8/8/4K3 w - - 0 1')).toMatch(/peão/);
    expect(positionProblem('not a fen')).not.toBeNull();
  });

  it('refuses a PGN whose FEN tag is an impossible position, with the reason', () => {
    const pgn = ['[White "A"]', '[Black "B"]', '[SetUp "1"]', '[FEN "8/8/8/3k4/8/8/8/K6Q w - - 0 1"]', '', '1. Qh5+ Kd4 *'].join('\n');
    const r = parsePgnText(pgn);
    expect(r.games).toHaveLength(0);
    expect(r.failures[0]?.reason).toMatch(/Posição inicial impossível.*xeque/);
  });
});
