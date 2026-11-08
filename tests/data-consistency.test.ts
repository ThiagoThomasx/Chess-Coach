import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { deleteGame, getGame, importPgn } from '../src/db/gamesRepo';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { recordAttempt, removeOrphanExerciseEvidence } from '../src/db/trainingRepo';
import { changeUserColor, reconcileDerivations, startAnalysis } from '../src/services/analysis/analysisRunner';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import { positionsOf } from '../src/services/chess/position';
import { materialBalance } from '../src/services/chess/material';
import type { Attempt, Exercise, Game, SkillEvent } from '../src/types/domain';
import { SHORT_BLUNDER_GAME } from './fixtures';

// Sprint 4.5: data stays consistent when individually correct actions are combined.

const settings = { ...DEFAULT_SETTINGS, analysisDepth: 12 };
let n = 0;

/** 3.Nd4?? is a blunder (best 3.Bc4). */
function scripted(game: Game): EngineLike {
  const fens = positionsOf(game.moves);
  return {
    async analyze({ fen, depth = 12, multiPv = 1 }) {
      const score = { kind: 'cp' as const, value: fen === fens[5] ? -300 : materialBalance(fen, 'w') * 100 };
      const legal = new Chess(fen).moves({ verbose: true });
      const first = fen === fens[4] ? 'f1c4' : legal[0] ? `${legal[0].from}${legal[0].to}` : undefined;
      return { fen, depth, multiPv, lines: [{ multipv: 1, score, pv: first ? [first] : [], depth }], complete: true, timeMs: 1 };
    },
  };
}

async function whiteGameWithExercise(pgn = SHORT_BLUNDER_GAME): Promise<{ game: Game; ex: Exercise }> {
  const r = await importPgn(pgn, 'a.pgn', []);
  const game = await getGame(r.imported[0]?.id ?? '');
  if (!game) throw new Error('not imported');
  await startAnalysis(game, settings, scripted(game));
  await changeUserColor(game.id, 'w', settings);
  const ex = (await getDb().exercises.where('gameId').equals(game.id).toArray())[0];
  if (!ex) throw new Error('no exercise');
  return { game, ex };
}

const attempt = (exerciseId: string, at = Date.now()): Attempt => ({ exerciseId, at, correct: true, hintsUsed: 0, revealed: false, timeMs: 1, moves: [] });
const openingEvent: SkillEvent = { skill: 'openings', at: 1, outcome: 1, weight: 0.5, independent: true, source: 'opening', ref: { openingId: 'x', lineId: 'l' } as SkillEvent['ref'] };

beforeEach(() => {
  setDb(new ChessQuestDB(`consistency-${++n}`));
});

describe('deleting a game removes the evidence of its exercises (Sprint 4.5, N1)', () => {
  it('no evidence of the deleted exercises is left; other evidence is kept', async () => {
    const { game, ex } = await whiteGameWithExercise();
    await recordAttempt(ex, attempt(ex.id), settings.srsIntervalsDays);
    const other: SkillEvent = { skill: 'tactics', at: 1, outcome: 1, weight: 1, independent: true, source: 'exercise', ref: { exerciseId: 'standalone' } };
    await getDb().exercises.add({ ...ex, id: 'standalone', gameId: undefined, fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1' });
    await getDb().skillEvents.bulkAdd([other, openingEvent]);
    expect(await getDb().skillEvents.where('ref.exerciseId').equals(ex.id).count()).toBeGreaterThan(0);

    await deleteGame(game.id);

    expect(await getDb().skillEvents.where('ref.exerciseId').equals(ex.id).count()).toBe(0);
    expect(await getDb().skillEvents.where('ref.gameId').equals(game.id).count()).toBe(0);
    const left = await getDb().skillEvents.toArray();
    expect(left.map((e) => e.source).sort()).toEqual(['exercise', 'opening']);
    expect(left.find((e) => e.source === 'exercise')?.ref.exerciseId).toBe('standalone');
  });
});

describe('orphan exercise evidence cleanup (Sprint 4.5, D-5)', () => {
  it('removes only exercise evidence whose exercise no longer exists', async () => {
    const { game, ex } = await whiteGameWithExercise();
    await recordAttempt(ex, attempt(ex.id), settings.srsIntervalsDays);
    const db = getDb();
    // Pre-4.5 state: a deleted game left the evidence of an exercise behind.
    await db.skillEvents.bulkAdd([
      { skill: 'tactics', at: 2, outcome: 0, weight: 1, independent: false, source: 'exercise', ref: { exerciseId: 'gone' } },
      { skill: 'calculation', at: 2, outcome: 0, weight: 0.5, independent: false, source: 'exercise', ref: { exerciseId: 'gone' } },
      openingEvent,
    ]);
    const gameEvents = await db.skillEvents.where('ref.gameId').equals(game.id).count();
    const liveExerciseEvents = await db.skillEvents.where('ref.exerciseId').equals(ex.id).count();

    expect(await removeOrphanExerciseEvidence()).toBe(2);

    expect(await db.skillEvents.where('ref.exerciseId').equals('gone').count()).toBe(0);
    expect(await db.skillEvents.where('ref.exerciseId').equals(ex.id).count()).toBe(liveExerciseEvents);
    expect(await db.skillEvents.where('ref.gameId').equals(game.id).count()).toBe(gameEvents);
    expect(await db.skillEvents.where('source').equals('opening').count()).toBe(1);
  });

  it('is idempotent and leaves exercise events without an exercise id alone', async () => {
    const db = getDb();
    await db.skillEvents.bulkAdd([
      { skill: 'tactics', at: 2, outcome: 0, weight: 1, independent: false, source: 'exercise', ref: { exerciseId: 'gone' } },
      { skill: 'tactics', at: 3, outcome: 1, weight: 1, independent: true, source: 'exercise', ref: {} },
    ]);
    expect(await removeOrphanExerciseEvidence()).toBe(1);
    const snapshot = await db.skillEvents.toArray();
    expect(await removeOrphanExerciseEvidence()).toBe(0);
    expect(await db.skillEvents.toArray()).toEqual(snapshot);
    expect(snapshot).toHaveLength(1);
  });
});

describe('attempts and derivations check the stored state in their own transaction (Sprint 4.5, P3-3 and C1)', () => {
  it('an attempt on an exercise removed meanwhile writes nothing back', async () => {
    const { game, ex } = await whiteGameWithExercise();
    await changeUserColor(game.id, 'b', settings); // D3 removes the never-attempted White exercise
    expect(await getDb().exercises.get(ex.id)).toBeUndefined();

    const r = await recordAttempt(ex, attempt(ex.id), settings.srsIntervalsDays);

    expect(r.removed).toBe(true);
    expect(await getDb().exercises.get(ex.id)).toBeUndefined();
    expect(await getDb().attempts.count()).toBe(0);
    expect(await getDb().skillEvents.where('ref.exerciseId').equals(ex.id).count()).toBe(0);
  });

  it('the schedule builds on the stored exercise, not on the copy the solver holds', async () => {
    const { ex } = await whiteGameWithExercise();
    // Another tab already reviewed it: box 3 is stored; this tab still holds box 0.
    await getDb().exercises.update(ex.id, { srs: { box: 3, dueAt: 1, lastReviewedAt: 1 } });

    const r = await recordAttempt(ex, attempt(ex.id), settings.srsIntervalsDays);

    expect(r.exercise.srs.box).toBe(4);
    expect((await getDb().exercises.get(ex.id))?.srs.box).toBe(4);
  });

  it('a side switch that lands between the color check and the write leaves no exercise of the old side', async () => {
    const r = await importPgn(SHORT_BLUNDER_GAME, 'a.pgn', []);
    const game = await getGame(r.imported[0]?.id ?? '');
    if (!game) throw new Error('not imported');
    await startAnalysis(game, settings, scripted(game));
    await getDb().games.update(game.id, { userColor: 'w' });
    await getDb().analyses.update(game.id, { derivation: 'pending' });
    // The 2nd read of the game (the re-check after the tree is built) still answers White,
    // but a switch to Black commits before that answer is used.
    const table = getDb().games;
    const original = table.get.bind(table);
    let calls = 0;
    let switching: Promise<unknown> | undefined;
    (table as unknown as { get: typeof table.get }).get = (async (key: string) => {
      const value = await original(key);
      if (++calls === 2 && !switching) {
        switching = changeUserColor(game.id, 'b', settings, () => scripted(game));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return value;
    }) as typeof table.get;
    try {
      await reconcileDerivations(settings, () => scripted(game));
      await switching;
    } finally {
      (table as unknown as { get: typeof table.get }).get = original;
    }

    expect((await getGame(game.id))?.userColor).toBe('b');
    expect((await getDb().exercises.toArray()).filter((e) => e.sideToMove === 'w')).toHaveLength(0);
    expect((await getDb().analyses.get(game.id))?.derivation).toBe('done');
  });
});
