import type { Attempt, Exercise, Theme } from '../../types/domain';
import { outcomeOf, type ReviewOutcome } from '../scheduling/srs';
import { MASTERY_DISTINCT_EXERCISES } from '../adaptation/skills';

/** Motifs that exist on both sides: the player's missed tactic vs the opponent's allowed one. */
export const TWO_SIDED: readonly Theme[] = ['fork', 'discovered_attack', 'pin', 'overloaded', 'deflection', 'combination'];

/** Same key as the error patterns: the side is part of it only for two-sided motifs. */
export function patternKey(theme: Theme, side?: 'own' | 'opponent'): string {
  return side && TWO_SIDED.includes(theme) ? `${theme}:${side}` : theme;
}

/** Exercises created before motifSide existed were always the player's own tactic. */
export function exercisePatternKey(ex: Pick<Exercise, 'theme' | 'motifSide'>): string {
  return patternKey(ex.theme, ex.motifSide ?? 'own');
}

/** Only the most recent exercises of a pattern describe the current state. */
export const RECENT_EXERCISES = 10;
/** Below this many distinct exercises nothing is concluded (one exercise never moves a recommendation). */
export const MIN_THEME_SAMPLE = 3;
/** Independent rate below which a pattern with enough sample is "struggling". */
export const STRUGGLE_MAX_RATE = 0.5;
/** Mastery: at least MASTERY_DISTINCT_EXERCISES distinct exercises (same bar as the skill profile)… */
export const THEME_MASTERY_RATE = 0.8;
/** …and this many independent solves above the easiest level, so one-move captures alone do not count. */
export const THEME_MASTERY_HARDER = 2;
export const THEME_MASTERY_MIN_DIFFICULTY = 2;

export type ThemeState = 'insufficient' | 'struggling' | 'developing' | 'mastered';

export interface ThemePerformance {
  key: string;
  theme: Theme;
  side?: 'own' | 'opponent';
  /** Distinct exercises with at least one recorded attempt, most recent first, capped at RECENT_EXERCISES. */
  exercises: number;
  independent: number;
  assisted: number;
  failed: number;
  state: ThemeState;
}

/**
 * Exercise evidence per error pattern. Each exercise counts once, with the
 * outcome of its latest recorded attempt (attempts inside the practice window
 * are never stored), so repeating one position cannot inflate the sample.
 */
export function themePerformanceByKey(exercises: readonly Exercise[], attempts: readonly Attempt[]): Map<string, ThemePerformance> {
  const last = new Map<string, Attempt>();
  for (const a of attempts) {
    const prev = last.get(a.exerciseId);
    if (!prev || a.at >= prev.at) last.set(a.exerciseId, a);
  }
  const groups = new Map<string, { ex: Exercise; at: number; outcome: ReviewOutcome }[]>();
  for (const ex of exercises) {
    const a = last.get(ex.id);
    if (!a) continue;
    const key = exercisePatternKey(ex);
    groups.set(key, [...(groups.get(key) ?? []), { ex, at: a.at, outcome: outcomeOf(a.correct, a.hintsUsed, a.revealed) }]);
  }
  const out = new Map<string, ThemePerformance>();
  for (const [key, list] of groups) {
    const recent = [...list].sort((a, b) => b.at - a.at).slice(0, RECENT_EXERCISES);
    const first = recent[0]!.ex;
    const independent = recent.filter((r) => r.outcome === 'independent');
    const assisted = recent.filter((r) => r.outcome === 'assisted').length;
    const harder = independent.filter((r) => r.ex.difficulty >= THEME_MASTERY_MIN_DIFFICULTY).length;
    out.set(key, {
      key,
      theme: first.theme,
      ...(TWO_SIDED.includes(first.theme) ? { side: first.motifSide ?? 'own' } : {}),
      exercises: recent.length,
      independent: independent.length,
      assisted,
      failed: recent.length - independent.length - assisted,
      state: stateOf(recent.length, independent.length, harder),
    });
  }
  return out;
}

export function stateOf(n: number, independent: number, harderIndependent: number): ThemeState {
  if (n < MIN_THEME_SAMPLE) return 'insufficient';
  const rate = independent / n;
  if (rate < STRUGGLE_MAX_RATE) return 'struggling';
  if (n >= MASTERY_DISTINCT_EXERCISES && rate >= THEME_MASTERY_RATE && harderIndependent >= THEME_MASTERY_HARDER) return 'mastered';
  return 'developing';
}

/** Priority multiplier applied to the recent occurrence count of a pattern. */
export const PRIORITY_FACTOR: Record<ThemeState, number> = { insufficient: 1, developing: 1, struggling: 1.5, mastered: 0.5 };

/** "Você resolveu 4 de 10 exercícios recentes deste tema sem ajuda, 3 com dicas." */
export function performanceSentence(p: ThemePerformance | undefined): string {
  if (!p) return 'Ainda não há tentativas em exercícios deste tema.';
  const assisted = p.assisted ? `, ${p.assisted} com dicas` : '';
  const base = `Nos exercícios deste tema, você resolveu ${p.independent} de ${p.exercises} sem ajuda${assisted}.`;
  if (p.state === 'insufficient') return `${base} Ainda são poucos exercícios para tirar conclusões.`;
  if (p.state === 'mastered') return `${base} Nos exercícios o tema está dominado; o foco agora é reconhecê-lo durante a partida.`;
  return base;
}
