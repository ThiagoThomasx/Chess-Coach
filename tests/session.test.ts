import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { addExercise, listAttempts, listExercises, listSkillEvents, recordAttempt } from '../src/db/trainingRepo';
import { buildQueue, isPlanCurrent, newPlan, nextPending, parsePlan, sessionResults, summarize, withSkipped, type QueueInput } from '../src/services/training/session';
import { nextTraining } from '../src/services/recommendations/recommend';
import { estimateProfile } from '../src/services/adaptation/skills';
import { DAY_MS, isDueReview, RETRY_DELAY_MS } from '../src/services/scheduling/srs';
import { mkAttempt, mkExercise } from './support/training';

const NOW = 1_000 * DAY_MS;
const FUTURE = NOW + 5 * DAY_MS;
const fork = { theme: 'fork' as const, motifSide: 'opponent' as const, skill: 'threats' as const };

const input = (over: Partial<QueueInput>): QueueInput => ({
  exercises: [],
  attempts: [],
  recommendation: { focus: { key: 'fork:opponent', theme: 'fork' } },
  targets: new Map([['tactics', 2], ['threats', 2]]),
  dailyGoal: 10,
  now: NOW,
  ...over,
});

describe('session queue', () => {
  const exercises = [
    mkExercise('level-far', { difficulty: 5, srs: { box: 0, dueAt: FUTURE } }),
    mkExercise('level', { difficulty: 3, srs: { box: 0, dueAt: FUTURE }, createdAt: 2 }),
    mkExercise('focus', { ...fork, difficulty: 4, srs: { box: 0, dueAt: FUTURE } }),
    mkExercise('due-late', { srs: { box: 1, dueAt: NOW - 1, lastReviewedAt: NOW - 3 * DAY_MS } }),
    mkExercise('due-early', { ...fork, srs: { box: 1, dueAt: NOW - DAY_MS, lastReviewedAt: NOW - 3 * DAY_MS } }),
  ];

  it('orders due reviews (most overdue first), then the focus, then the player level', () => {
    const q = buildQueue(input({ exercises }));
    expect(q).toEqual([
      { exerciseId: 'due-early', reason: 'due' },
      { exerciseId: 'due-late', reason: 'due' },
      { exerciseId: 'focus', reason: 'focus' },
      { exerciseId: 'level', reason: 'level' },
    ]);
  });

  it('never lists an exercise twice (a due focus exercise appears once, as a review)', () => {
    const q = buildQueue(input({ exercises }));
    expect(new Set(q.map((i) => i.exerciseId)).size).toBe(q.length);
    expect(q.filter((i) => i.exerciseId === 'due-early')).toHaveLength(1);
  });

  it('respects dailyGoal and does not pad a short queue', () => {
    expect(buildQueue(input({ exercises, dailyGoal: 3 })).map((i) => i.exerciseId)).toEqual(['due-early', 'due-late', 'focus']);
    expect(buildQueue(input({ exercises, dailyGoal: 50 }))).toHaveLength(4);
  });

  it('skips exercises already solved independently that are not due yet', () => {
    // Older than the practice window (attempts within it are covered by the audit test below).
    const attempts = [mkAttempt('focus', NOW - 2 * RETRY_DELAY_MS, 'independent'), mkAttempt('level', NOW - 2 * RETRY_DELAY_MS, 'fail')];
    const ids = buildQueue(input({ exercises, attempts })).map((i) => i.exerciseId);
    expect(ids).not.toContain('focus');
    expect(ids).toContain('level');
  });

  it('follows a skill focus as well as a theme focus', () => {
    const q = buildQueue(input({ exercises, recommendation: { focus: { skill: 'tactics' } } }));
    expect(q.find((i) => i.reason === 'focus')?.exerciseId).toBe('level');
  });

  it('a new exercise (created due, never attempted) is not a review: it enters as focus or level (review finding)', () => {
    const fresh = [mkExercise('new-focus', { ...fork, srs: { box: 0, dueAt: NOW - 5 } }), mkExercise('new-level', { srs: { box: 0, dueAt: NOW - 5 } })];
    expect(buildQueue(input({ exercises: fresh }))).toEqual([
      { exerciseId: 'new-focus', reason: 'focus' },
      { exerciseId: 'new-level', reason: 'level' },
    ]);
  });

  it('leaves out an exercise attempted in the last 10 minutes: a new attempt would be practice and never recorded (audit 4.1.1)', () => {
    // Failed via the normal list 5 minutes ago: not due yet (due in 10 min), not solved.
    const recent = [mkExercise('just-failed', { ...fork, srs: { box: 0, dueAt: NOW + 5 * 60_000, lastReviewedAt: NOW - 5 * 60_000 } })];
    const attempts = [mkAttempt('just-failed', NOW - 5 * 60_000, 'fail')];
    expect(buildQueue(input({ exercises: recent, attempts }))).toEqual([]);
    // Outside the practice window it is eligible again.
    expect(buildQueue(input({ exercises: recent, attempts, now: NOW - 5 * 60_000 + RETRY_DELAY_MS }))).toHaveLength(1);
  });

  it('is empty when no exercise is available', () => {
    expect(buildQueue(input({ exercises: [] }))).toEqual([]);
  });
});

describe('session progress and summary', () => {
  const plan = newPlan(
    [
      { exerciseId: 'a', reason: 'due' },
      { exerciseId: 'b', reason: 'focus' },
      { exerciseId: 'c', reason: 'level' },
      { exerciseId: 'd', reason: 'level' },
    ],
    NOW,
  );

  it('advances to the first exercise neither attempted nor skipped', () => {
    expect(nextPending(sessionResults(plan, []))).toBe('a');
    const r = sessionResults(plan, [mkAttempt('a', NOW + 1, 'fail')]);
    expect(nextPending(r)).toBe('b');
    expect(nextPending(sessionResults(withSkipped(plan, 'b'), [mkAttempt('a', NOW + 1, 'fail')]))).toBe('c');
  });

  it('ignores attempts made before the session started and keeps the first one inside it', () => {
    const r = sessionResults(plan, [mkAttempt('a', NOW - 10, 'independent'), mkAttempt('a', NOW + 5, 'fail'), mkAttempt('a', NOW + 5 + RETRY_DELAY_MS, 'independent')]);
    expect(r[0]?.outcome).toBe('fail');
  });

  it('summarizes the real results of the session', () => {
    const exercises = [mkExercise('a'), mkExercise('b', fork), mkExercise('c'), mkExercise('d')];
    const r = sessionResults(withSkipped(plan, 'd'), [mkAttempt('a', NOW + 1, 'independent'), mkAttempt('b', NOW + 2, 'assisted'), mkAttempt('c', NOW + 3, 'revealed')]);
    expect(summarize(r, exercises)).toEqual({ planned: 4, done: 3, independent: 1, assisted: 1, failed: 1, skipped: 1, pending: 0, reviewsDone: 1, skills: ['tactics', 'threats'] });
  });

  it('survives an interruption: the stored plan round-trips, and other days or junk are rejected', () => {
    const stored = JSON.parse(JSON.stringify(withSkipped(plan, 'b')));
    expect(parsePlan(stored)).toEqual(withSkipped(plan, 'b'));
    expect(isPlanCurrent(plan, NOW + 60_000)).toBe(true);
    expect(isPlanCurrent(plan, NOW + 2 * DAY_MS)).toBe(false);
    expect(parsePlan({ version: 2 })).toBeNull();
    expect(parsePlan({ ...stored, items: [{ exerciseId: 'a', reason: 'bogus' }] })).toBeNull();
    expect(parsePlan('x')).toBeNull();
  });
});

describe('session integration with IndexedDB', () => {
  let n = 0;
  beforeEach(() => {
    setDb(new ChessQuestDB(`session-${++n}`));
  });

  it('records results through the normal path, updates SRS and the profile, and the next recommendation reflects them', async () => {
    const t0 = Date.now();
    const fens = ['R5K1', '1R4K1', '2R3K1'].map((rank) => `6k1/5ppp/8/8/8/8/5PPP/${rank} w - - 0 1`);
    for (const [i, fen] of fens.entries()) await addExercise(mkExercise(`f${i}`, { ...fork, fen, srs: { box: 1, dueAt: t0 - 1, lastReviewedAt: t0 - 2 * DAY_MS } }));
    const exercises = await listExercises();
    expect(exercises).toHaveLength(3);
    const before = nextTraining({ games: [], dueReviews: 3, totalGames: 1, profile: [], exercises, attempts: [] });
    expect(before.kind).toBe('reviews');

    const queue = buildQueue(input({ exercises, now: t0, recommendation: before }));
    const plan = newPlan(queue, t0);
    expect(queue.map((i) => i.reason)).toEqual(['due', 'due', 'due']);

    // The session solves each exercise once (fail, fail, hint) through recordAttempt.
    const kinds = ['fail', 'revealed', 'assisted'] as const;
    for (const [i, item] of queue.entries()) {
      const ex = (await listExercises()).find((e) => e.id === item.exerciseId)!;
      const r = await recordAttempt(ex, mkAttempt(ex.id, t0 + i + 1, kinds[i]!), [1, 3, 7]);
      expect(r.practice).toBe(false);
    }
    // A repeat inside the practice window adds nothing (no evidence inflation).
    const again = await recordAttempt((await listExercises())[0]!, mkAttempt('f0', t0 + 10, 'independent'), [1, 3, 7]);
    expect(again.practice).toBe(true);

    const attempts = await listAttempts();
    expect(attempts).toHaveLength(3);
    const summary = summarize(sessionResults(plan, attempts), await listExercises());
    expect(summary).toMatchObject({ done: 3, independent: 0, assisted: 1, failed: 2, reviewsDone: 3, skills: ['threats'] });

    // SRS rescheduled the exercises; the profile received one event per attempt.
    const after = await listExercises();
    expect(after.every((e) => e.srs.lastReviewedAt !== undefined)).toBe(true);
    const events = await listSkillEvents();
    expect(events.filter((e) => e.skill === 'threats')).toHaveLength(3);
    expect(estimateProfile(events, t0 + 100).find((s) => s.skill === 'threats')?.events).toBe(3);

    // Next recommendation, computed from the stored data only. Two failed reviews are
    // due again (in 10 min); after they come back, it targets the failed pattern.
    const later = t0 + RETRY_DELAY_MS + 10;
    const due = after.filter((e) => e.srs.dueAt <= later).length;
    expect(due).toBe(2);
    const next = nextTraining({ games: [], dueReviews: 0, totalGames: 1, profile: [], exercises: after, attempts });
    expect(next.kind).toBe('theme');
    expect(next.title).toMatch(/do adversário/);
    expect(next.message).toContain('0 de 3 sem ajuda, 1 com dicas');
  });

  it('SRS cycle (audit 4.1.1): new → not a review; a valid hinted attempt schedules it; practice changes nothing; then it is a due review', async () => {
    const t0 = Date.now();
    // As created by generate.ts: due immediately, never reviewed.
    await addExercise(mkExercise('n', { srs: { box: 2, dueAt: t0 } }));
    let [ex] = await listExercises();
    expect(isDueReview(ex!.srs, t0 + 1)).toBe(false);
    expect(buildQueue(input({ exercises: [ex!], now: t0 + 1, targets: new Map() }))).toEqual([{ exerciseId: 'n', reason: 'level' }]);

    // Solved with a hint: box kept, due after half the box interval (box 2 of [1,3,7] → 3.5 days).
    const r = await recordAttempt(ex!, mkAttempt('n', t0 + 10, 'assisted'), [1, 3, 7]);
    expect(r.practice).toBe(false);
    [ex] = await listExercises();
    expect(ex!.srs).toEqual({ box: 2, dueAt: t0 + 10 + 3.5 * DAY_MS, lastReviewedAt: t0 + 10 });

    // A repeat inside the practice window: no attempt, no reschedule, no evidence.
    const eventsBefore = (await listSkillEvents()).length;
    expect(eventsBefore).toBeGreaterThan(0);
    const repeat = await recordAttempt(ex!, mkAttempt('n', t0 + 20, 'independent'), [1, 3, 7]);
    expect(repeat.practice).toBe(true);
    expect((await listExercises())[0]!.srs).toEqual(ex!.srs);
    expect(await listAttempts()).toHaveLength(1);
    expect(await listSkillEvents()).toHaveLength(eventsBefore);

    // Not due before its date; a due review (first in the queue) from it on.
    expect(isDueReview(ex!.srs, ex!.srs.dueAt - 1)).toBe(false);
    expect(buildQueue(input({ exercises: [ex!], attempts: await listAttempts(), now: ex!.srs.dueAt, targets: new Map() }))).toEqual([{ exerciseId: 'n', reason: 'due' }]);
  });

  it('existing exercises without the new fields keep working (no schema change)', async () => {
    await addExercise(mkExercise('legacy'));
    const db = getDb();
    expect(db.verno).toBe(2);
    // No kind/goal/tree/motifSide; difficulty 2 is within one level of the default target 1.
    const q = buildQueue(input({ exercises: await listExercises(), targets: new Map() }));
    expect(q).toEqual([{ exerciseId: 'legacy', reason: 'level' }]);
  });
});
