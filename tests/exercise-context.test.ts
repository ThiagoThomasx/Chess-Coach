import { describe, expect, it } from 'vitest';
import { lastMoveBefore } from '../src/services/exercises/context';
import { replayGame, START_FEN } from '../src/services/chess/position';

const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Nd4', 'exd4'];
const plies = replayGame(moves);

describe('lastMoveBefore', () => {
  it('returns the move that led into the exercise position', () => {
    // The exercise at ply 5 (Nd4) starts from the position after 2...Nc6.
    const m = lastMoveBefore({ moves, startFen: START_FEN }, 5, plies[4]!.fenBefore);
    expect(m).toMatchObject({ san: 'Nc6', from: 'b8', to: 'c6', color: 'b' });
  });

  it('returns null for the first move of a game', () => {
    expect(lastMoveBefore({ moves, startFen: START_FEN }, 1, START_FEN)).toBeNull();
  });

  it('returns null when the stored position does not match the game (never a wrong highlight)', () => {
    expect(lastMoveBefore({ moves, startFen: START_FEN }, 5, START_FEN)).toBeNull();
  });

  it('returns null without a game or ply, or with an unreadable game', () => {
    expect(lastMoveBefore(undefined, 5, START_FEN)).toBeNull();
    expect(lastMoveBefore({ moves, startFen: START_FEN }, undefined, START_FEN)).toBeNull();
    expect(lastMoveBefore({ moves: ['e4', 'Ke7??x'], startFen: START_FEN }, 2, START_FEN)).toBeNull();
  });
});
