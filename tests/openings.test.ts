import { describe, expect, it } from 'vitest';
import { OPENINGS, matchOpening } from '../src/services/openings/library';
import { validateLine, parseMoveText, isUserTurn, startPractice, practiceUserMove, practiceOpponentMove, judgeOffBook } from '../src/services/openings/practice';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import type { Score } from '../src/types/domain';

describe('opening library', () => {
  it('contains only legal lines', () => {
    for (const o of OPENINGS) {
      for (const line of [o.mainLine, ...o.variations]) {
        const v = validateLine(line.moves);
        expect(v.ok, `${o.name} / ${line.name}: ${v.error}`).toBe(true);
      }
      expect(o.goals.length).toBeGreaterThan(0);
    }
  });

  it('has unique ids', () => {
    expect(new Set(OPENINGS.map((o) => o.id)).size).toBe(OPENINGS.length);
  });

  it('identifies the opening of a game by longest prefix', () => {
    const m = matchOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O', 'f6']);
    expect(m?.opening.id).toBe('ruy-lopez');
    expect(m?.lineId).toBe('exchange');
    expect(matchOpening(['a3', 'a6'])).toBeNull();
  });

  it('parses free-text move lists', () => {
    expect(parseMoveText('1. e4 e5 2. Nf3 {ideia} Nc6 *')).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('checks continuation drill moves', () => {
    const line = OPENINGS[0]!.mainLine;
    const start = startPractice(line);
    expect(isUserTurn(start, 'w')).toBe(true);
    expect(isUserTurn(start, 'b')).toBe(false);
    expect(practiceUserMove(line, start, 'e4').verdict).toEqual({ kind: 'correct', done: false });
    let s = practiceOpponentMove(line, practiceUserMove(line, start, 'e4').state);
    expect(practiceUserMove(line, s, 'Ba6').verdict).toEqual({ kind: 'wrong', expected: 'Nf3' });
    for (let i = 2; i < line.moves.length - 2; i += 2) s = practiceOpponentMove(line, practiceUserMove(line, s, line.moves[i]!).state);
    expect(practiceUserMove(line, s, line.moves.at(-2)!).verdict).toMatchObject({ kind: 'correct', done: true });
  });
});

const byId = (id: string) => OPENINGS.find((o) => o.id === id)!;

describe('opening identification (audit M4)', () => {
  const italian = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];
  it('names an opening only once the game reaches its defining move', () => {
    // 3…Nd4 (Blackburne-Shilling) is an Italian Game sideline, never "Giuoco Piano".
    expect(matchOpening([...italian, 'Nd4'])?.opening.name).toBe('Abertura Italiana');
    expect(matchOpening([...italian, 'Nf6'])?.opening.name).toBe('Abertura Italiana');
    expect(matchOpening([...italian, 'Bc5'])?.opening.name).toBe('Abertura Italiana');
    // 3.d4 (Scotch) never reached 3.Bc4 or 3.Bb5.
    expect(matchOpening(['e4', 'e5', 'Nf3', 'Nc6', 'd4'])).toBeNull();
    // Najdorf needs 5…a6; 2…d6 alone is just a Sicilian.
    expect(matchOpening(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'])).toBeNull();
    expect(matchOpening(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'])?.opening.id).toBe('sicilian-najdorf');
  });

  it('the Scandinavian text says the bishop pins, not the queen (B3)', () => {
    const text = byId('scandinavian').tacticalIdeas.join(' ');
    expect(text).not.toMatch(/a dama crava/);
    expect(text).toMatch(/Bb4/);
  });
});

describe('opening practice transpositions (audit M3)', () => {
  it('accepts swapping two own moves when the line is rejoined', () => {
    // Italian: 2.Bc4 Nc6 3.Nf3 reaches the line position after 3.Bc4.
    const line = byId('italian').mainLine;
    let s = startPractice(line);
    s = practiceUserMove(line, s, 'e4').state;
    s = practiceOpponentMove(line, s);
    const swapped = practiceUserMove(line, s, 'Bc4');
    expect(swapped.verdict.kind).toBe('transposed');
    s = practiceOpponentMove(line, swapped.state);
    const back = practiceUserMove(line, s, 'Nf3');
    expect(back.verdict.kind).toBe('correct');
    expect(back.state.fen.split(' ').slice(0, 4)).toEqual(validateLine(line.moves).fens[5]!.split(' ').slice(0, 4));
  });

  it('QGD: Nf3 before e3 is a transposition', () => {
    const line = byId('queens-gambit-declined').mainLine; // … Bg5 Be7 e3 O-O Nf3
    let s = startPractice(line);
    for (let i = 0; i < 8; i += 2) {
      s = practiceUserMove(line, s, line.moves[i]!).state;
      s = practiceOpponentMove(line, s);
    }
    expect(practiceUserMove(line, s, 'Nf3').verdict.kind).toBe('transposed');
  });

  it('a move that rejoins nothing is still a deviation', () => {
    const line = byId('london').mainLine;
    let s = startPractice(line);
    s = practiceOpponentMove(line, practiceUserMove(line, s, 'd4').state);
    expect(practiceUserMove(line, s, 'Nf3').verdict).toEqual({ kind: 'wrong', expected: 'Bf4' });
  });

  const cp = (value: number): Score => ({ kind: 'cp', value });
  const engineWith = (before: number, after: number): EngineLike =>
    ({
      analyze: async ({ fen }: { fen: string }) => {
        const v = fen.includes(' b ') ? after : before;
        return { fen, depth: 12, multiPv: 1, timeMs: 0, complete: true, lines: [{ multipv: 1, depth: 12, score: cp(v), pv: [] }] };
      },
    }) as unknown as EngineLike;

  it('with the engine, an off-book move within tolerance is playable; a losing one is not', async () => {
    const fen = validateLine(['d4', 'd5']).fens[2]!;
    expect((await judgeOffBook(engineWith(30, 20), fen, 'g1f3', 5)).playable).toBe(true);
    expect((await judgeOffBook(engineWith(30, -300), fen, 'g1f3', 5)).playable).toBe(false);
  });
});
