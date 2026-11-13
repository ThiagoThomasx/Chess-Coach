import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { addExercise, deleteExercise, exercisesForGame } from '../src/db/trainingRepo';
import { deleteGame } from '../src/db/gamesRepo';
import { replayGame, START_FEN } from '../src/services/chess/position';
import { analysisHref, exerciseHref, exerciseOrigin, gameRef, isOriginVisible, linkedExercisesByPly, moveLabel } from '../src/services/exercises/origin';
import type { Exercise, Game, MoveReview } from '../src/types/domain';
import { mkExercise } from './support/training';

// Sprint 4.6, B2: the link between a game's analysis and the exercises derived from it.

const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Nd4', 'exd4'];
const PLIES = replayGame(MOVES);
const FENS = [START_FEN, ...PLIES.map((p) => p.fenAfter)];

function mkGame(id: string, over: Partial<Game> = {}): Game {
  return {
    id,
    hash: `h-${id}`,
    headers: { white: 'Aluno', black: 'Rival', result: '0-1', date: '2026.10.01' },
    rawHeaders: {},
    startFen: START_FEN,
    moves: MOVES,
    pgn: '',
    userColor: 'w',
    importId: 'imp',
    importedAt: 1,
    warnings: [],
    ...over,
  };
}

/** The exercise the analysis would derive from move `ply` of the game (the position before that move). */
function derived(id: string, gameId: string, ply: number, over: Partial<Exercise> = {}): Exercise {
  return mkExercise(id, {
    source: 'game',
    gameId,
    ply,
    fen: FENS[ply - 1] ?? START_FEN,
    sideToMove: PLIES[ply - 1]?.color ?? 'w',
    bestMove: { uci: 'f3e5', san: 'Nxe5', score: { kind: 'cp', value: 80 } },
    ...over,
  });
}

function mkReview(ply: number, over: Partial<MoveReview> = {}): MoveReview {
  const p = PLIES[ply - 1]!;
  return {
    ply,
    san: p.san,
    uci: p.uci,
    color: p.color,
    fenBefore: p.fenBefore,
    fenAfter: p.fenAfter,
    evalBefore: { kind: 'cp', value: 30 },
    evalAfter: { kind: 'cp', value: -300 },
    bestMoveUci: 'f3e5',
    bestMoveSan: 'Nxe5',
    bestLine: ['f3e5'],
    winBefore: 54,
    winAfter: 18,
    winLoss: 36,
    classification: 'blunder',
    flags: [],
    depth: 16,
    ...over,
  };
}

describe('origin of a game-derived exercise', () => {
  it('points back to the same game and move, with what the stored analysis said', () => {
    const origin = exerciseOrigin(derived('ex-1', 'g1', 5), mkGame('g1'), mkReview(5));
    expect(origin).toMatchObject({
      gameId: 'g1',
      ply: 5,
      gameTitle: 'Aluno × Rival',
      date: '2026.10.01',
      playedLabel: '3. Nd4',
      mover: 'you',
      classification: 'blunder',
      winLoss: 36,
      bestSan: 'Nxe5',
      href: '/analysis/g1?ply=5',
    });
  });

  it('the return link opens the move whose position before is the exercise position', () => {
    const ex = derived('ex-1', 'g1', 5);
    const origin = exerciseOrigin(ex, mkGame('g1'), undefined)!;
    const ply = Number(new URL(origin.href, 'http://x').searchParams.get('ply'));
    // The analysis page shows the position after `ply` with the review of move `ply`; the exercise is the position before it.
    expect(ply).toBe(5);
    expect(FENS[ply - 1]).toBe(ex.fen);
    expect(PLIES[ply - 1]!.san).toBe('Nd4');
  });

  it('says whose move it was from the game color, and never claims the user played an opponent move', () => {
    expect(exerciseOrigin(derived('a', 'g1', 6), mkGame('g1'), undefined)?.mover).toBe('opponent');
    expect(exerciseOrigin(derived('b', 'g1', 6), mkGame('g1', { userColor: 'b' }), undefined)?.mover).toBe('you');
    expect(exerciseOrigin(derived('c', 'g1', 5), mkGame('g1', { userColor: undefined }), undefined)?.mover).toBe('unknown');
    expect(exerciseOrigin(derived('d', 'g1', 6), mkGame('g1'), undefined)?.playedLabel).toBe('3… exd4');
  });

  it('ignores an analysis review of another position (no invented classification)', () => {
    const otherPosition = mkReview(5, { fenBefore: FENS[0]!, classification: 'mistake' });
    const origin = exerciseOrigin(derived('ex-1', 'g1', 5), mkGame('g1'), otherPosition)!;
    expect(origin.classification).toBeUndefined();
    expect(origin.winLoss).toBeUndefined();
    // The best move still comes from the exercise itself, which the user has just seen solved or revealed.
    expect(origin.bestSan).toBe('Nxe5');
  });

  it('has no origin without a game reference: manual, opening or legacy exercises', () => {
    expect(gameRef(mkExercise('m', { source: 'game' }))).toBeNull(); // no gameId
    expect(gameRef(mkExercise('o', { source: 'opening', gameId: 'g1', ply: 5 }))).toBeNull();
    expect(gameRef(mkExercise('z', { source: 'game', gameId: 'g1', ply: 0 }))).toBeNull();
    expect(exerciseOrigin(mkExercise('m', { source: 'game' }), mkGame('g1'), undefined)).toBeNull();
    expect(exerciseOrigin(mkExercise('o', { source: 'opening' }), mkGame('g1'), undefined)).toBeNull();
  });

  it('has no link when the game is gone or the stored ply no longer leads to the exercise position', () => {
    expect(exerciseOrigin(derived('ex-1', 'g1', 5), undefined, undefined)).toBeNull();
    expect(exerciseOrigin(derived('ex-1', 'g1', 5), mkGame('g2'), undefined)).toBeNull();
    expect(exerciseOrigin(derived('ex-1', 'g1', 5, { ply: 3 }), mkGame('g1'), undefined)).toBeNull();
    expect(exerciseOrigin(derived('ex-1', 'g1', 5, { ply: 40 }), mkGame('g1'), undefined)).toBeNull();
  });

  it('is shown only once the attempt is solved or the solution revealed', () => {
    expect(isOriginVisible('solved')).toBe(true);
    expect(isOriginVisible('revealed')).toBe(true);
    for (const status of ['playing', 'checking', 'failed', 'uncertain']) expect(isOriginVisible(status)).toBe(false);
  });

  it('labels moves of games that start with Black to move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(moveLabel(fen, 1, 'b', 'e5')).toBe('1… e5');
    expect(moveLabel(fen, 2, 'w', 'Nf3')).toBe('2. Nf3');
  });

  it('builds routes with the existing structure, escaping ids', () => {
    expect(exerciseHref('ab-1')).toBe('/train/ab-1');
    expect(analysisHref('a/b', 3)).toBe('/analysis/a%2Fb?ply=3');
  });
});

describe('exercises linked to the moves of a game', () => {
  it('links each exercise of this game to its own move only', () => {
    const map = linkedExercisesByPly([derived('e5', 'g1', 5), derived('e6', 'g1', 6)], 'g1', FENS);
    expect([...map.entries()]).toEqual([
      [5, 'e5'],
      [6, 'e6'],
    ]);
  });

  it('never links exercises of another game, without a game, with a stale ply or out of range', () => {
    const map = linkedExercisesByPly(
      [
        derived('other-game', 'g2', 5),
        mkExercise('manual', { source: 'game', fen: FENS[4]! }),
        mkExercise('opening', { source: 'opening', gameId: 'g1', ply: 5, fen: FENS[4]! }),
        derived('stale', 'g1', 3, { fen: FENS[4]! }), // ply 3 does not start from this position
        derived('beyond', 'g1', 7, { fen: FENS[4]! }),
      ],
      'g1',
      FENS,
    );
    expect(map.size).toBe(0);
  });

  it('matches positions ignoring move counters, as exercise deduplication does', () => {
    const counters = FENS[4]!.replace(/ \d+ \d+$/, ' 9 30');
    expect(linkedExercisesByPly([derived('e5', 'g1', 5, { fen: counters })], 'g1', FENS).get(5)).toBe('e5');
  });
});

describe('exercises stored for a game', () => {
  let n = 0;
  beforeEach(() => {
    setDb(new ChessQuestDB(`origin-${++n}`));
  });

  it('returns only the exercises of that game, through its index', async () => {
    await getDb().exercises.bulkAdd([derived('e5', 'g1', 5), derived('x', 'g2', 6), mkExercise('manual', { fen: FENS[2]! })]);
    expect((await exercisesForGame('g1')).map((e) => e.id)).toEqual(['e5']);
    expect(await exercisesForGame('missing')).toEqual([]);
  });

  it('creating the same position again opens the existing exercise instead of storing a second one', async () => {
    const first = await addExercise(derived('first', 'g1', 5));
    const again = await addExercise(derived('second', 'g1', 5));
    expect(first).toEqual({ added: true, id: 'first' });
    expect(again).toEqual({ added: false, id: 'first' });
    const stored = await exercisesForGame('g1');
    expect(stored.map((e) => e.id)).toEqual(['first']);
    expect(linkedExercisesByPly(stored, 'g1', FENS).get(5)).toBe('first');
  });

  it('a removed exercise or game leaves no link behind', async () => {
    await getDb().games.add(mkGame('g1'));
    await addExercise(derived('e5', 'g1', 5));
    await addExercise(derived('e6', 'g1', 6));
    await deleteExercise('e5');
    expect([...linkedExercisesByPly(await exercisesForGame('g1'), 'g1', FENS).keys()]).toEqual([6]);
    await deleteGame('g1');
    expect(await exercisesForGame('g1')).toEqual([]);
  });
});
