import type { Attempt, Exercise, SkillEvent } from '../types/domain';
import { isPracticeRepeat, nextSrs, outcomeOf } from '../services/scheduling/srs';
import { eventsFromAttempt } from '../services/adaptation/skills';
import { getDb } from './database';
import { fenKey } from '../services/analysis/gameAnalyzer';

export async function listExercises(): Promise<Exercise[]> {
  return getDb().exercises.orderBy('createdAt').reverse().toArray();
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  return getDb().exercises.get(id);
}

/** Stores an exercise unless one already exists for the same position (move counters ignored). */
export async function addExercise(ex: Exercise): Promise<{ added: boolean; id: string }> {
  const db = getDb();
  const key = fenKey(ex.fen);
  const dup = await db.exercises.filter((e) => fenKey(e.fen) === key).first();
  if (dup) return { added: false, id: dup.id };
  await db.exercises.add(ex);
  return { added: true, id: ex.id };
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
}

/**
 * Records an attempt atomically: stores it, reschedules the exercise and
 * appends the corresponding skill evidence. A repeat inside the practice
 * window changes nothing.
 */
export async function recordAttempt(ex: Exercise, attempt: Attempt, intervals: readonly number[]): Promise<RecordedAttempt> {
  const db = getDb();
  return db.transaction('rw', db.attempts, db.exercises, db.skillEvents, async () => {
    const previous = (await db.attempts.where('exerciseId').equals(ex.id).sortBy('at')).at(-1);
    if (isPracticeRepeat(previous?.at, attempt.at)) return { exercise: ex, practice: true };
    const outcome = outcomeOf(attempt.correct, attempt.hintsUsed, attempt.revealed);
    const updated: Exercise = { ...ex, srs: nextSrs(ex.srs, outcome, attempt.at, intervals) };
    await db.attempts.add(attempt);
    await db.exercises.put(updated);
    await db.skillEvents.bulkAdd(eventsFromAttempt(ex, attempt));
    return { exercise: updated, practice: false };
  });
}

export async function listSkillEvents(): Promise<SkillEvent[]> {
  return getDb().skillEvents.orderBy('at').toArray();
}

export async function addSkillEvents(events: SkillEvent[]): Promise<void> {
  if (events.length) await getDb().skillEvents.bulkAdd(events);
}
