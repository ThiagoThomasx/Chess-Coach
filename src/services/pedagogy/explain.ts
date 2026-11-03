import type { MoveReview, Skill, Theme } from '../../types/domain';
import { CLASS_LABEL } from '../analysis/classify';
import { formatScore } from '../analysis/evaluation';
import { PIECE_NAME_PT } from '../chess/material';
import { detectConcepts, THEME_LABEL, THEME_SKILL, type Concept, type ConceptCategory } from './concepts';

/**
 * Structured explanation. Each field answers one pedagogical question:
 * whatHappened (1), betterAlternative (2), why (3), consequence (4),
 * concept (5), recognize (6). Fields are omitted when unsupported by evidence.
 */
export interface Explanation {
  title: string;
  category: ConceptCategory | 'good' | 'inconclusive';
  whatHappened: string;
  betterAlternative?: string;
  why?: string;
  consequence?: string;
  concept?: string;
  recognize?: string;
  theme?: Theme;
  skill?: Skill;
  /** "verified": backed by legal-move facts and settled engine lines; "limited": engine evaluation only. */
  confidence: 'verified' | 'limited';
  concepts: Concept[];
}

const piece = (t?: string): string => (t ? (PIECE_NAME_PT[t as keyof typeof PIECE_NAME_PT] ?? 'peça') : 'peça');
/** Grammatical gender of the piece noun: torre, dama (and the generic "peça") are feminine. */
const isFem = (t?: string): boolean => !t || t === 'r' || t === 'q' || !(t in PIECE_NAME_PT);
/** Word ending agreeing with the piece: agree('r', 'capturad') → 'capturada'. */
const agree = (t: string | undefined, stem: string): string => `${stem}${isFem(t) ? 'a' : 'o'}`;
const the = (t?: string): string => `${isFem(t) ? 'a' : 'o'} ${piece(t)}`;
const your = (t?: string): string => `${isFem(t) ? 'sua' : 'seu'} ${piece(t)}`;
const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const line = (sans?: string[], n = 5): string => (sans && sans.length ? sans.slice(0, n).join(' ') : '');
const pts = (d?: number): string => `${Math.abs(d ?? 0)} ponto(s) de material`;
const list = (ts?: { square: string; type: string }[]): string => (ts ?? []).map((t) => `${the(t.type)} em ${t.square}`).join(' e ');
const lossNote = (d?: number): string => (d !== undefined && d < 0 ? ` (perda de ${pts(d)})` : '');

/**
 * Shared opening of the fallback templates: says what was (not) found without
 * denying tactics the detector cannot see, and states what the line measured.
 */
function fallbackFact(c: Concept, situation: string): string {
  const measured =
    c.evidence.lineSettled === false
      ? 'a linha de resposta do motor não chega a uma posição estável no trecho medido, por isso o material não foi verificado'
      : `nas linhas medidas (${c.evidence.linePlies ?? 0} meias-jogadas) o saldo de material não muda, e a diferença vem da avaliação do motor`;
  return `${situation} O ChessQuest não reconheceu um padrão tático simples neste lance; ${measured}.`;
}

type Body = Pick<Explanation, 'why' | 'consequence' | 'concept' | 'recognize'> & { fact?: string };
type Template = (r: MoveReview, c: Concept) => Body;

/**
 * Templates only interpolate evidence computed by detectConcepts. Material
 * amounts are quoted only when the engine line was measured at a settled point.
 * No template speculates about the player's state of mind.
 */
const TEMPLATES: Record<Theme, Template> = {
  allowed_mate: (_r, c) => ({
    fact: `Depois deste lance, o adversário tem mate forçado${c.evidence.mateIn ? ` em ${c.evidence.mateIn}` : ''}${c.evidence.mateMoveSan ? ` — imediatamente com ${c.evidence.mateMoveSan}` : ''}.`,
    consequence: c.evidence.replySan?.length ? `Linha do motor: ${line(c.evidence.replySan, 7)}.` : undefined,
    concept: c.evidence.mateThreatBefore ? 'Ameaça de mate: o adversário já ameaçava mate em 1 antes do lance, e a ameaça continuou de pé.' : 'Segurança do rei: lances que abrem linhas ou retiram defensores podem permitir mate.',
    recognize: 'Antes de cada lance, verifique quais xeques o adversário terá depois dele, começando pelos que atingem casas sem defesa ao redor do seu rei.',
  }),
  missed_mate: (_r, c) => ({
    fact: `Havia mate forçado${c.evidence.mateIn ? ` em ${c.evidence.mateIn}` : ''} nesta posição.`,
    why: c.evidence.mateMoveSan ? `${c.evidence.mateMoveSan} dava mate imediatamente.` : c.evidence.bestSan?.length ? `Sequência do motor: ${line(c.evidence.bestSan, 7)}.` : undefined,
    concept: 'Lances forçantes: xeques e capturas restringem as respostas e são os primeiros a calcular.',
    recognize: 'Quando o rei adversário tem poucas casas livres, examine todos os xeques disponíveis antes de qualquer lance tranquilo.',
  }),
  losing_capture: (r, c) => ({
    fact: `A captura ${r.san} perde material: depois das recapturas legais o saldo é ${c.evidence.see} ponto(s) para você.`,
    consequence: `Linha do motor: ${line(c.evidence.replySan)} (perda de ${pts(c.evidence.materialDelta)}).`,
    concept: 'Troca estática: conte atacantes e defensores da casa e compare o valor das peças envolvidas antes de capturar.',
    recognize: 'Uma peça "de graça" defendida por um peão ou por várias peças costuma ser uma captura perdedora para uma peça mais valiosa.',
  }),
  hanging_piece: (_r, c) => ({
    fact:
      c.evidence.movedPiece !== undefined
        ? `${cap(the(c.evidence.pieceType))} foi para ${c.evidence.square}, onde o adversário pode ${agree(c.evidence.pieceType, 'capturá-l')} legalmente com ganho de material.`
        : `Depois do lance, ${your(c.evidence.pieceType)} em ${c.evidence.square} pode ser ${agree(c.evidence.pieceType, 'capturad')} legalmente com ganho de material.`,
    consequence: c.evidence.materialDelta !== undefined ? `O adversário responde ${c.evidence.capturingMoveSan}; na linha do motor (${line(c.evidence.replySan)}) você perde ${pts(c.evidence.materialDelta)}.` : undefined,
    concept: 'Peças desprotegidas: uma peça só está segura se as recapturas legais compensam a captura.',
    recognize: 'Ao escolher a casa de destino, conte quantas peças adversárias podem capturar ali e quantas suas podem recapturar — peças cravadas não contam como defensoras.',
  }),
  ignored_threat: (_r, c) => ({
    fact: `${cap(your(c.evidence.pieceType))} em ${c.evidence.square} já podia ser ${agree(c.evidence.pieceType, 'capturad')} com ganho antes do lance, e o lance não mudou isso.`,
    consequence: `O adversário pode jogar ${c.evidence.capturingMoveSan}; linha do motor: ${line(c.evidence.replySan)}.`,
    concept: 'Identificação de ameaças: o lance anterior do adversário pode ter criado uma ameaça que exige resposta.',
    recognize: 'Depois de cada lance do adversário, liste as capturas que ele passou a ter e quais delas ganham material.',
  }),
  removed_defender: (r, c) => ({
    fact: `A peça movida (${r.san}) podia recapturar em ${c.evidence.square}. Sem ela, ${your(c.evidence.pieceType)} ficou sem defesa suficiente.`,
    consequence: `O adversário pode jogar ${c.evidence.capturingMoveSan}; linha do motor: ${line(c.evidence.replySan)}.`,
    concept: 'Funções defensivas: uma peça pode estar protegendo outra; ao movê-la, essa proteção desaparece.',
    recognize: 'Antes de mover uma peça, verifique quais casas ela protege e se alguma peça sua depende disso.',
  }),
  fork: (_r, c) =>
    c.side === 'opponent'
      ? {
          fact: `O lance permitiu um ataque duplo: ${c.evidence.capturingMoveSan} ataca ${list(c.evidence.targets)}.`,
          consequence: `Linha do motor: ${line(c.evidence.replySan)}${c.evidence.materialDelta !== undefined ? ` (perda de ${pts(c.evidence.materialDelta)})` : ''}.`,
          concept: 'Ataque duplo: uma peça que ataca dois alvos ao mesmo tempo costuma ganhar um deles.',
          recognize: 'Observe casas de onde um cavalo ou uma peça de longo alcance do adversário atingiria duas peças suas desprotegidas ou o seu rei.',
        }
      : {
          why: `${c.evidence.bestSan?.[0]} atacava ${list(c.evidence.targets)} ao mesmo tempo; linha do motor: ${line(c.evidence.bestSan)}, ganhando ${pts(c.evidence.materialDelta)}.`,
          concept: 'Ataque duplo: o adversário só consegue salvar um dos alvos.',
          recognize: 'Procure casas de onde uma peça sua atinja duas peças adversárias valiosas, ou uma peça e o rei.',
        },
  discovered_attack: (_r, c) =>
    c.side === 'opponent'
      ? {
          fact: `O lance permitiu um ataque descoberto: depois de ${c.evidence.capturingMoveSan}, a peça em ${c.evidence.by} passa a atacar ${list(c.evidence.targets)}.`,
          consequence: `Linha do motor: ${line(c.evidence.replySan)}${lossNote(c.evidence.materialDelta)}.`,
          concept: 'Ataque descoberto: ao mover uma peça, outra que estava atrás dela passa a atacar.',
          recognize: 'Repare em peças adversárias alinhadas com uma torre, bispo ou dama por trás, apontando para seu rei ou dama.',
        }
      : {
          why: `${c.evidence.bestSan?.[0]} descobria o ataque da peça em ${c.evidence.by} contra ${list(c.evidence.targets)}; linha do motor: ${line(c.evidence.bestSan)}, ganhando ${pts(c.evidence.materialDelta)}.`,
          concept: 'Ataque descoberto: duas ameaças ao mesmo tempo — a da peça que se move e a da peça revelada.',
          recognize: 'Procure suas peças posicionadas na frente de uma peça de longo alcance que mira um alvo valioso.',
        },
  pin: (_r, c) =>
    c.side === 'opponent'
      ? {
          fact: c.evidence.pinCreated
            ? `O adversário pode cravar ${your(c.evidence.pieceType)} em ${c.evidence.square} com ${c.evidence.capturingMoveSan} (${c.evidence.pinKind === 'absolute' ? 'contra o rei: não poderá sair da linha' : 'contra uma peça mais valiosa'}) e depois ${agree(c.evidence.pieceType, 'ganhá-l')}.`
            : `${cap(your(c.evidence.pieceType))} em ${c.evidence.square} está ${agree(c.evidence.pieceType, 'cravad')} (${c.evidence.pinKind === 'absolute' ? 'contra o rei: não pode sair da linha' : 'contra uma peça mais valiosa'}) pela peça em ${c.evidence.by}, e o adversário pode ${agree(c.evidence.pieceType, 'ganhá-l')}.`,
          consequence: `Linha do motor: ${line(c.evidence.replySan)}${lossNote(c.evidence.materialDelta)}.`,
          concept: c.evidence.pinKind === 'absolute' ? 'Cravada absoluta: a peça cravada não pode se mover legalmente, nem para defender.' : 'Cravada relativa: mover a peça cravada expõe uma peça mais valiosa.',
          recognize: 'Quando uma peça sua está entre uma peça de longo alcance adversária e seu rei ou dama, ela não deve ser contada como defensora.',
        }
      : {
          why: `${c.evidence.bestSan?.[0]} cravava ${the(c.evidence.pieceType)} em ${c.evidence.square}; linha do motor: ${line(c.evidence.bestSan)}, ganhando ${pts(c.evidence.materialDelta)}.`,
          concept: 'Cravada: atacar uma peça que não pode (ou não deve) sair da linha.',
          recognize: 'Procure peças adversárias alinhadas com o rei ou a dama delas numa coluna, fileira ou diagonal.',
        },
  overloaded: (_r, c) => ({
    ...(c.side === 'opponent'
      ? { fact: `O adversário explora uma peça sua sobrecarregada em ${c.evidence.defender}, única defensora de ${list(c.evidence.targets)}.`, consequence: `Linha do motor: ${line(c.evidence.replySan)}.` }
      : { why: `${cap(the(c.evidence.pieceType))} ${agree(c.evidence.pieceType, 'adversári')} em ${c.evidence.defender} era a única defensora de ${list(c.evidence.targets)}; linha do motor: ${line(c.evidence.bestSan)}, ganhando ${pts(c.evidence.materialDelta)}.` }),
    concept: 'Peça sobrecarregada: um defensor não consegue cumprir duas funções ao mesmo tempo.',
    recognize: 'Conte quantas peças dependem de um mesmo defensor; se forem duas atacadas, capture uma para desviá-lo.',
  }),
  deflection: (_r, c) => ({
    ...(c.side === 'opponent'
      ? { fact: `O adversário desvia sua peça de ${c.evidence.defender}, que defendia ${c.evidence.square}.`, consequence: `Linha do motor: ${line(c.evidence.replySan)}.` }
      : { why: `A sequência ${line(c.evidence.bestSan)} desviava a peça adversária de ${c.evidence.defender}, que defendia ${c.evidence.square}, ganhando ${pts(c.evidence.materialDelta)}.` }),
    concept: 'Desvio: forçar um defensor a abandonar a casa ou a peça que protege.',
    recognize: 'Quando uma peça adversária defende algo importante, procure lances forçantes que a obriguem a se mover.',
  }),
  missed_capture: (_r, c) => ({
    why: `${c.evidence.bestSan?.[0]} capturava ${the(c.evidence.pieceType)} em ${c.evidence.square} com saldo positivo depois das recapturas legais (${c.evidence.see ?? '?'}); linha do motor: ${line(c.evidence.bestSan)}.`,
    concept: 'Captura vantajosa: uma captura é boa quando a troca estática termina a seu favor.',
    recognize: 'Antes de cada lance, verifique se alguma peça adversária pode ser capturada sem recaptura suficiente.',
  }),
  missed_check: (_r, c) => ({
    why: `O xeque ${c.evidence.bestSan?.[0]} iniciava uma sequência que ganha ${pts(c.evidence.materialDelta)}: ${line(c.evidence.bestSan)}.`,
    concept: 'Lances forçantes: um xeque reduz as respostas do adversário e facilita o cálculo.',
    recognize: 'Considere todos os xeques disponíveis, mesmo os que parecem não funcionar à primeira vista.',
  }),
  combination: (_r, c) =>
    c.side === 'opponent'
      ? {
          fact: `depois deste lance, o adversário ganha material começando por ${c.evidence.capturingMoveSan}. A sequência não se encaixa num padrão tático simples reconhecido pelo ChessQuest.`,
          consequence: `Linha do motor: ${line(c.evidence.replySan, 7)}${c.evidence.lineSettled === false ? ' (a linha não chega a uma posição estável; o saldo de material não foi verificado)' : lossNote(c.evidence.materialDelta)}.`,
          concept: 'Cálculo concreto: algumas sequências só se justificam pela análise lance a lance.',
          recognize: 'Antes de jogar, liste as capturas e os xeques que o adversário terá e calcule cada um até uma posição calma.',
        }
      : {
          why: `A linha do motor ${line(c.evidence.bestSan, 7)} ganha ${pts(c.evidence.materialDelta)}, mas não se encaixa num padrão tático simples reconhecido pelo ChessQuest.`,
          concept: 'Cálculo concreto: algumas sequências só se justificam pela análise lance a lance.',
          recognize: 'Em posições com peças adversárias pouco defendidas, calcule capturas e xeques até uma posição calma.',
        },
  mate_threat: (_r, c) => ({
    fact: 'O adversário já tinha mate forçado; nenhum lance evitava a perda, então o critério é resistir o máximo possível.',
    why: c.evidence.bestSan?.length ? `A defesa mais resistente segundo o motor começava com ${c.evidence.bestSan[0]}.` : undefined,
    concept: 'Defesa em posições críticas: prolongar o mate dá chances práticas de erro ao adversário.',
    recognize: 'Quando o rei está sob ataque direto, priorize lances que cubram as casas de mate.',
  }),
  defense: (_r, c) => ({
    fact: 'A posição exigia um lance defensivo preciso.',
    why: c.evidence.bestSan?.length ? `O motor indicava ${c.evidence.bestSan[0]} como a defesa mais sólida.` : undefined,
    concept: 'Defesa: neutralizar a ameaça principal antes de executar o próprio plano.',
    recognize: 'Compare as ameaças dos dois lados antes de decidir entre defender e atacar.',
  }),
  positional: (_r, c) => ({
    fact: fallbackFact(c, 'O lance piorou a avaliação do motor.'),
    why: c.evidence.bestSan?.length ? `A continuação preferida pelo motor foi ${line(c.evidence.bestSan)}.` : undefined,
    concept: 'Avaliação posicional: atividade das peças, estrutura de peões e segurança do rei.',
    recognize: 'Ao comparar lances tranquilos, observe qual deles melhora a peça menos ativa ou cria uma fraqueza no campo adversário.',
  }),
  conversion: (_r, c) => ({
    fact: fallbackFact(c, 'A posição era vencedora segundo o motor, e o lance reduziu a vantagem.'),
    why: c.evidence.bestSan?.length ? `A continuação preferida pelo motor foi ${line(c.evidence.bestSan)}.` : undefined,
    concept: 'Conversão de vantagem: em posições ganhas, simplificar e eliminar o contrajogo costuma ser mais seguro que buscar mais material.',
    recognize: 'Com vantagem decisiva, verifique quais contra-ataques o adversário ainda tem e neutralize-os primeiro.',
  }),
  opening: (_r, c) => ({
    fact: fallbackFact(c, 'Este lance de abertura piorou a posição segundo o motor.'),
    why: c.evidence.bestSan?.length ? `A continuação preferida pelo motor foi ${line(c.evidence.bestSan)}.` : undefined,
    concept: 'Princípios de abertura: desenvolvimento, controle do centro e segurança do rei.',
    recognize: 'Revise a linha na biblioteca de aberturas e compare com o plano típico da estrutura.',
  }),
  endgame: (_r, c) => ({
    fact: fallbackFact(c, 'Neste final, o lance escolhido perdeu parte significativa da avaliação.'),
    why: c.evidence.bestSan?.length ? `A continuação preferida pelo motor foi ${line(c.evidence.bestSan)}.` : undefined,
    concept: 'Técnica de finais: atividade do rei e peões passados costumam ser decisivos.',
    recognize: 'Em finais, calcule corridas de peões e considere centralizar o rei.',
  }),
};

/** Produces a structured explanation for a reviewed move. */
export function explainMove(review: MoveReview, replyLine: readonly string[]): Explanation {
  const label = CLASS_LABEL[review.classification];
  const evalText = `Avaliação: ${formatScore(review.evalBefore)} com o melhor lance → ${formatScore(review.evalAfter)} depois do lance jogado (profundidade ${review.depth}).`;
  if (review.classification === 'inconclusive') {
    return { title: label, category: 'inconclusive', whatHappened: `Você jogou ${review.san}. ${review.reason ?? 'Dados insuficientes para uma classificação confiável.'}`, confidence: 'limited', concepts: [] };
  }
  if (review.classification === 'best' || review.classification === 'excellent' || review.classification === 'good') {
    return {
      title: label,
      category: 'good',
      whatHappened: `Você jogou ${review.san}. ${evalText}`,
      ...(review.classification !== 'best' && review.bestMoveSan ? { betterAlternative: `O motor preferia ${review.bestMoveSan}, mas a diferença é pequena.` } : {}),
      confidence: 'verified',
      concepts: [],
    };
  }
  const concepts = detectConcepts(review, replyLine);
  const main = concepts[0];
  const betterAlternative = review.bestMoveSan ? `${review.bestMoveSan}.` : undefined;
  if (!main) return { title: label, category: 'positional', whatHappened: `Você jogou ${review.san}. ${evalText}`, ...(betterAlternative ? { betterAlternative } : {}), confidence: 'limited', concepts };
  const { fact, ...body } = TEMPLATES[main.theme](review, main);
  const kind = main.category === 'positional' ? 'Erro posicional' : main.category === 'mate' ? 'Questão de mate' : 'Erro tático';
  return {
    title: `${label} · ${THEME_LABEL[main.theme]}`,
    category: main.category,
    whatHappened: `Você jogou ${review.san}. ${kind}: ${fact ?? (main.side === 'own' ? 'havia uma oportunidade tática que o lance não aproveitou.' : 'a melhor continuação do motor era diferente.')} ${evalText}`,
    ...(betterAlternative ? { betterAlternative } : {}),
    ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    theme: main.theme,
    skill: THEME_SKILL[main.theme],
    confidence: main.verified ? 'verified' : 'limited',
    concepts,
  };
}
