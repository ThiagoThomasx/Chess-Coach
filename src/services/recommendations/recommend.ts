import type { MoveReview, SkillEstimate, Theme } from '../../types/domain';
import { detectConcepts, THEME_LABEL, isVerifiedConcept } from '../pedagogy/concepts';
import { SKILL_LABEL } from '../adaptation/skills';

export interface EvidenceRef {
  gameId: string;
  ply: number;
  san: string;
}

export interface Recommendation {
  kind: 'theme' | 'reviews' | 'explore' | 'import';
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

/** Counts verified error themes on the user's moves, with references to each position. */
export function errorThemes(games: readonly AnalyzedGameInput[]): Map<Theme, EvidenceRef[]> {
  const map = new Map<Theme, EvidenceRef[]>();
  for (const g of games) {
    if (!g.userColor) continue;
    for (const r of g.reviews) {
      if (r.color !== g.userColor) continue;
      if (r.classification !== 'mistake' && r.classification !== 'blunder' && r.classification !== 'inaccuracy') continue;
      const c = detectConcepts(r, g.replyLines[r.ply] ?? [])[0];
      if (!c || !isVerifiedConcept(c)) continue;
      const list = map.get(c.theme) ?? [];
      map.set(c.theme, [...list, { gameId: g.gameId, ply: r.ply, san: r.san }]);
    }
  }
  return map;
}

/**
 * "Seu próximo treino": only emits a theme recommendation when the same
 * verified theme appears at least twice in the history.
 */
export function nextTraining(input: { games: readonly AnalyzedGameInput[]; dueReviews: number; totalGames: number; profile: readonly SkillEstimate[] }): Recommendation {
  if (input.totalGames === 0) {
    return { kind: 'import', title: 'Importe sua primeira partida', message: 'Importe um arquivo PGN para que o ChessQuest analise seus lances e monte um plano de treino.', evidence: [], action: { label: 'Importar partidas', to: '/games' } };
  }
  const themes = [...errorThemes(input.games).entries()].filter(([, refs]) => refs.length >= MIN_OCCURRENCES).sort((a, b) => b[1].length - a[1].length);
  const top = themes[0];
  if (top) {
    const [theme, refs] = top;
    const template = THEME_ADVICE[theme] ?? `O tema "${THEME_LABEL[theme]}" apareceu em {n} posições recentes.`;
    return { kind: 'theme', title: THEME_LABEL[theme], message: template.replace('{n}', String(refs.length)), theme, evidence: refs, action: { label: 'Treinar este tema', to: `/train?theme=${theme}` } };
  }
  if (input.dueReviews > 0) {
    return { kind: 'reviews', title: 'Revisões pendentes', message: `Você tem ${input.dueReviews} exercício(s) para revisar hoje.`, evidence: [], action: { label: 'Revisar agora', to: '/train?filter=due' } };
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
