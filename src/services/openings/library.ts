import type { Opening } from '../../types/domain';

/**
 * Initial opening library, authored for ChessQuest. Move orders are standard
 * main lines found in any opening reference; the texts are general,
 * widely-accepted ideas — not exhaustive theory. Every line is checked for
 * legality by tests/openings.test.ts. Users can add their own lines.
 */
export const OPENINGS: readonly Opening[] = [
  {
    id: 'italian',
    name: 'Abertura Italiana',
    eco: 'C50–C54',
    side: 'w',
    definingPly: 5, // 3.Bc4
    mainLine: { id: 'main', name: 'Giuoco Piano: linha principal com c3 e d4', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+'] },
    variations: [
      { id: 'pianissimo', name: 'Giuoco Pianissimo (d3)', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'] },
      { id: 'two-knights', name: 'Defesa dos Dois Cavalos (4.Ng5)', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5'], comment: 'Após 5...Nxd5?! as brancas têm 6.Nxf7 ou 6.d4 com ataque perigoso; 5...Na5 é a resposta principal.' },
    ],
    goals: ['Desenvolver rapidamente as peças menores', 'Pressionar o ponto f7 com o bispo em c4', 'Preparar d4 com c3 para dominar o centro'],
    tacticalIdeas: ['O bispo em c4 mira f7, o ponto mais fraco das pretas no início', 'Após d4, o centro de peões pode avançar com e5 atacando o cavalo de f6'],
    commonMistakes: ['Atacar prematuramente com Ng5 sem desenvolvimento suficiente', 'Esquecer o roque e deixar o rei no centro após a abertura de linhas'],
  },
  {
    id: 'ruy-lopez',
    name: 'Ruy López (Abertura Espanhola)',
    eco: 'C60–C99',
    side: 'w',
    definingPly: 5, // 3.Bb5
    mainLine: { id: 'main', name: 'Fechada', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'] },
    variations: [
      { id: 'exchange', name: 'Variante das Trocas', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O'] },
      { id: 'berlin', name: 'Defesa Berlim', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6'] },
    ],
    goals: ['Pressionar o cavalo de c6, defensor do peão e5', 'Rocar cedo e preparar c3 e d4', 'Manter tensão central a longo prazo'],
    tacticalIdeas: ['Na linha principal, o peão e5 não está imediatamente ameaçado porque Bxc6 seguido de Nxe5 permite ...Qd4', 'O bispo recua para b3 para continuar mirando f7'],
    commonMistakes: ['Capturar em e5 cedo demais sem calcular ...Qd4 ou ...Qg5', 'Jogar d4 sem a preparação com c3, permitindo trocas que liberam o jogo das pretas'],
  },
  {
    id: 'queens-gambit-declined',
    name: 'Gambito da Dama Recusado',
    eco: 'D30–D69',
    side: 'w',
    definingPly: 4, // 2…e6
    mainLine: { id: 'main', name: 'Linha ortodoxa', moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6', 'Bh4'] },
    variations: [
      { id: 'exchange', name: 'Variante das Trocas', moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5', 'Bg5', 'c6', 'e3'] },
    ],
    goals: ['Disputar o centro com c4, pressionando d5', 'Desenvolver com Nc3, Bg5 e e3', 'Criar pressão sobre a coluna c'],
    tacticalIdeas: ['O bispo em g5 cravando o cavalo de f6 aumenta a pressão sobre d5', 'Na estrutura das trocas, o ataque de minoria (b4–b5) é um plano típico'],
    commonMistakes: ['Desenvolver o bispo de f1 antes de definir a estrutura central', 'Ignorar a liberação ...c5 ou ...e5 das pretas'],
  },
  {
    id: 'london',
    name: 'Sistema Londres',
    eco: 'D02 / A46',
    side: 'w',
    definingPly: 3, // 2.Bf4
    mainLine: { id: 'main', name: 'Configuração principal', moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6', 'Bg3'] },
    variations: [{ id: 'kid-setup', name: 'Contra fianqueto do rei', moves: ['d4', 'Nf6', 'Bf4', 'g6', 'e3', 'Bg7', 'Nf3', 'O-O', 'Be2', 'd6', 'h3'] }],
    goals: ['Estrutura sólida com d4, e3 e c3', 'Desenvolver o bispo de c1 antes de e3', 'Planos claros com Ne5 e ataque no flanco do rei'],
    tacticalIdeas: ['Responder ...Bd6 com Bg3 para manter a estrutura intacta', 'Atenção a ...Qb6 atacando b2 quando o bispo saiu de c1'],
    commonMistakes: ['Jogar no piloto automático sem observar ...Qb6', 'Permitir ...e5 livre das pretas sem reação'],
  },
  {
    id: 'sicilian-najdorf',
    name: 'Defesa Siciliana — Najdorf',
    eco: 'B90–B99',
    side: 'b',
    definingPly: 10, // 5…a6
    mainLine: { id: 'main', name: 'Najdorf principal', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
    variations: [
      { id: 'english-attack', name: 'Ataque Inglês (6.Be3)', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be6'] },
      { id: 'bg5', name: 'Linha principal 6.Bg5', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Bg5', 'e6'] },
    ],
    goals: ['Trocar o peão c pelo peão d para obter maioria central', 'Controlar b5 com ...a6 e preparar ...e5 ou ...e6', 'Contra-jogo na coluna c semiaberta'],
    tacticalIdeas: ['...a6 impede Nb5 e Bb5 e prepara ...b5', 'A ruptura ...d5 costuma liberar o jogo quando bem preparada'],
    commonMistakes: ['Atrasar o desenvolvimento do flanco do rei', 'Permitir a casa d5 como posto avançado para um cavalo branco'],
  },
  {
    id: 'french-advance',
    name: 'Defesa Francesa — Avanço',
    eco: 'C02',
    side: 'b',
    definingPly: 5, // 3.e5
    mainLine: { id: 'main', name: 'Avanço com ...Qb6', moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Qb6'] },
    variations: [{ id: 'bd7', name: 'Com ...Bd7', moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Bd7'] }],
    goals: ['Atacar a base da cadeia de peões (d4) com ...c5', 'Aumentar a pressão em d4 com ...Nc6 e ...Qb6', 'Lutar contra o espaço das brancas'],
    tacticalIdeas: ['...Qb6 ataca d4 e b2 simultaneamente', 'A ruptura ...f6 ataca a cabeça da cadeia em e5'],
    commonMistakes: ['Ficar passivo sem atacar a cadeia de peões', 'Deixar o bispo de c8 sem perspectiva por muito tempo'],
  },
  {
    id: 'caro-kann',
    name: 'Defesa Caro-Kann',
    eco: 'B10–B19',
    side: 'b',
    definingPly: 4, // 2…d5
    mainLine: { id: 'main', name: 'Clássica com ...Bf5', moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6'] },
    variations: [{ id: 'advance', name: 'Variante do Avanço', moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2'] }],
    goals: ['Disputar o centro com ...d5 apoiado por ...c6', 'Desenvolver o bispo de c8 antes de ...e6', 'Estrutura sólida e final favorável'],
    tacticalIdeas: ['Após Ng3, o bispo recua para g6; h4–h5 das brancas exige ...h6', 'O bispo em f5 deve estar atento a Ng3 e h4'],
    commonMistakes: ['Jogar ...e6 antes de desenvolver o bispo de c8', 'Ignorar o avanço h4–h5 que pode prender o bispo'],
  },
  {
    id: 'scandinavian',
    name: 'Defesa Escandinava',
    eco: 'B01',
    side: 'b',
    definingPly: 2, // 1…d5
    mainLine: { id: 'main', name: 'Linha com ...Qa5', moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6'] },
    variations: [{ id: 'qd6', name: 'Linha com ...Qd6', moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qd6', 'd4', 'Nf6', 'Nf3', 'a6'] }],
    goals: ['Eliminar o peão e4 imediatamente', 'Recolocar a dama em casa segura após Nc3', 'Desenvolvimento simples com ...c6, ...Bf5 ou ...Bg4'],
    tacticalIdeas: ['Com a dama em a5, ...Bb4 crava o cavalo de c3, e a dama aumenta a pressão sobre ele', '...c6 cria uma casa de retirada para a dama em c7'],
    commonMistakes: ['Deixar a dama no centro, onde é atacada com ganho de tempo', 'Atrasar o desenvolvimento do flanco do rei'],
  },
];

export function findOpening(id: string, extra: readonly Opening[] = []): Opening | undefined {
  return [...OPENINGS, ...extra].find((o) => o.id === id);
}

/** Plies a game must follow before an opening is named, unless the opening sets its own. */
export const DEFAULT_DEFINING_PLY = 4;

/**
 * Longest library line that is a prefix of the game's moves (for "abertura
 * identificada"). The game must reach the opening's defining move: 1.e4 e5
 * 2.Nf3 Nc6 3.d4 is not named after an opening that needs 3.Bc4 or 3.Bb5.
 */
export function matchOpening(moves: readonly string[], extra: readonly Opening[] = []): { opening: Opening; lineId: string; depth: number } | null {
  let best: { opening: Opening; lineId: string; depth: number } | null = null;
  for (const o of [...OPENINGS, ...extra]) {
    for (const line of [o.mainLine, ...o.variations]) {
      let d = 0;
      while (d < line.moves.length && d < moves.length && line.moves[d] === moves[d]) d++;
      if (d >= (o.definingPly ?? DEFAULT_DEFINING_PLY) && (!best || d > best.depth)) best = { opening: o, lineId: line.id, depth: d };
    }
  }
  return best;
}
