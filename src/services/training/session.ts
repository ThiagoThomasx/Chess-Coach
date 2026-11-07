import type { Attempt, Exercise, Skill } from '../../types/domain';
import type { Recommendation } from '../recommendations/recommend';
import { exercisePatternKey } from '../recommendations/themeEvidence';
import { isDueReview, isPracticeRepeat, outcomeOf, type ReviewOutcome } from '../scheduling/srs';
import { dayKey } from '../stats/stats';

/**
 * Guided daily session. The plan (an ordered list of exercise ids) lives only
 * in local storage; every result is the normal attempt recorded by the solver,
 * so the session adds no table, no schema change and no extra evidence.
 */
export type QueueReason = 'due' | 'focus' | 'level';

export const REASON_LABEL: Record<QueueReason, string> = {
  due: 'Revisão vencida',
  focus: 'Foco recomendado',
  level: 'No seu nível',
};

export interface SessionItem {
  exerciseId: string;
  reason: QueueReason;
}

export interface SessionPlan {
  version: 1;
  startedAt: number;
  /** Local day the plan was built; a plan from another day is discarded. */
  day: string;
  items: SessionItem[];
  /** Exercises the player chose to skip in this session (no attempt recorded). */
  skipped: string[];
}

/** Difficulty within this distance of the skill's target counts as "at the player's level". */
export const LEVEL_TOLERANCE = 1;

export interface QueueInput {
  exercises: readonly Exercise[];
  attempts: readonly Attempt[];
  recommendation: Pick<Recommendation, 'focus'>;
  /** Target difficulty per skill, from the skill profile. */
  targets: ReadonlyMap<Skill, number>;
  dailyGoal: number;
  now: number;
}

function lastAttempts(attempts: readonly Attempt[]): Map<string, Attempt> {
  const m = new Map<string, Attempt>();
  for (const a of attempts) {
    const prev = m.get(a.exerciseId);
    if (!prev || a.at >= prev.at) m.set(a.exerciseId, a);
  }
  return m;
}

function matchesFocus(ex: Exercise, focus: Recommendation['focus']): boolean {
  if (!focus) return false;
  return 'skill' in focus ? ex.skill === focus.skill : exercisePatternKey(ex) === focus.key;
}

/**
 * Builds the queue, capped at dailyGoal, without duplicates:
 * 1. due spaced-repetition reviews (already attempted), most overdue first;
 * 2. exercises of the recommended focus;
 * 3. exercises within LEVEL_TOLERANCE of the skill's target difficulty.
 * Groups 2 and 3 skip exercises that are not due and whose last attempt was an
 * independent solve (the scheduler already decided when they come back) or was
 * made within the practice window (a new attempt would not be recorded).
 */
export function buildQueue(input: QueueInput): SessionItem[] {
  const limit = Math.max(1, Math.floor(input.dailyGoal));
  const last = lastAttempts(input.attempts);
  const target = (ex: Exercise) => input.targets.get(ex.skill) ?? 1;
  const distance = (ex: Exercise) => Math.abs(ex.difficulty - target(ex));
  const isDue = (ex: Exercise) => isDueReview(ex.srs, input.now);
  const open = (ex: Exercise) => {
    const a = last.get(ex.id);
    if (!a) return true;
    // Attempted moments ago: a new attempt would be practice (not recorded) and the session could not advance.
    if (isPracticeRepeat(a.at, input.now)) return false;
    return outcomeOf(a.correct, a.hintsUsed, a.revealed) !== 'independent';
  };
  const byCloseness = (a: Exercise, b: Exercise) => distance(a) - distance(b) || a.srs.dueAt - b.srs.dueAt || a.createdAt - b.createdAt;

  const due = input.exercises.filter(isDue).sort((a, b) => a.srs.dueAt - b.srs.dueAt || a.createdAt - b.createdAt);
  const rest = input.exercises.filter((e) => !isDue(e) && open(e));
  const focus = rest.filter((e) => matchesFocus(e, input.recommendation.focus)).sort(byCloseness);
  const level = rest.filter((e) => distance(e) <= LEVEL_TOLERANCE).sort(byCloseness);

  const seen = new Set<string>();
  const items: SessionItem[] = [];
  const push = (list: readonly Exercise[], reason: QueueReason) => {
    for (const e of list) {
      if (items.length >= limit) return;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      items.push({ exerciseId: e.id, reason });
    }
  };
  push(due, 'due');
  push(focus, 'focus');
  push(level, 'level');
  return items;
}

export function newPlan(items: SessionItem[], now: number): SessionPlan {
  return { version: 1, startedAt: now, day: dayKey(now), items, skipped: [] };
}

export function isPlanCurrent(plan: SessionPlan, now: number): boolean {
  return plan.day === dayKey(now);
}

export function withSkipped(plan: SessionPlan, exerciseId: string): SessionPlan {
  return plan.skipped.includes(exerciseId) ? plan : { ...plan, skipped: [...plan.skipped, exerciseId] };
}

export interface ItemResult extends SessionItem {
  /** Outcome of the first attempt recorded during the session; null when none yet. */
  outcome: ReviewOutcome | null;
  skipped: boolean;
}

/** The first attempt at or after the session start is the session's result for that exercise. */
export function sessionResults(plan: SessionPlan, attempts: readonly Attempt[]): ItemResult[] {
  const first = new Map<string, Attempt>();
  for (const a of attempts) {
    if (a.at < plan.startedAt) continue;
    const prev = first.get(a.exerciseId);
    if (!prev || a.at < prev.at) first.set(a.exerciseId, a);
  }
  return plan.items.map((item) => {
    const a = first.get(item.exerciseId);
    return { ...item, outcome: a ? outcomeOf(a.correct, a.hintsUsed, a.revealed) : null, skipped: !a && plan.skipped.includes(item.exerciseId) };
  });
}

/** Next exercise to show: the first one neither attempted nor skipped. */
export function nextPending(results: readonly ItemResult[]): string | undefined {
  return results.find((r) => r.outcome === null && !r.skipped)?.exerciseId;
}

export interface SessionSummary {
  planned: number;
  done: number;
  independent: number;
  assisted: number;
  failed: number;
  skipped: number;
  pending: number;
  reviewsDone: number;
  skills: Skill[];
}

export function summarize(results: readonly ItemResult[], exercises: readonly Exercise[]): SessionSummary {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const done = results.filter((r) => r.outcome !== null);
  const count = (o: ReviewOutcome) => done.filter((r) => r.outcome === o).length;
  const skills = [...new Set(done.map((r) => byId.get(r.exerciseId)?.skill).filter((s): s is Skill => !!s))];
  return {
    planned: results.length,
    done: done.length,
    independent: count('independent'),
    assisted: count('assisted'),
    failed: count('fail'),
    skipped: results.filter((r) => r.skipped).length,
    pending: results.filter((r) => r.outcome === null && !r.skipped).length,
    reviewsDone: done.filter((r) => r.reason === 'due').length,
    skills,
  };
}

/** Validates a stored plan (local storage is external data). */
export function parsePlan(raw: unknown): SessionPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<SessionPlan>;
  const reasons: readonly string[] = ['due', 'focus', 'level'];
  if (p.version !== 1 || typeof p.startedAt !== 'number' || typeof p.day !== 'string' || !Array.isArray(p.items) || !Array.isArray(p.skipped)) return null;
  const itemsOk = p.items.every((i) => i && typeof i.exerciseId === 'string' && reasons.includes(i.reason));
  const skippedOk = p.skipped.every((s) => typeof s === 'string');
  return itemsOk && skippedOk ? { version: 1, startedAt: p.startedAt, day: p.day, items: p.items, skipped: p.skipped } : null;
}
