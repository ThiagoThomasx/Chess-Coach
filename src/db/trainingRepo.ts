import type { Attempt, Color, Exercise, SkillEvent } from '../types/domain';
import { isPracticeRepeat, nextSrs, outcomeOf } from '../services/scheduling/srs';
import { eventsFromAttempt } from '../services/adaptation/skills';
import { getDb } from './database';
import { fenKey } from '../services/analysis/gameAnalyzer';

export async function listExercises(): Promise<Exercise[]> {
  return getDb().exercises.orderBy('createdAt').reverse().toArray();
}

/** Exercises stored for one game, through the `gameId` index (Sprint 4.6, B2: links between analysis and exercises). */
export async function exercisesForGame(gameId: string): Promise<Exercise[]> {
  return getDb().exercises.where('gameId').equals(gameId).toArray();
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  return getDb().exercises.get(id);
}

/** Write the exercise only while this game still has this user color (checked in the write's transaction). */
export interface ColorGuard {
  gameId: string;
  color: Color;
}

/**
 * Stores an exercise unless one already exists for the same position (move
 * counters ignored). The check and the insert share one read-write
 * transaction, so concurrent calls (manual + automatic creation, or two tabs)
 * cannot both pass the check: IndexedDB serializes write transactions on the
 * same store. With a `guard`, nothing is written when the game's color is no
 * longer the expected one (or the game is gone): a color switch cannot land
 * between a derivation's color check and its write (Sprint 4.5, C1).
 */
export async function addExercise(ex: Exercise, guard?: ColorGuard): Promise<{ added: boolean; id: string; colorChanged?: boolean }> {
  const db = getDb();
  const key = fenKey(ex.fen);
  return db.transaction('rw', db.exercises, db.games, async () => {
    if (guard && (await db.games.get(guard.gameId))?.userColor !== guard.color) return { added: false, id: ex.id, colorChanged: true };
    const dup = await db.exercises.filter((e) => fenKey(e.fen) === key).first();
    if (dup) return { added: false, id: dup.id };
    await db.exercises.add(ex);
    return { added: true, id: ex.id };
  });
}

export async function deleteExercise(id: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.exercises, db.attempts, db.skillEvents, async () => {
    await db.attempts.where('exerciseId').equals(id).delete();
    await db.skillEvents.where('ref.exerciseId').equals(id).delete();
    await db.exercises.delete(id);
  });
}

export async function attemptsFor(exerciseId: string): Promise<Attempt[]> {
  return getDb().attempts.where('exerciseId').equals(exerciseId).sortBy('at');
}

export async function listAttempts(): Promise<Attempt[]> {
  return getDb().attempts.orderBy('at').toArray();
}

export interface RecordedAttempt {
  exercise: Exercise;
  /** True when the attempt was practice (see isPracticeRepeat) and nothing was stored. */
  practice: boolean;
  /** True when the exercise no longer exists (side switch, deleted game or exercise): nothing was stored. */
  removed?: boolean;
}

/**
 * Records an attempt atomically: stores it, reschedules the exercise and
 * appends the corresponding skill evidence. A repeat inside the practice
 * window changes nothing. The exercise is re-read in the transaction: one
 * removed meanwhile (another tab, a side switch) is not written back with
 * the attempt, and the schedule builds on the stored one, not on the copy
 * the solver holds (Sprint 4.5, P3-3).
 */
export async function recordAttempt(ex: Exercise, attempt: Attempt, intervals: readonly number[]): Promise<RecordedAttempt> {
  const db = getDb();
  return db.transaction('rw', db.attempts, db.exercises, db.skillEvents, async () => {
    const current = await db.exercises.get(ex.id);
    if (!current) return { exercise: ex, practice: false, removed: true };
    const previous = (await db.attempts.where('exerciseId').equals(ex.id).sortBy('at')).at(-1);
    if (isPracticeRepeat(previous?.at, attempt.at)) return { exercise: current, practice: true };
    const outcome = outcomeOf(attempt.correct, attempt.hintsUsed, attempt.revealed);
    const updated: Exercise = { ...current, srs: nextSrs(current.srs, outcome, attempt.at, intervals) };
    await db.attempts.add(attempt);
    await db.exercises.put(updated);
    await db.skillEvents.bulkAdd(eventsFromAttempt(current, attempt));
    return { exercise: updated, practice: false };
  });
}

/**
 * Removes exercise evidence whose exercise no longer exists (user decision
 * D-5, Sprint 4.5): left behind by deleting a game before Sprint 4.5. Only
 * `source: 'exercise'` events with an `exerciseId` are candidates; game and
 * opening evidence is never touched. Idempotent, so it runs on every start.
 * Returns how many events were removed.
 */
export async function removeOrphanExerciseEvidence(): Promise<number> {
  const db = getDb();
  return db.transaction('rw', db.exercises, db.skillEvents, async () => {
    const existing = new Set(await db.exercises.toCollection().primaryKeys());
    const orphans = await db.skillEvents
      .where('source')
      .equals('exercise')
      .filter((e) => e.ref.exerciseId !== undefined && !existing.has(e.ref.exerciseId))
      .primaryKeys();
    await db.skillEvents.bulkDelete(orphans);
    return orphans.length;
  });
}

export async function listSkillEvents(): Promise<SkillEvent[]> {
  return getDb().skillEvents.orderBy('at').toArray();
}

export async function addSkillEvents(events: SkillEvent[]): Promise<void> {
  if (events.length) await getDb().skillEvents.bulkAdd(events);
}
