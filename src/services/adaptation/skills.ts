import type { Attempt, ConfidenceLevel, Exercise, MoveReview, Skill, SkillEstimate, SkillEvent } from '../../types/domain';
import { gamePhase, settledSwing } from '../chess/material';
import { enPrise } from '../chess/tactics';
import { detectConcepts, THEME_SKILL } from '../pedagogy/concepts';
import { DAY_MS } from '../scheduling/srs';

export const SKILLS: readonly Skill[] = ['tactics', 'calculation', 'threats', 'defense', 'strategy', 'openings', 'endgames', 'patterns'];

export const SKILL_LABEL: Record<Skill, string> = {
  tactics: 'Visão tática',
  calculation: 'Cálculo de variantes',
  threats: 'Identificação de ameaças',
  defense: 'Defesa',
  strategy: 'Estratégia',
  openings: 'Aberturas',
  endgames: 'Finais',
  patterns: 'Reconhecimento de padrões',
};

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  insufficient: 'Poucas evidências',
  initial: 'Evidências iniciais',
  consistent: 'Desempenho consistente',
  provisional_mastery: 'Domínio provisório',
  needs_review: 'Precisa revisar',
};

/** Evidence weights: exercises are direct measurements; game moves are noisy. */
export const WEIGHTS = { exercise: 1, gameConcept: 0.5, gameOpportunity: 0.5, gamePhase: 0.2, opening: 0.5 } as const;

/** Partial credit for an exercise attempt. */
export function exerciseOutcome(a: Pick<Attempt, 'correct' | 'hintsUsed' | 'revealed'>): number {
  if (!a.correct || a.revealed) return 0;
  return Math.max(0.25, 1 - 0.25 * a.hintsUsed);
}

export function eventsFromAttempt(ex: Exercise, a: Attempt): SkillEvent[] {
  const outcome = exerciseOutcome(a);
  const independent = a.correct && a.hintsUsed === 0 && !a.revealed;
  const base = { at: a.at, outcome, weight: WEIGHTS.exercise, independent, difficulty: ex.difficulty, source: 'exercise' as const, ref: { exerciseId: ex.id } };
  const events: SkillEvent[] = [{ ...base, skill: ex.skill }];
  // Multi-move forcing solutions also measure calculation.
  if (ex.solutionLine.length >= 3 && ex.skill !== 'calculation') events.push({ ...base, skill: 'calculation', weight: 0.5 });
  return events;
}

const PHASE_SKILL = { opening: 'openings', middlegame: 'strategy', endgame: 'endgames' } as const;

function phaseOutcome(c: MoveReview['classification']): number | null {
  if (c === 'best' || c === 'excellent' || c === 'good') return 1;
  if (c === 'inaccuracy') return 0.5;
  if (c === 'mistake' || c === 'blunder') return 0;
  return null;
}

/**
 * Derives skill evidence from the user's analyzed moves. Every event is tied
 * to a concrete ply so recommendations stay traceable.
 */
export function eventsFromGame(gameId: string, reviews: readonly MoveReview[], replyLines: Record<number, string[]>, userColor: 'w' | 'b', at: number): SkillEvent[] {
  const events: SkillEvent[] = [];
  for (const r of reviews) {
    if (r.color !== userColor) continue;
    const o = phaseOutcome(r.classification);
    if (o === null) continue;
    const ref = { gameId, ply: r.ply };
    const ev = (skill: Skill, outcome: number, weight: number): SkillEvent => ({ skill, at, outcome, weight, independent: true, source: 'game', ref });
    events.push(ev(PHASE_SKILL[gamePhase(r.fenBefore, r.ply)], o, WEIGHTS.gamePhase));

    if (o === 0) {
      const c = detectConcepts(r, replyLines[r.ply] ?? [])[0];
      if (c && c.verified) events.push(ev(THEME_SKILL[c.theme], 0, WEIGHTS.gameConcept));
      continue;
    }
    // Successes: only when the position offered a verifiable opportunity or threat.
    if (o === 1) {
      const best = settledSwing(r.fenBefore, r.bestLine, r.color);
      if (best.settled && best.delta >= 2) events.push(ev('tactics', 1, WEIGHTS.gameOpportunity));
      if (r.flags.includes('mate_found')) events.push(ev('patterns', 1, WEIGHTS.gameOpportunity));
      if (r.flags.includes('defense_needed')) events.push(ev('defense', 1, WEIGHTS.gameOpportunity));
      // Legal-capture threats (SEE > 0) only; geometric attacks by pinned pieces do not count.
      const threatened = enPrise(r.fenBefore, r.color).length > 0;
      const stillThreatened = enPrise(r.fenAfter, r.color).length > 0;
      if (threatened && !stillThreatened) events.push(ev('threats', 1, WEIGHTS.gameOpportunity));
    }
  }
  return capPerSkill(events, MAX_GAME_WEIGHT_PER_SKILL);
}

/** One game contains few examples of each theme: its total weight per skill is capped. */
export const MAX_GAME_WEIGHT_PER_SKILL = 1;

function capPerSkill(events: SkillEvent[], cap: number): SkillEvent[] {
  const totals = new Map<Skill, number>();
  for (const e of events) totals.set(e.skill, (totals.get(e.skill) ?? 0) + e.weight);
  return events.map((e) => {
    const total = totals.get(e.skill) ?? 0;
    return total > cap ? { ...e, weight: (e.weight * cap) / total } : e;
  });
}

/** Weights decay with age (half-life) so the estimate follows recent performance. */
export const HALF_LIFE_DAYS = 120;
/** Mastery needs independent successes on this many distinct exercises of the skill. */
export const MASTERY_DISTINCT_EXERCISES = 5;

/**
 * Effective weight of each event: exponential age decay, and diminishing
 * weight for repeated attempts at the same exercise (k-th attempt × 1/k), so
 * memorizing one position cannot inflate a skill.
 */
export function effectiveWeights(events: readonly SkillEvent[], now: number): number[] {
  const seen = new Map<string, number>();
  return events.map((e) => {
    const age = Math.max(0, now - e.at) / DAY_MS;
    let w = e.weight * 0.5 ** (age / HALF_LIFE_DAYS);
    const exId = e.ref.exerciseId;
    if (e.source === 'exercise' && exId) {
      const k = (seen.get(exId) ?? 0) + 1;
      seen.set(exId, k);
      w /= k;
    }
    return w;
  });
}

const RECENT_WINDOW = 8;
const STALE_DAYS = 30;
const Z90 = 1.645;

function rate(events: readonly SkillEvent[]): number | null {
  const w = events.reduce((s, e) => s + e.weight, 0);
  return w > 0 ? events.reduce((s, e) => s + e.weight * e.outcome, 0) / w : null;
}

/**
 * Adaptive difficulty target from exercise history: two consecutive
 * independent successes at or above target raise it; a failure lowers it.
 */
export function targetDifficulty(events: readonly SkillEvent[]): number {
  let target = 1;
  let streak = 0;
  for (const e of events) {
    if (e.source !== 'exercise') continue;
    if (e.outcome === 0) {
      target = Math.max(1, target - 1);
      streak = 0;
    } else if (e.independent && (e.difficulty ?? 1) >= target) {
      streak++;
      if (streak >= 2) {
        target = Math.min(5, target + 1);
        streak = 0;
      }
    }
  }
  return target;
}

/**
 * Bayesian estimate of the success rate per skill: Beta(1,1) prior updated
 * with weighted outcomes (α += w·o, β += w·(1−o)). The interval uses the
 * normal approximation of the Beta posterior. No rating is inferred.
 */
export function estimateSkill(skill: Skill, all: readonly SkillEvent[], now: number): SkillEstimate {
  const events = all.filter((e) => e.skill === skill).sort((a, b) => a.at - b.at);
  const target = targetDifficulty(events);
  if (events.length === 0) {
    return { skill, level: null, interval: null, evidence: 0, events: 0, recentRate: null, independentRate: null, assistedRate: null, trend: 'unknown', confidence: 'insufficient', targetDifficulty: target };
  }
  const weights = effectiveWeights(events, now);
  const evidence = weights.reduce((s, w) => s + w, 0);
  const alpha = 1 + events.reduce((s, e, i) => s + (weights[i] ?? 0) * e.outcome, 0);
  const beta = 1 + events.reduce((s, e, i) => s + (weights[i] ?? 0) * (1 - e.outcome), 0);
  const mean = alpha / (alpha + beta);
  const sd = Math.sqrt((alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1)));
  const interval: [number, number] = [Math.max(0, mean - Z90 * sd), Math.min(1, mean + Z90 * sd)];

  const recent = events.slice(-RECENT_WINDOW);
  const previous = events.slice(-2 * RECENT_WINDOW, -RECENT_WINDOW);
  const recentRate = rate(recent);
  const prevRate = rate(previous);
  let trend: SkillEstimate['trend'] = 'unknown';
  if (recentRate !== null && prevRate !== null && previous.length >= 4) {
    trend = recentRate - prevRate > 0.1 ? 'up' : recentRate - prevRate < -0.1 ? 'down' : 'stable';
  }
  const ex = events.filter((e) => e.source === 'exercise');
  const indep = ex.filter((e) => e.independent);
  const assisted = ex.filter((e) => !e.independent && e.outcome > 0);
  const lastAt = events[events.length - 1]?.at;

  // Staleness is judged on raw (undecayed) evidence: old knowledge is "to review", not "unknown".
  const rawEvidence = events.reduce((s, e) => s + e.weight, 0);
  const stale = lastAt !== undefined && now - lastAt > STALE_DAYS * DAY_MS;
  let confidence: ConfidenceLevel;
  if (stale && rawEvidence >= 6) confidence = 'needs_review';
  else if (evidence < 2) confidence = 'insufficient';
  else if (evidence < 6) confidence = 'initial';
  else if ((lastAt !== undefined && now - lastAt > STALE_DAYS * DAY_MS) || (recentRate !== null && recentRate < mean - 0.2)) confidence = 'needs_review';
  else if (evidence >= 10 && mean >= 0.75 && interval[0] >= 0.6 && distinctIndependent(ex) >= MASTERY_DISTINCT_EXERCISES) confidence = 'provisional_mastery';
  else confidence = 'consistent';

  return {
    skill,
    level: mean,
    interval,
    evidence,
    events: events.length,
    recentRate,
    independentRate: ex.length ? indep.length / ex.length : null,
    assistedRate: ex.length ? assisted.length / ex.length : null,
    trend,
    confidence,
    targetDifficulty: target,
    ...(lastAt !== undefined ? { lastAt } : {}),
  };
}

function distinctIndependent(ex: readonly SkillEvent[]): number {
  return new Set(ex.filter((e) => e.independent && e.outcome === 1).map((e) => e.ref.exerciseId ?? '')).size;
}

export function estimateProfile(events: readonly SkillEvent[], now: number): SkillEstimate[] {
  return SKILLS.map((s) => estimateSkill(s, events, now));
}
