import type { Attempt, Exercise, MoveReview, Skill, SkillEstimate, Theme } from '../../types/domain';
import { detectConcepts, THEME_LABEL, isVerifiedConcept } from '../pedagogy/concepts';
import { SKILL_LABEL } from '../adaptation/skills';
import { patternKey, performanceSentence, PRIORITY_FACTOR, themePerformanceByKey, TWO_SIDED, type ThemePerformance } from './themeEvidence';

export interface EvidenceRef {
  gameId: string;
  ply: number;
  san: string;
}

export interface Recommendation {
  kind: 'theme' | 'reviews' | 'skill' | 'explore' | 'import';
  title: string;
  message: string;
  theme?: Theme;
  evidence: EvidenceRef[];
  action: { label: string; to: string };
  /** What a guided session should prioritize after due reviews. */
  focus?: { key: string; theme: Theme } | { skill: Skill };
  /** Exercise evidence behind a theme recommendation. */
  performance?: ThemePerformance;
}

export interface AnalyzedGameInput {
  gameId: string;
  userColor?: 'w' | 'b';
  /** Reliable game date (see gameTime); absent when the PGN has none, and then the game counts as oldest. */
  at?: number;
  /** Tie-break between games of the same date. */
  importedAt?: number;
  reviews: MoveReview[];
  replyLines: Record<number, string[]>;
}

const THEME_ADVICE: Partial<Record<Theme, string>> = {
  hanging_piece: 'Você deixou peças desprotegidas em {n} posições recentes. Revise as posições marcadas e pratique exercícios de identificação de ameaças.',
  ignored_threat: 'Em {n} posições recentes, uma ameaça do adversário ficou sem resposta. Treine perguntar "o que meu adversário quer?" a cada lance.',
  removed_defender: 'Em {n} posições recentes, você moveu uma peça que defendia outra. Pratique verificar as funções defensivas antes de mover.',
  missed_capture: 'Você deixou passar capturas vantajosas em {n} posições. Pratique a varredura de capturas disponíveis.',
  fork: 'Houve {n} ataques duplos não aproveitados. Pratique exercícios de garfo e ataque duplo.',
  missed_check: 'Em {n} posições, um xeque levava a ganho de material. Treine lances forçantes.',
  missed_mate: 'Você deixou escapar mate em {n} posições. Pratique padrões de mate.',
  allowed_mate: 'Em {n} posições, um lance permitiu mate forçado. Revise a segurança do rei.',
};

const MIN_OCCURRENCES = 2;
/** Recurring patterns are counted in the most recent analyzed games only; older games stay in the history views. */
export const RECENT_GAMES = 10;
/** From this many due reviews on, reviews come first (half the default daily goal of 10). */
export const DUE_FIRST_THRESHOLD = 5;

const OPPONENT_ADVICE: Partial<Record<Theme, string>> = {
  fork: 'Em {n} posições, seu lance permitiu um ataque duplo do adversário. Antes de cada lance, procure as casas de onde uma peça adversária atingiria duas peças suas ou o rei.',
  discovered_attack: 'Em {n} posições, seu lance permitiu um ataque descoberto. Observe peças adversárias alinhadas, com uma peça de longo alcance por trás.',
  pin: 'Em {n} posições, uma cravada do adversário ganhou material. Não conte peças cravadas como defensoras.',
};

/** A recurring error: a verified theme on one side (the player's own tactic or the opponent's). */
export interface ErrorPattern {
  key: string;
  theme: Theme;
  side?: 'own' | 'opponent';
  label: string;
  refs: EvidenceRef[];
}

export function patternLabel(theme: Theme, side?: 'own' | 'opponent'): string {
  if (!TWO_SIDED.includes(theme)) return THEME_LABEL[theme];
  return side === 'own' ? `${THEME_LABEL[theme]} não aproveitado(a)` : `${THEME_LABEL[theme]} do adversário`;
}

function adviceFor(p: ErrorPattern): string {
  const n = String(p.refs.length);
  const template = p.side === 'opponent' && TWO_SIDED.includes(p.theme) ? OPPONENT_ADVICE[p.theme] ?? `Em {n} posições, seu lance permitiu ao adversário: ${p.label.toLowerCase()}.` : THEME_ADVICE[p.theme] ?? `O tema "${p.label}" apareceu em {n} posições recentes.`;
  return template.replace('{n}', n);
}

/**
 * Counts verified error patterns on the user's moves, with references to each
 * position. The side is part of the key: allowing a fork and missing one are
 * different weaknesses with different advice.
 */
export function errorThemes(games: readonly AnalyzedGameInput[]): Map<string, ErrorPattern> {
  const map = new Map<string, ErrorPattern>();
  for (const g of games) {
    if (!g.userColor) continue;
    for (const r of g.reviews) {
      if (r.color !== g.userColor) continue;
      if (r.classification !== 'mistake' && r.classification !== 'blunder' && r.classification !== 'inaccuracy') continue;
      const c = detectConcepts(r, g.replyLines[r.ply] ?? [])[0];
      if (!c || !isVerifiedConcept(c)) continue;
      const side = TWO_SIDED.includes(c.theme) ? c.side : undefined;
      const key = patternKey(c.theme, side);
      const cur = map.get(key) ?? { key, theme: c.theme, ...(side ? { side } : {}), label: patternLabel(c.theme, side), refs: [] };
      map.set(key, { ...cur, refs: [...cur.refs, { gameId: g.gameId, ply: r.ply, san: r.san }] });
    }
  }
  return map;
}

/** Chronological order; a game without a reliable date is older than every dated one. */
function byDate(a: AnalyzedGameInput, b: AnalyzedGameInput): number {
  if (a.at === undefined && b.at === undefined) return 0;
  if (a.at === undefined) return -1;
  if (b.at === undefined) return 1;
  return a.at - b.at;
}

/**
 * The RECENT_GAMES most recent analyzed games. Games without a reliable date
 * sort before every dated game (by import time among themselves), so they
 * only fill the window when there are not enough dated games.
 */
export function recentGames(games: readonly AnalyzedGameInput[], size = RECENT_GAMES): AnalyzedGameInput[] {
  return games
    .map((g, i) => ({ g, i }))
    .sort((a, b) => byDate(a.g, b.g) || (a.g.importedAt ?? 0) - (b.g.importedAt ?? 0) || a.i - b.i)
    .slice(-size)
    .map((x) => x.g);
}

export interface RankedPattern extends ErrorPattern {
  performance?: ThemePerformance;
  score: number;
}

/**
 * Recurring patterns of the recent window (≥ MIN_OCCURRENCES), ranked by
 * occurrences × the exercise-performance factor: a pattern the player already
 * solves in exercises loses priority, one they keep failing gains it.
 */
export function rankPatterns(games: readonly AnalyzedGameInput[], perf: ReadonlyMap<string, ThemePerformance>): RankedPattern[] {
  return [...errorThemes(recentGames(games)).values()]
    .filter((p) => p.refs.length >= MIN_OCCURRENCES)
    .map((p) => {
      const performance = perf.get(p.key);
      return { ...p, ...(performance ? { performance } : {}), score: p.refs.length * PRIORITY_FACTOR[performance?.state ?? 'insufficient'] };
    })
    .sort((a, b) => b.score - a.score || b.refs.length - a.refs.length);
}

const dueSentence = (due: number): string => (due > 0 ? ` Você tem ${due} revisão(ões) vencida(s).` : '');

export interface TrainingInput {
  games: readonly AnalyzedGameInput[];
  dueReviews: number;
  totalGames: number;
  profile: readonly SkillEstimate[];
  exercises?: readonly Exercise[];
  attempts?: readonly Attempt[];
}

/**
 * "Seu próximo treino", in priority order:
 * 1. many due reviews (≥ DUE_FIRST_THRESHOLD);
 * 2. the top recurring pattern of the recent games, weighted by exercise performance
 *    (a mastered pattern yields to any due review);
 * 3. due reviews;
 * 4. a pattern the player keeps failing in exercises;
 * 5. a competence flagged for review; 6. broaden the diagnosis.
 */
export function nextTraining(input: TrainingInput): Recommendation {
  if (input.totalGames === 0) {
    return { kind: 'import', title: 'Importe sua primeira partida', message: 'Importe um arquivo PGN para que o ChessQuest analise seus lances e monte um plano de treino.', evidence: [], action: { label: 'Importar partidas', to: '/games' } };
  }
  const perf = themePerformanceByKey(input.exercises ?? [], input.attempts ?? []);
  const ranked = rankPatterns(input.games, perf);
  const top = ranked[0];
  const due = input.dueReviews;
  if (due >= DUE_FIRST_THRESHOLD || (due > 0 && top?.performance?.state === 'mastered')) {
    // The session's focus after the reviews: the best-ranked pattern not already mastered.
    const next = ranked.find((p) => p.performance?.state !== 'mastered');
    const after = next ? ` Depois delas, o foco é: ${next.label.toLowerCase()}.` : '';
    return { kind: 'reviews', title: 'Revisões pendentes', message: `Você tem ${due} exercício(s) para revisar hoje.${after}`, evidence: [], action: { label: 'Revisar agora', to: '/train?filter=due' }, ...(next ? { focus: { key: next.key, theme: next.theme } } : {}) };
  }
  if (top) {
    const window = recentGames(input.games);
    const undated = window.filter((g) => g.at === undefined).length;
    const undatedNote = undated > 0 ? ` ${undated} delas sem data válida no PGN (contadas como as mais antigas).` : '';
    const message = `${adviceFor(top)} Contagem nas últimas ${window.length} partida(s) analisada(s).${undatedNote} ${performanceSentence(top.performance)}${dueSentence(due)}`;
    return {
      kind: 'theme',
      title: top.label,
      message,
      theme: top.theme,
      evidence: top.refs,
      action: { label: 'Treinar este tema', to: `/train?theme=${top.theme}` },
      focus: { key: top.key, theme: top.theme },
      ...(top.performance ? { performance: top.performance } : {}),
    };
  }
  if (due > 0) {
    return { kind: 'reviews', title: 'Revisões pendentes', message: `Você tem ${due} exercício(s) para revisar hoje.`, evidence: [], action: { label: 'Revisar agora', to: '/train?filter=due' } };
  }
  const weakest = [...perf.values()].filter((p) => p.state === 'struggling').sort((a, b) => a.independent / a.exercises - b.independent / b.exercises || b.exercises - a.exercises)[0];
  if (weakest) {
    const label = patternLabel(weakest.theme, weakest.side);
    return {
      kind: 'theme',
      title: label,
      message: `${performanceSentence(weakest)} Vale reforçar este tema antes de avançar.`,
      theme: weakest.theme,
      evidence: [],
      action: { label: 'Treinar este tema', to: `/train?theme=${weakest.theme}` },
      focus: { key: weakest.key, theme: weakest.theme },
      performance: weakest,
    };
  }
  // A competence flagged for review, with the numbers that flagged it.
  const review = input.profile.filter((p) => p.confidence === 'needs_review' && p.interval).sort((a, b) => (a.recentRate ?? a.level ?? 1) - (b.recentRate ?? b.level ?? 1))[0];
  if (review?.interval) {
    const recent = review.recentRate !== null ? `taxa recente ${Math.round(review.recentRate * 100)}%` : '';
    const range = `estimativa entre ${Math.round(review.interval[0] * 100)}% e ${Math.round(review.interval[1] * 100)}%`;
    return {
      kind: 'skill',
      title: `Revisar: ${SKILL_LABEL[review.skill]}`,
      message: `${SKILL_LABEL[review.skill]} precisa de revisão (${[recent, range].filter(Boolean).join('; ')}, em ${review.events} evidência(s)). Treine exercícios desta competência.`,
      evidence: [],
      action: { label: 'Treinar esta competência', to: `/train?skill=${review.skill}` },
      focus: { skill: review.skill },
    };
  }
  const weak = input.profile.filter((p) => p.confidence === 'insufficient');
  // Only old evidence is not a weakness: it asks for a fresh measurement, not for review (decision D-4 B).
  const noRecent = input.profile.filter((p) => p.confidence === 'no_recent');
  if (input.games.length === 0) {
    return { kind: 'explore', title: 'Analise uma partida', message: 'Você já importou partidas. Analise uma delas para identificar seus erros e gerar exercícios.', evidence: [], action: { label: 'Ver partidas', to: '/games' } };
  }
  return {
    kind: 'explore',
    title: 'Ampliar o diagnóstico',
    message:
      [
        weak.length ? `Ainda há poucas evidências em: ${weak.map((w) => SKILL_LABEL[w.skill]).join(', ')}. Resolva exercícios ou analise mais partidas para refinar o perfil.` : '',
        noRecent.length ? `Sem evidência recente em: ${noRecent.map((w) => SKILL_LABEL[w.skill]).join(', ')}. O diagnóstico histórico continua no perfil; resolva exercícios dessas competências para medir como você está agora.` : '',
      ]
        .filter(Boolean)
        .join(' ') || 'Nenhum padrão de erro recorrente foi encontrado até agora. Continue analisando partidas e resolvendo exercícios.',
    evidence: [],
    action: { label: 'Ir para o treino', to: '/train' },
  };
}
