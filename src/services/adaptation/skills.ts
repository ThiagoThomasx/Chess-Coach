import type { Attempt, ConfidenceLevel, Exercise, HistoricalDiagnosis, MoveReview, Skill, SkillEstimate, SkillEvent } from '../../types/domain';
import { hasMateFor } from '../analysis/evaluation';
import { gamePhase, settledSwing } from '../chess/material';
import { legalMoveCount } from '../chess/position';
import { enPrise } from '../chess/tactics';
import { detectConcepts, skillOf } from '../pedagogy/concepts';
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

/**
 * States shown to the player: insufficient evidence; developing (initial or
 * consistent evidence, without mastery); consolidated (provisional mastery);
 * needs review (recent drop or clearly below 50%); no recent evidence (only
 * evidence older than 30 days: lack of recent data is not lack of skill).
 */
export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  insufficient: 'Evidências insuficientes',
  initial: 'Em desenvolvimento · evidências iniciais',
  consistent: 'Em desenvolvimento',
  provisional_mastery: 'Consolidada (provisório)',
  needs_review: 'Precisa revisar',
  no_recent: 'Sem evidência recente',
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
    // A forced move, or one inside an already forced mate, measures nothing positive.
    if (o > 0 && !hadRealChoice(r)) continue;
    const ref = { gameId, ply: r.ply };
    const ev = (skill: Skill, outcome: number, weight: number): SkillEvent => ({ skill, at, outcome, weight, independent: true, source: 'game', ref });
    events.push(ev(PHASE_SKILL[gamePhase(r.fenBefore, r.ply)], o, WEIGHTS.gamePhase));

    if (o === 0) {
      const c = detectConcepts(r, replyLines[r.ply] ?? [])[0];
      if (c && c.verified) events.push(ev(skillOf(c), 0, WEIGHTS.gameConcept));
      continue;
    }
    // Successes: only when the position offered a verifiable opportunity or threat.
    if (o === 1) {
      const best = settledSwing(r.fenBefore, r.bestLine, r.color);
      if (best.settled && best.delta >= 2) events.push(ev('tactics', 1, WEIGHTS.gameOpportunity));
      if (r.flags.includes('mate_found')) events.push(ev('patterns', 1, WEIGHTS.gameOpportunity));
      // Defense: the only move that kept a position the mover was not winning.
      if (r.flags.includes('only_move') && r.winBefore < DEFENSE_MAX_WIN) events.push(ev('defense', 1, WEIGHTS.gameOpportunity));
      // Legal-capture threats (SEE > 0) only; geometric attacks by pinned pieces do not count.
      const threatened = enPrise(r.fenBefore, r.color).length > 0;
      const stillThreatened = enPrise(r.fenAfter, r.color).length > 0;
      if (threatened && !stillThreatened) events.push(ev('threats', 1, WEIGHTS.gameOpportunity));
    }
  }
  return capPerSkill(events, MAX_GAME_WEIGHT_PER_SKILL);
}

/** Below this win expectancy (mover POV) holding the position counts as defending. */
const DEFENSE_MAX_WIN = 60;

/** The mover had more than one legal move and was not already mated by force. */
function hadRealChoice(r: MoveReview): boolean {
  const opponent = r.color === 'w' ? 'b' : 'w';
  return legalMoveCount(r.fenBefore) > 1 && !hasMateFor(r.evalBefore, opponent);
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
/** Mastery needs independent successes on this many distinct exercises of the skill… */
export const MASTERY_DISTINCT_EXERCISES = 5;
/** …of which this many at difficulty ≥ MASTERY_MIN_DIFFICULTY (trivial captures alone do not consolidate a skill). */
export const MASTERY_HARD_EXERCISES = 2;
export const MASTERY_MIN_DIFFICULTY = 3;
/** Upper credible bound below which a skill with some evidence is flagged for review (clearly under 50%). */
const WEAK_UPPER_BOUND = 0.5;

/**
 * Effective weight of each event: exponential age decay (unless `decay` is
 * false, for the historical diagnosis), and diminishing weight for repeated
 * attempts at the same exercise (k-th attempt × 1/k), so memorizing one
 * position cannot inflate a skill.
 */
export function effectiveWeights(events: readonly SkillEvent[], now: number, decay = true): number[] {
  const seen = new Map<string, number>();
  return events.map((e) => {
    const age = Math.max(0, now - e.at) / DAY_MS;
    let w = decay ? e.weight * 0.5 ** (age / HALF_LIFE_DAYS) : e.weight;
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
/** Below this many events of one kind in the last STALE_DAYS there is no recent rate, trend or recent drop. */
const MIN_RECENT = 4;
const Z90 = 1.645;

/** Beta(1,1) posterior of the success rate for weighted outcomes, with its 90% interval. */
function posterior(events: readonly SkillEvent[], weights: readonly number[]): { mean: number; interval: [number, number]; evidence: number } {
  const alpha = 1 + events.reduce((s, e, i) => s + (weights[i] ?? 0) * e.outcome, 0);
  const beta = 1 + events.reduce((s, e, i) => s + (weights[i] ?? 0) * (1 - e.outcome), 0);
  const mean = alpha / (alpha + beta);
  const sd = Math.sqrt((alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1)));
  return { mean, interval: [Math.max(0, mean - Z90 * sd), Math.min(1, mean + Z90 * sd)], evidence: weights.reduce((s, w) => s + w, 0) };
}

/**
 * Evidence of one kind for "recent" comparisons (trend, recent drop): direct
 * measurements (exercises, opening drills) when there are any, else game
 * moves. Mixing kinds would make a trend out of the change of kind (old game
 * moves followed by today's exercises read as "up"; Sprint 4.5, N2).
 */
function comparableSeries(events: readonly SkillEvent[]): readonly SkillEvent[] {
  const direct = events.filter((e) => e.source !== 'game');
  return direct.length ? direct : events;
}

function rate(events: readonly SkillEvent[], weights: readonly number[]): number | null {
  const w = weights.reduce((s, x) => s + x, 0);
  return w > 0 ? events.reduce((s, e, i) => s + (weights[i] ?? 0) * e.outcome, 0) / w : null;
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
  // Recent evolution: evidence decays with age.
  const { mean, interval, evidence } = posterior(events, effectiveWeights(events, now));
  // Historical diagnosis: everything, old games included, without decay (decision D-4 B).
  const allTime = posterior(events, effectiveWeights(events, now, false));
  const history: HistoricalDiagnosis = { level: allTime.mean, interval: allTime.interval, evidence: allTime.evidence, events: events.length, from: events[0]?.at ?? 0, to: events[events.length - 1]?.at ?? 0 };

  const series = comparableSeries(events);
  // Repeated attempts at one exercise count 1/k here too (no age decay: these compare within the series).
  const seriesWeights = effectiveWeights(series, now, false);
  const n = series.length;
  // "Recent" is a time window, not a count: only events of the last STALE_DAYS (at most the last
  // RECENT_WINDOW of them), and at least MIN_RECENT of them. Otherwise one recent event would turn
  // weeks- or year-old data into a "recent rate", a trend or even a "needs review" (audit AI-1).
  const inWindow = series.filter((e) => now - e.at <= STALE_DAYS * DAY_MS).length;
  const recentCount = Math.min(RECENT_WINDOW, inWindow);
  const hasRecent = recentCount >= MIN_RECENT;
  const recentRate = hasRecent ? rate(series.slice(n - recentCount), seriesWeights.slice(n - recentCount)) : null;
  // The baseline may be older: a trend compares now with before.
  const prevStart = Math.max(0, n - recentCount - RECENT_WINDOW);
  const previous = series.slice(prevStart, n - recentCount);
  const prevRate = rate(previous, seriesWeights.slice(prevStart, n - recentCount));
  const seriesRate = rate(series, seriesWeights);
  let trend: SkillEstimate['trend'] = 'unknown';
  if (recentRate !== null && prevRate !== null && previous.length >= MIN_RECENT) {
    trend = recentRate - prevRate > 0.1 ? 'up' : recentRate - prevRate < -0.1 ? 'down' : 'stable';
  }
  const ex = events.filter((e) => e.source === 'exercise');
  const indep = ex.filter((e) => e.independent);
  const assisted = ex.filter((e) => !e.independent && e.outcome > 0);
  const lastAt = events[events.length - 1]?.at;

  // Only old evidence (nothing in 30 days): there is no recent measurement, which is not the same as
  // needing review; the historical diagnosis still says what the evidence shows (decision D-4 B).
  const rawEvidence = events.reduce((s, e) => s + e.weight, 0);
  const stale = lastAt !== undefined && now - lastAt > STALE_DAYS * DAY_MS;
  const recentDrop = recentRate !== null && seriesRate !== null && recentRate < seriesRate - 0.2;
  // "Clearly below 50%" asks for review only with a recent sample (any kind, at least MIN_RECENT in the
  // last STALE_DAYS): otherwise one recent event would turn weeks- or months-old failures into "needs
  // review", and solving one exercise would switch "no recent evidence" to "needs review" (audit FA-1).
  const recentSample = events.filter((e) => now - e.at <= STALE_DAYS * DAY_MS).length >= MIN_RECENT;
  const weak = recentSample && interval[1] < WEAK_UPPER_BOUND;
  let confidence: ConfidenceLevel;
  if (stale) confidence = rawEvidence >= 2 ? 'no_recent' : 'insufficient';
  else if (evidence < 2) confidence = 'insufficient';
  else if (evidence < 6) confidence = 'initial';
  else if (recentDrop || weak) confidence = 'needs_review';
  else if (evidence >= 10 && mean >= 0.75 && interval[0] >= 0.6 && distinctIndependent(ex) >= MASTERY_DISTINCT_EXERCISES && distinctIndependent(ex, MASTERY_MIN_DIFFICULTY) >= MASTERY_HARD_EXERCISES) confidence = 'provisional_mastery';
  else confidence = 'consistent';

  return {
    skill,
    level: mean,
    interval,
    evidence,
    events: events.length,
    // Without recent evidence there is no recent rate nor trend to show (old data is in `history`).
    recentRate: confidence === 'no_recent' ? null : recentRate,
    independentRate: ex.length ? indep.length / ex.length : null,
    assistedRate: ex.length ? assisted.length / ex.length : null,
    trend: confidence === 'no_recent' ? 'unknown' : trend,
    confidence,
    targetDifficulty: target,
    ...(lastAt !== undefined ? { lastAt } : {}),
    history,
  };
}

/** With insufficient (or only old, decayed) evidence the recent point estimate is noise: show only the interval. */
export function hasPointEstimate(s: SkillEstimate): boolean {
  return s.level !== null && s.confidence !== 'insufficient' && s.confidence !== 'no_recent';
}

/** The historical diagnosis has enough evidence for a point estimate. */
export function hasHistoricalPoint(h: HistoricalDiagnosis): boolean {
  return h.evidence >= 2;
}

function distinctIndependent(ex: readonly SkillEvent[], minDifficulty = 1): number {
  return new Set(ex.filter((e) => e.independent && e.outcome === 1 && (e.difficulty ?? 1) >= minDifficulty).map((e) => e.ref.exerciseId ?? '')).size;
}

export function estimateProfile(events: readonly SkillEvent[], now: number): SkillEstimate[] {
  return SKILLS.map((s) => estimateSkill(s, events, now));
}
