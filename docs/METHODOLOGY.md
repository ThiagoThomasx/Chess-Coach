# Metodologia do ChessQuest

Este documento descreve as regras usadas para avaliar lances, gerar explicações e exercícios e estimar competências. Todas as regras ficam em funções puras, cobertas por testes em `tests/`.

## 1. Avaliações do motor

- Motor: Stockfish 19 *lite single-threaded* (WebAssembly), executado num Web Worker local. Nenhuma consulta remota.
- O protocolo UCI reporta pontuações do ponto de vista **do lado que joga**. `UciEngine` converte tudo para o ponto de vista **das brancas** (`toWhitePov`) antes de armazenar. Nunca se subtraem avaliações de perspectivas diferentes: a comparação é feita sempre do ponto de vista de quem moveu (`povOf`, `winPercentFor`).
- Pontuações de mate (`mate N`) são mantidas como `{ kind: 'mate' }` e **nunca** convertidas em centipawns. Uma posição de xeque-mate já no tabuleiro é codificada como mate com |valor| = 0,5.
- Uma busca interrompida (`stop`) é marcada `complete: false` e não é reutilizada nem tratada como definitiva.
- Cache: avaliações completas são guardadas por FEN (sem os contadores de lances). São reaproveitadas somente se a profundidade e o MultiPV armazenados forem ≥ aos pedidos. Limitação: ignorar o contador de 50 lances pode, em casos raros, reaproveitar uma avaliação de posição idêntica com relógio diferente.

## 2. Comparação de um lance

Para o lance *i* (da posição *P(i−1)* para *P(i)*):

1. A posição anterior é analisada com MultiPV *k* (padrão 3). A melhor linha dá a avaliação de referência.
2. Se o lance jogado aparece entre as *k* linhas, usa-se a pontuação **dessa linha** (mesma busca, mesma profundidade). Caso contrário, usa-se a avaliação da posição resultante *P(i)*.
3. As duas pontuações são convertidas em **expectativa de vitória** de quem moveu, pelo modelo logístico publicado pelo Lichess: `50 + 50·(2/(1+e^(−0,00368208·cp)) − 1)` (cp limitado a ±1000). Mate a favor = 100, mate contra = 0.
4. Perda = max(0, expectativa antes − expectativa depois), em pontos percentuais (p.p.).

## 3. Classificação

| Categoria | Regra (padrão, configurável) |
|---|---|
| Melhor lance | O lance é o primeiro da busca ou tem pontuação idêntica a ele |
| Excelente | perda < 2 p.p. |
| Bom | perda < 5 p.p. |
| Imprecisão | perda < 10 p.p. |
| Erro | perda < 15 p.p. |
| Erro grave | perda ≥ 15 p.p. |
| Inconclusivo | busca interrompida ou profundidade < mínimo (padrão 10) |

Regras de mate (precedem a tabela):

- **Permitiu mate**: depois do lance o adversário tem mate forçado que não tinha antes → erro grave.
- **Mate perdido**: havia mate forçado e ele desapareceu → imprecisão se a posição continua vencedora (≥ 80%), erro se ≥ 60%, senão erro grave.
- **Mate mais lento**: continua havendo mate, só mais longo → no máximo "bom".
- **Já perdido por mate forçado**: se o adversário já tinha mate forçado antes e continua tendo depois, o resultado não muda → "bom" (nunca "excelente" nem erro); o melhor lance de defesa continua "melhor lance".

Outras salvaguardas:

- Várias jogadas igualmente boas: um lance com a mesma pontuação do primeiro da busca é "melhor lance"; diferenças pequenas caem em "excelente/bom". A severidade nunca aumenta só porque o motor preferiu outro lance — conta apenas a perda de expectativa.
- Ruído de busca: se a avaliação depois do lance for *melhor* que a de referência, a perda é 0.
- Profundidade: o veredito usa a menor profundidade entre as buscas comparadas; abaixo do mínimo (padrão 10) ou com busca interrompida, o lance é "inconclusivo" e não gera exercício nem evidência.
- Os marcadores "perda de material" e "oportunidade tática desperdiçada" medem o material num **ponto estável** da linha do motor (ver §4).

Marcadores adicionais (não alteram a categoria): perda de posição vencedora, perda de vantagem, perda de igualdade, entrada em posição inferior (faixas: vencendo ≥ 80, vantagem ≥ 60, igual 40–60, pior 20–40, perdendo < 20), defesa necessária, erro de abertura (erro/erro grave até a meia-jogada 20), único lance (diferença ≥ 15 p.p. para a 2ª linha), perda de material (a linha de resposta do motor perde ≥ 2 pontos em até 6 meias-jogadas), oportunidade tática desperdiçada (a melhor linha ganhava ≥ 2 pontos).

### Métricas de partida

"Perda média de expectativa" = média da perda (p.p.) por lance conclusivo; "perda média em centipawns" considera só lances em que antes e depois são centipawns (limitado a 1000). **Não é** a "precisão" de outras plataformas e não deve ser comparada a ela.

## 4. Fatos táticos e explicações

### 4.1 Primitivas com legalidade (`services/chess/tactics.ts`)

Tudo é derivado da geração de lances **legais** do chess.js — uma peça cravada não "ataca" nem "defende" uma casa para a qual não pode se mover.

| Primitiva | Definição |
|---|---|
| Captura legal | Lance legal que captura na casa. Para o lado que **não** está a jogar usa-se o "lance nulo" (o adversário passa a vez); o lance nulo é recusado se o lado a jogar está em xeque. |
| SEE (troca estática) | Valor da captura menos o melhor resultado das recapturas legais na mesma casa, sempre com o atacante legal de menor valor, podendo parar a qualquer momento. Promoções contam o ganho da peça. |
| Peça "en prise" | Peça que o adversário pode capturar legalmente com SEE > 0. |
| Recapturadores legais | Peças que podem recapturar legalmente depois da captura mais barata do adversário. |
| Cravada | Peça de longo alcance → uma peça → rei (absoluta) ou peça mais valiosa (relativa), na linha de movimento dessa peça. |
| Mate em 1 / ameaça de mate | Lances legais que dão xeque-mate (exato); ameaça = mate em 1 do adversário no lance nulo. |
| Ataque duplo | A peça que se move ataca ≥ 2 alvos valiosos (cavalo, bispo, torre, dama) ou dá xeque e ataca outro, por capturas legais (ou geometria, se o adversário estiver em xeque). |
| Ataque descoberto | Depois do lance, outra peça (não cravada absolutamente) passa a atacar um alvo valioso ou o rei. |
| Peça sobrecarregada | Única recapturadora legal de ≥ 2 peças que o adversário pode capturar. |
| Desvio | Na linha do motor, a resposta do adversário move uma peça que era recapturadora legal da casa capturada no lance seguinte, reduzindo os defensores. |

### 4.2 Material em ponto estável

`settledSwing` mede o material ao longo da linha do motor: joga 6 meias-jogadas e continua enquanto o último lance foi captura, promoção ou xeque (até 12). Se a linha terminar no meio de uma troca, o resultado é marcado **não estabilizado** e nenhuma quantidade de material é afirmada.

### 4.3 Conceitos (`services/pedagogy/concepts.ts`)

Ordem de detecção (depois, os conceitos **verificados** passam à frente dos não verificados, mantendo a ordem entre si; o primeiro vira o tema principal):

1. **Mate**: mate permitido / mate disponível (marcadores do motor + mate em 1 exato; indica se já havia ameaça de mate em 1 antes do lance).
2. **Captura que perde material**: o lance jogado é captura com SEE < 0 **e** a linha do motor confirma perda ≥ 2 em ponto estável.
3. **Material perdido para a resposta** (linha do adversário ganha ≥ 1 ponto): motivo do adversário — ataque duplo, ataque descoberto, desvio, sobrecarga, cravada (a peça perdida está cravada e "en prise", ou a resposta cria a cravada e a linha captura a peça cravada; nesse caso o texto usa o futuro: "o adversário pode cravar…"), peça desprotegida (a peça movida ficou "en prise"), ameaça não respondida (já estava "en prise" antes), defensor removido (a peça movida era recapturadora legal). Sem padrão reconhecido, vira "combinação" do adversário, descrita como fato e consequência (nunca como "por que a alternativa é superior").
4. **Oportunidade perdida** (a melhor linha ganha ≥ 2 em ponto estável e mais que o lance jogado): motivo do jogador — ataque descoberto, ataque duplo, desvio, sobrecarga, cravada nova, captura com SEE ≥ 2, xeque, ou "combinação" (ganho confirmado sem padrão reconhecido).
5. **Defesa**: mate forçado contra; defesa necessária.
6. **Posicional** (sem evidência material): conversão (posição vencedora ≥ 80%), abertura, final ou posicional — sempre **limitado**. O texto nunca afirma ausência de tática: diz que o ChessQuest não reconheceu um padrão simples e informa o que foi medido (quantas meias-jogadas, ou que a linha não estabilizou e o material não foi verificado).

Cravadas de peão na própria coluna não contam como cravada (o peão só avança pela coluna). Uma cravada só explica um ganho se a linha do motor capturar a peça cravada.

Um conceito é **verificado** apenas quando todos os fatos citados vêm de lances legais e de linhas do motor medidas em ponto estável. Caso contrário a interface mostra a explicação como limitada.

### 4.4 Estrutura da explicação (`services/pedagogy/explain.ts`)

1. O que aconteceu (lance, tipo de erro — tático, posicional ou de mate —, fato verificado e avaliação).
2. Melhor alternativa encontrada.
3. Por que ela é superior.
4. Ameaça ou consequência (linha do motor).
5. Conceito.
6. Como reconhecer situações semelhantes.

Os textos não atribuem causas psicológicas (desatenção, pressa etc.); um teste garante a ausência desses termos nos templates.

## 5. Exercícios

### 5.1 Seleção

Critérios mínimos (`checkCandidate`): análise completa, profundidade ≥ mínimo, lance classificado como erro/erro grave (ou imprecisão com mate perdido/tática desperdiçada), ≥ 2 lances legais, e o lance errado **não** pode estar dentro da tolerância (senão a posição é descartada como ambígua). No máximo *N* por partida (padrão 4), priorizando a maior perda; posições repetidas são ignoradas.

### 5.2 Tipos e objetivos (`goalFor`)

| Tipo | Quando | Lances do usuário |
|---|---|---|
| Mate | A melhor linha é mate forçado para quem joga | N do "mate em N" (máx. 4; com N > 4, o aluno joga 4 lances que mantêm o mate em N forçado) |
| Sequência | A melhor linha ganha ≥ 2 pontos em ponto estável | ⌈meias-jogadas até estabilizar / 2⌉, de 1 a 3 |
| Defesa | Tema defensivo (mate permitido, peça desprotegida, ameaça, cravada…) | 1 |
| Conversão | Sem ganho material, posição vencedora (≥ 80%) | 2 |
| Lance único | Demais casos | 1 |

### 5.3 Árvore de solução (`buildSolutionTree`)

Construída com o motor ao criar o exercício: em cada posição do usuário, busca MultiPV (≥ 3) → **lances aceitos** = todos dentro da tolerância (padrão 5 p.p.) do melhor. Em metas de mate, só são aceitos lances que mantêm mate forçado **dentro do orçamento de mate** (N do mate em N menos os lances já jogados; a expectativa de vitória não distingue mate em 2 de mate em 5). Uma árvore nunca fica com a raiz vazia: se nenhum lance passar no filtro, a raiz usa os lances aceitos da análise da partida. Na raiz, até 2 lances aceitos são expandidos; abaixo dela, o principal. Cada lance expandido recebe até 2 **respostas equivalentes do adversário** (dentro da tolerância, do ponto de vista dele), recursivamente até o limite de lances.

### 5.4 Validação (`playSolverMove`)

1. Lance ilegal → recusado sem registro.
2. Xeque-mate dado pelo usuário → resolvido.
3. Lance na lista de aceitos → aceito. Fora da lista → o motor analisa a posição resultante e aceita se a perda ficar dentro da tolerância (e, em metas de mate, se o mate continuar forçado dentro do limite). Lances que terminam a partida (afogamento, empate) são julgados pela pontuação terminal, sem motor.
4. Sem motor disponível, um lance fora da lista **não** é julgado ("não verificável", nada é registrado).
5. Aceito: se atingiu o limite de lances → resolvido. Senão, o adversário responde com uma das respostas da árvore (escolha aleatória entre as equivalentes, para variar o treino); se o lance era uma alternativa não expandida, o motor calcula a resposta e o próximo nó na hora. Sem motor nesse caso, o exercício termina como resolvido, com aviso de que a continuação não foi verificada.
6. Limite rígido: 4 lances do usuário por exercício.

O registro de tentativa distingue: resolvido sem ajuda, com dicas (cada dica conta; repetir depois de errar na mesma sessão conta como uma dica) e solução consultada.

Dicas progressivas: 1 = o tipo de lance (mate imediato, xeque, captura, ataque duplo ou lance tranquilo de uma peça), calculado da posição; 2 = a casa da peça a mover; 3 = o lance.

**Repetição de prática**: uma tentativa feita menos de 10 minutos depois da tentativa anterior do mesmo exercício (por exemplo, "Resolver de novo" logo após ver a dica 3 ou a solução) não é registrada: não muda a repetição espaçada nem gera evidência de competência.

Dificuldade (1–5): base 2; +1 se o primeiro lance é tranquilo (sem captura/xeque); +1 se exige ≥ 3 lances; +0,5 se exige 2 lances (exceto capturas); −1 para captura simples; −0,5 se há várias soluções.

Exercícios criados antes desta versão (esquema v1, linha única) são convertidos para a árvore na migração do banco para o esquema v2.

## 6. Repetição espaçada

Leitner simples (`services/scheduling/srs.ts`), intervalos padrão 1, 3, 7, 14, 30, 60 dias:

- Erro ou solução revelada → caixa 0, volta em 10 minutos.
- Acerto com dicas → mantém a caixa, metade do intervalo (mínimo 1 dia).
- Acerto independente → agenda pelo intervalo da caixa atual e sobe uma caixa.

Treinos de linhas de abertura do repertório usam o mesmo agendador (erro → revisão em 10 minutos).

## 7. Perfil de competências

Competências: visão tática, cálculo, identificação de ameaças, defesa, estratégia, aberturas, finais, reconhecimento de padrões.

**Evidências** (`SkillEvent`, todas rastreáveis a uma partida/lance, exercício ou linha de abertura):

| Fonte | Peso | Resultado |
|---|---|---|
| Exercício | 1 (1/k na k-ésima tentativa do mesmo exercício) | 1 sem dica; 1 − 0,25·dicas (mín. 0,25) com dica; 0 se errou ou viu a solução. Exercícios com sequência ≥ 3 meias-jogadas também contam para "cálculo" (peso 0,5) |
| Lance de partida (fase: abertura/meio-jogo/final) | 0,2 | 1 bom+, 0,5 imprecisão, 0 erro |
| Erro de partida com conceito verificado | 0,5 | 0 na competência do conceito |
| Oportunidade aproveitada (ganho ≥ 2 encontrado, mate encontrado, defesa necessária encontrada, peça ameaçada salva) | 0,5 | 1 |
| Treino de abertura | 0,5 | 1 / 0 |

**Estimativa**: Beta(1,1) + Σ peso_efetivo·resultado (α) e Σ peso_efetivo·(1−resultado) (β). Mostra-se a média e o intervalo de credibilidade de 90% (aproximação normal da Beta). Nenhum rating é inferido; nenhum dado inicial é exigido.

**Peso efetivo** (`effectiveWeights`):

- Decaimento por idade com meia-vida de 120 dias (o perfil acompanha o desempenho recente).
- Tentativas repetidas do **mesmo exercício** valem 1/k (k = ordem da tentativa): resolver 15 vezes a mesma posição soma ≈ 3,3, não 15.
- Uma partida contribui com no máximo peso 1 por competência (uma partida tem poucos exemplos de cada tema).
- Evidência de partida só é registrada a partir de conceitos **verificados** (§4.3) e de ameaças "en prise" reais (lances legais + SEE).

**Confiança**: menos de 2 de peso efetivo → poucas evidências; menos de 6 → evidências iniciais; última evidência há > 30 dias (com ≥ 6 de peso bruto) ou taxa recente (últimos 8 eventos) 20 p.p. abaixo da média → precisa revisar; peso ≥ 10, média ≥ 75%, limite inferior ≥ 60% **e** acertos independentes em ≥ 5 exercícios distintos → domínio provisório; senão desempenho consistente.

**Tendência**: compara os últimos 8 eventos com os 8 anteriores (≥ 4); diferença > 10 p.p. → subindo/caindo.

**Dificuldade-alvo**: começa em 1; duas vitórias independentes seguidas em exercícios de dificuldade ≥ alvo sobem 1; um erro desce 1. O filtro "No meu nível" mostra exercícios a ±1 do alvo. O tempo de resposta é registrado, mas não entra no cálculo.

## 8. Recomendações

"Seu próximo treino" só cita um tema quando o **mesmo conceito verificado** aparece em pelo menos 2 lances do usuário em partidas analisadas (com a cor definida). Cada recomendação lista os lances que a justificam, com link para a posição. Sem esse padrão, recomenda revisões pendentes ou mais diagnóstico; sem partidas, convida a importar.
