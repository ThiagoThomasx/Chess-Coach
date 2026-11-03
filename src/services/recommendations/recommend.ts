import type { MoveReview, SkillEstimate, Theme } from '../../types/domain';
import { detectConcepts, THEME_LABEL, isVerifiedConcept } from '../pedagogy/concepts';
import { SKILL_LABEL } from '../adaptation/skills';

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
}

export interface AnalyzedGameInput {
  gameId: string;
  userColor?: 'w' | 'b';
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

/** Motifs that exist on both sides: the player's missed tactic vs the opponent's allowed one. */
const TWO_SIDED: readonly Theme[] = ['fork', 'discovered_attack', 'pin', 'overloaded', 'deflection', 'combination'];

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
      const key = side ? `${c.theme}:${side}` : c.theme;
      const cur = map.get(key) ?? { key, theme: c.theme, ...(side ? { side } : {}), label: patternLabel(c.theme, side), refs: [] };
      map.set(key, { ...cur, refs: [...cur.refs, { gameId: g.gameId, ply: r.ply, san: r.san }] });
    }
  }
  return map;
}

/**
 * "Seu próximo treino": only emits a theme recommendation when the same
 * verified pattern appears at least twice in the history.
 */
export function nextTraining(input: { games: readonly AnalyzedGameInput[]; dueReviews: number; totalGames: number; profile: readonly SkillEstimate[] }): Recommendation {
  if (input.totalGames === 0) {
    return { kind: 'import', title: 'Importe sua primeira partida', message: 'Importe um arquivo PGN para que o ChessQuest analise seus lances e monte um plano de treino.', evidence: [], action: { label: 'Importar partidas', to: '/games' } };
  }
  const top = [...errorThemes(input.games).values()].filter((p) => p.refs.length >= MIN_OCCURRENCES).sort((a, b) => b.refs.length - a.refs.length)[0];
  if (top) {
    return { kind: 'theme', title: top.label, message: adviceFor(top), theme: top.theme, evidence: top.refs, action: { label: 'Treinar este tema', to: `/train?theme=${top.theme}` } };
  }
  if (input.dueReviews > 0) {
    return { kind: 'reviews', title: 'Revisões pendentes', message: `Você tem ${input.dueReviews} exercício(s) para revisar hoje.`, evidence: [], action: { label: 'Revisar agora', to: '/train?filter=due' } };
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
    };
  }
  const weak = input.profile.filter((p) => p.confidence === 'insufficient');
  if (input.games.length === 0) {
    return { kind: 'explore', title: 'Analise uma partida', message: 'Você já importou partidas. Analise uma delas para identificar seus erros e gerar exercícios.', evidence: [], action: { label: 'Ver partidas', to: '/games' } };
  }
  return {
    kind: 'explore',
    title: 'Ampliar o diagnóstico',
    message: weak.length
      ? `Ainda há poucas evidências em: ${weak.map((w) => SKILL_LABEL[w.skill]).join(', ')}. Resolva exercícios ou analise mais partidas para refinar o perfil.`
      : 'Nenhum padrão de erro recorrente foi encontrado até agora. Continue analisando partidas e resolvendo exercícios.',
    evidence: [],
    action: { label: 'Ir para o treino', to: '/train' },
  };
}
