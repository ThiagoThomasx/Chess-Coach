import type { MoveReview, Skill, Theme } from '../../types/domain';
import { CLASS_LABEL } from '../analysis/classify';
import { formatScore } from '../analysis/evaluation';
import { PIECE_NAME_PT } from '../chess/material';
import { detectConcepts, isVerifiedConcept, THEME_LABEL, THEME_SKILL, type Concept } from './concepts';

export interface Explanation {
  title: string;
  whatHappened: string;
  problem?: string;
  betterAlternative?: string;
  why?: string;
  consequence?: string;
  concept?: string;
  howToAvoid?: string;
  theme?: Theme;
  skill?: Skill;
  /** "verified": backed by board facts + engine lines; "limited": only the engine's objective evaluation. */
  confidence: 'verified' | 'limited';
  concepts: Concept[];
}

const piece = (t?: string): string => (t ? PIECE_NAME_PT[t as keyof typeof PIECE_NAME_PT] ?? 'peça' : 'peça');
const line = (sans?: string[], n = 4): string => (sans && sans.length ? sans.slice(0, n).join(' ') : '');

type TemplateFn = (r: MoveReview, c: Concept) => Omit<Explanation, 'title' | 'whatHappened' | 'confidence' | 'concepts'>;

/** Templates per theme. Each one only states facts present in the evidence. */
const TEMPLATES: Record<Theme, TemplateFn> = {
  allowed_mate: (_r, c) => ({
    problem: `Este lance permitiu um mate forçado${c.evidence.mateIn ? ` em ${c.evidence.mateIn}` : ''}.`,
    consequence: c.evidence.replySan?.length ? `Linha do motor: ${line(c.evidence.replySan, 6)}.` : undefined,
    concept: 'Segurança do rei: antes de cada lance, verifique xeques, capturas e ameaças do adversário contra o seu rei.',
    howToAvoid: 'Pergunte-se: "depois deste lance, quais xeques o adversário tem?" e calcule cada um.',
  }),
  missed_mate: (_r, c) => ({
    problem: `Havia um mate forçado${c.evidence.mateIn ? ` em ${c.evidence.mateIn}` : ''} e ele não foi executado.`,
    why: c.evidence.bestSan?.length ? `A sequência encontrada pelo motor foi ${line(c.evidence.bestSan, 6)}.` : undefined,
    concept: 'Padrões de mate: lances forçantes (xeques) devem ser examinados primeiro.',
    howToAvoid: 'Quando o rei adversário estiver exposto, calcule todos os xeques antes de escolher um lance tranquilo.',
  }),
  hanging_piece: (r, c) => ({
    problem:
      c.evidence.movedPiece !== undefined
        ? `O ${piece(c.evidence.pieceType)} foi para ${c.evidence.square}, onde está atacado e sem defesa suficiente.`
        : `Depois do lance, seu ${piece(c.evidence.pieceType)} em ${c.evidence.square} ficou atacado e sem defesa suficiente.`,
    consequence: `O adversário pode responder ${c.evidence.capturingMoveSan}; na linha do motor (${line(c.evidence.replySan)}) você perde cerca de ${Math.abs(c.evidence.materialDelta ?? 0)} ponto(s) de material.`,
    concept: 'Peças desprotegidas: uma peça atacada precisa de defensores suficientes ou deve sair do ataque.',
    howToAvoid: `Antes de jogar, confira se a casa de destino é atacada${r.san.includes('x') ? ' e se a recaptura é favorável' : ''}.`,
  }),
  ignored_threat: (_r, c) => ({
    problem: `Seu ${piece(c.evidence.pieceType)} em ${c.evidence.square} já estava atacado antes do lance, e a ameaça não foi resolvida.`,
    consequence: `O adversário pode jogar ${c.evidence.capturingMoveSan}; linha do motor: ${line(c.evidence.replySan)}.`,
    concept: 'Identificação de ameaças: a cada lance do adversário, pergunte "o que ele quer fazer agora?".',
    howToAvoid: 'Antes de executar seu plano, liste as peças suas que estão atacadas e quantas vezes estão defendidas.',
  }),
  removed_defender: (r, c) => ({
    problem: `A peça movida (${r.san}) defendia seu ${piece(c.evidence.pieceType)} em ${c.evidence.square}. Sem ela, essa peça ficou vulnerável.`,
    consequence: `O adversário pode jogar ${c.evidence.capturingMoveSan}; linha do motor: ${line(c.evidence.replySan)}.`,
    concept: 'Peças com função defensiva: mover um defensor pode deixar outra peça desprotegida.',
    howToAvoid: 'Antes de mover uma peça, verifique quais outras peças dependem da proteção dela.',
  }),
  missed_capture: (_r, c) => ({
    problem: `Havia uma captura vantajosa em ${c.evidence.square}.`,
    why: `Na linha do motor (${line(c.evidence.bestSan)}) você ganha cerca de ${c.evidence.materialDelta} ponto(s) de material.`,
    concept: 'Capturas disponíveis: sempre verifique se alguma peça adversária está desprotegida.',
    howToAvoid: 'Faça uma varredura de "xeques, capturas e ameaças" antes de cada lance.',
  }),
  fork: (_r, c) => ({
    problem: `Havia um ataque duplo disponível contra ${c.evidence.targets?.map((t) => `${piece(t.type)} em ${t.square}`).join(' e ')}.`,
    why: `Linha do motor: ${line(c.evidence.bestSan)}, ganhando cerca de ${c.evidence.materialDelta} ponto(s) de material.`,
    concept: 'Ataque duplo: uma peça que ataca dois alvos ao mesmo tempo costuma ganhar material, pois o adversário só pode salvar um.',
    howToAvoid: 'Procure casas de onde uma peça sua ataque duas peças adversárias valiosas ou o rei.',
  }),
  missed_check: (_r, c) => ({
    problem: 'Havia um xeque que levava a ganho de material.',
    why: `Linha do motor: ${line(c.evidence.bestSan)}, ganhando cerca de ${c.evidence.materialDelta} ponto(s).`,
    concept: 'Lances forçantes: xeques limitam as respostas do adversário e facilitam o cálculo.',
    howToAvoid: 'Considere todos os xeques disponíveis, mesmo os que parecem não funcionar à primeira vista.',
  }),
  mate_threat: (_r, c) => ({
    problem: 'O adversário tinha mate forçado nesta posição; era preciso encontrar a melhor defesa possível.',
    why: c.evidence.bestSan?.length ? `A defesa mais resistente segundo o motor começava com ${c.evidence.bestSan[0]}.` : undefined,
    concept: 'Defesa: em posições críticas, priorize lances que neutralizem a ameaça principal.',
    howToAvoid: 'Identifique as casas fracas ao redor do seu rei antes de iniciar ações em outra parte do tabuleiro.',
  }),
  defense: (_r, c) => ({
    problem: 'A posição exigia um lance defensivo preciso.',
    why: c.evidence.bestSan?.length ? `O motor indicava ${c.evidence.bestSan[0]} como a defesa mais sólida.` : undefined,
    concept: 'Defesa ativa: às vezes a melhor defesa é uma contra-ameaça.',
    howToAvoid: 'Compare as ameaças dos dois lados antes de decidir entre defender e atacar.',
  }),
  positional: (_r, c) => ({
    problem: 'O motor não encontrou uma perda imediata de material; a diferença é de natureza posicional ou de cálculo mais longo.',
    why: c.evidence.bestSan?.length ? `A continuação preferida pelo motor foi ${line(c.evidence.bestSan)}.` : undefined,
    concept: 'Avaliação posicional: atividade das peças, estrutura de peões e segurança do rei.',
    howToAvoid: 'Ao escolher entre lances tranquilos, compare qual deles melhora sua pior peça.',
  }),
  opening: (_r, c) => ({
    problem: 'Este lance de abertura piorou significativamente a posição segundo o motor.',
    why: c.evidence.bestSan?.length ? `A continuação preferida pelo motor foi ${line(c.evidence.bestSan)}.` : undefined,
    concept: 'Princípios de abertura: desenvolvimento, controle do centro e segurança do rei.',
    howToAvoid: 'Revise a linha na biblioteca de aberturas e pratique a sequência correta.',
  }),
  endgame: (_r, c) => ({
    problem: 'Neste final, o lance escolhido perdeu parte significativa da avaliação.',
    why: c.evidence.bestSan?.length ? `A continuação preferida pelo motor foi ${line(c.evidence.bestSan)}.` : undefined,
    concept: 'Técnica de finais: atividade do rei e peões passados costumam ser decisivos.',
    howToAvoid: 'Em finais, calcule corridas de peões e considere ativar o rei.',
  }),
};

/** Produces a structured explanation for a reviewed move. */
export function explainMove(review: MoveReview, replyLine: readonly string[]): Explanation {
  const label = CLASS_LABEL[review.classification];
  const whatHappened = `Você jogou ${review.san}. Avaliação: ${formatScore(review.evalBefore)} antes (com o melhor lance) → ${formatScore(review.evalAfter)} depois.`;
  if (review.classification === 'inconclusive') {
    return { title: label, whatHappened, problem: review.reason ?? 'Dados insuficientes para uma classificação confiável.', confidence: 'limited', concepts: [] };
  }
  if (review.classification === 'best' || review.classification === 'excellent' || review.classification === 'good') {
    return {
      title: label,
      whatHappened,
      ...(review.classification !== 'best' && review.bestMoveSan ? { betterAlternative: `O motor preferia ${review.bestMoveSan}, mas a diferença é pequena.` } : {}),
      confidence: 'verified',
      concepts: [],
    };
  }
  const concepts = detectConcepts(review, replyLine);
  const main = concepts[0];
  const betterAlternative = review.bestMoveSan ? `Melhor era ${review.bestMoveSan}.` : undefined;
  if (!main) return { title: label, whatHappened, ...(betterAlternative ? { betterAlternative } : {}), confidence: 'limited', concepts };
  const body = TEMPLATES[main.theme](review, main);
  return {
    title: `${label} · ${THEME_LABEL[main.theme]}`,
    whatHappened,
    ...(betterAlternative ? { betterAlternative } : {}),
    ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    theme: main.theme,
    skill: THEME_SKILL[main.theme],
    confidence: isVerifiedConcept(main) ? 'verified' : 'limited',
    concepts,
  };
}
