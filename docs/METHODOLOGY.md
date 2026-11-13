# Metodologia do ChessQuest

Este documento descreve as regras usadas para avaliar lances, gerar explicações e exercícios e estimar competências. Todas as regras ficam em funções puras, cobertas por testes em `tests/`.

## 1. Avaliações do motor

- Motor: Stockfish 19 *lite single-threaded* (WebAssembly), executado num Web Worker local. Nenhuma consulta remota.
- O protocolo UCI reporta pontuações do ponto de vista **do lado que joga**. `UciEngine` converte tudo para o ponto de vista **das brancas** (`toWhitePov`) antes de armazenar. Nunca se subtraem avaliações de perspectivas diferentes: a comparação é feita sempre do ponto de vista de quem moveu (`povOf`, `winPercentFor`).
- Pontuações de mate (`mate N`) são mantidas como `{ kind: 'mate' }` e **nunca** convertidas em centipawns. Uma posição de xeque-mate já no tabuleiro é codificada como mate com |valor| = 0,5.
- Uma busca interrompida (`stop`) é marcada `complete: false` e não é reutilizada nem tratada como definitiva.
- Posições impossíveis (número de reis ≠ 1 por lado, peão na 1ª/8ª fileira, mais de 8 peões, lado que não joga em xeque) são recusadas na importação do PGN e do backup, e nunca são enviadas ao motor: o chess.js aceita algumas delas e o Stockfish trava com elas.
- Robustez: uma busca sem nenhuma saída do motor por 30 s é considerada travada. A busca é rejeitada (`timeout`), o worker é descartado e um novo é iniciado para as próximas posições da fila. Uma falha do worker durante a busca tem o mesmo tratamento. O indicador de estado do motor acompanha o reinício.
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

- **Permitiu mate**: depois do lance o adversário tem mate forçado que não tinha antes → erro grave. Se a posição já estava perdida (expectativa ≤ 5% antes do lance), no máximo imprecisão; o marcador "permitiu mate" é mantido.
- **Mate perdido**: havia mate forçado e ele desapareceu → imprecisão se a posição continua vencedora (≥ 80%), erro se ≥ 60%, senão erro grave.
- **Mate mais lento**: continua havendo mate, só mais longo → no máximo "bom".
- **Já perdido por mate forçado**: se o adversário já tinha mate forçado antes e continua tendo depois, o resultado não muda → "bom" (nunca "excelente" nem erro); o melhor lance de defesa continua "melhor lance".

Outras salvaguardas:

- Várias jogadas igualmente boas: um lance com a mesma pontuação do primeiro da busca é "melhor lance"; diferenças pequenas caem em "excelente/bom". A severidade nunca aumenta só porque o motor preferiu outro lance — conta apenas a perda de expectativa.
- Ruído de busca: se a avaliação depois do lance for *melhor* que a de referência, a perda é 0.
- Profundidade: o veredito usa a menor profundidade entre as buscas comparadas; abaixo do mínimo (padrão 10) ou com busca interrompida, o lance é "inconclusivo" e não gera exercício nem evidência.
- Os marcadores "perda de material" e "oportunidade tática desperdiçada" medem o material num **ponto estável** da linha do motor (ver §4).

Marcadores adicionais (não alteram a categoria): perda de posição vencedora, perda de vantagem, perda de igualdade, entrada em posição inferior (faixas: vencendo ≥ 80, vantagem ≥ 60, igual 40–60, pior 20–40, perdendo < 20), defesa necessária, erro de abertura (erro/erro grave até a meia-jogada 20), único lance (diferença ≥ 15 p.p. para a 2ª linha), perda de material (a linha de resposta do motor perde ≥ 2 pontos em até 6 meias-jogadas), oportunidade tática desperdiçada (a melhor linha ganhava ≥ 2 pontos).

### Três noções de "erro" (Sprint 4.7)

O mesmo lance pode ser lido de três formas, cada uma com uma regra própria:

| Noção | Regra | Onde aparece |
|---|---|---|
| **Erro técnico** | A classificação do motor desta seção (imprecisão, erro, erro grave), sempre gravada como foi calculada | Análise da partida, selos, distribuição de classes, explicações, perfil de competências (evidência de fase e de conceito), padrões de erro recorrentes |
| **Erro sério** | Erro ou erro grave **do usuário**, exceto quando a expectativa depois do lance continua ≥ 80% (vantagem decisiva mantida) | Só o indicador "Minhas partidas estão melhorando?" (§8, B3) |
| **Elegível para treino** | Critérios de §5.1; além disso, o lance jogado não pode ser aceito pela árvore mais profunda nem cumprir o objetivo do próprio exercício (`noErrorToTrain`): um lance que manteve a vantagem decisiva não gera exercício de **conversão** | Geração automática e criação manual de exercícios |

Exemplo: de +12 para +5 (97,5% → 86,3%) é um **erro técnico** ("Erro", e conta no perfil), **não é erro sério** (fica fora do indicador) e **não gera exercício de conversão**. Se o mesmo lance tivesse deixado uma torre desprotegida, ele também não seria erro sério, mas geraria um exercício de defesa, porque o fato concreto (a peça desprotegida) continua sendo uma lição.

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

`settledSwing` mede o material ao longo da linha do motor: joga 6 meias-jogadas e continua enquanto o último lance foi captura, promoção ou xeque **ou o próximo lance da linha é uma captura/promoção** (até 12). Se a linha terminar no meio de uma troca, o resultado é marcado **não estabilizado** e nenhuma quantidade de material é afirmada. Exceção exata: uma linha que passou das 6 meias-jogadas e termina numa captura que o lado a jogar não pode retomar legalmente (e sem xeque pendente) está estabilizada.

### 4.3 Conceitos (`services/pedagogy/concepts.ts`)

Ordem de detecção (depois, os conceitos **verificados** passam à frente dos não verificados, mantendo a ordem entre si; o primeiro vira o tema principal):

1. **Mate**: mate permitido / mate disponível (marcadores do motor + mate em 1 exato; indica se já havia ameaça de mate em 1 antes do lance).
2. **Captura que perde material**: o lance jogado é captura com SEE < 0 **e** a linha do motor confirma perda ≥ 2 em ponto estável.
3. **Material perdido para a resposta** (linha do adversário ganha ≥ 1 ponto): motivo do adversário — ataque duplo, ataque descoberto, desvio, sobrecarga, cravada (a peça perdida está cravada e "en prise", ou a resposta cria a cravada e a linha captura a peça cravada; nesse caso o texto usa o futuro: "o adversário pode cravar…"), peça desprotegida (a peça movida ficou "en prise"), ameaça não respondida (já estava "en prise" antes), defensor removido (a peça movida era recapturadora legal). Sem padrão reconhecido, vira "combinação" do adversário, descrita como fato e consequência (nunca como "por que a alternativa é superior").
4. **Oportunidade perdida** (a melhor linha ganha ≥ 2 em ponto estável e mais que o lance jogado): motivo do jogador — ataque descoberto, ataque duplo, desvio, sobrecarga, cravada nova, captura com SEE ≥ 2, xeque, ou "combinação" (ganho confirmado sem padrão reconhecido).
5. **Defesa**: mate forçado contra; defesa necessária.
6. **Posicional** (sem evidência material): conversão (posição vencedora ≥ 80%); **lance forçante que não se sustenta** (o lance jogado foi captura, xeque ou promoção — uma decisão concreta, nunca atribuída a "princípios de abertura"); abertura, final ou posicional — sempre **limitado**. O texto nunca afirma ausência de tática: diz que o ChessQuest não reconheceu um padrão simples e informa o que foi medido (quantas meias-jogadas, ou que a linha não estabilizou e o material não foi verificado).

Cravadas de peão na própria coluna não contam como cravada (o peão só avança pela coluna). Uma cravada só explica um ganho se a linha do motor capturar a peça cravada.

Um conceito é **verificado** apenas quando todos os fatos citados vêm de lances legais e de linhas do motor medidas em ponto estável. Caso contrário a interface mostra a explicação como limitada.

### 4.4 Estrutura da explicação (`services/pedagogy/explain.ts`)

Ordem de leitura (seções sem dados são omitidas):

1. **O que aconteceu** — lance, tipo de decisão, fato verificado e avaliação.
2. **Qual era a ameaça do adversário** — só fatos legais da posição *antes* do lance: mate em 1 no lance nulo, ou uma peça do jogador capturável com ganho (SEE). Sem ameaça encontrada, a seção não aparece (nunca se afirma "não havia ameaça"). É omitida quando o fato principal já é a ameaça (ameaça não respondida, mate já forçado).
3. **Por que o lance não funcionou** — a linha de resposta do motor.
4. **Melhor alternativa encontrada.**
5. **O que acontece depois da alternativa** — linha do motor a partir do melhor lance e a avaliação que ela alcança.
6. **Por que ela é superior** — sempre um fato que compara os dois lances pelo mesmo critério: o motivo tático da alternativa, o mate que ela força, a distância do mate adversário (com a alternativa × depois do lance jogado) ou o material de cada linha medido em ponto estável. Sem um desses fatos a seção é omitida; ela nunca apenas repete a linha do motor.
7. **Conceito** e **Como reconhecer situações semelhantes.**

**Tipo de decisão** (`errorKindOf`), mostrado como etiqueta:

| Tipo | Quando |
|---|---|
| Erro tático | O lance permitiu um motivo tático do adversário ou um mate |
| Oportunidade perdida | Havia um motivo tático ou mate do próprio jogador |
| Erro de cálculo | Captura perdedora (SEE + linha), lance forçante que não se sustenta, ou combinação do adversário logo depois de uma captura/xeque do jogador |
| Erro estratégico | Posição vencedora (≥ 80%) que perdeu avaliação sem mudança de material (conversão) |
| Erro posicional | Só a avaliação do motor explica a diferença (sempre "limitado") |
| Defesa em posição perdida | O adversário já tinha mate forçado antes do lance |
| Lance correto / Lance equivalente | Melhor lance / excelente ou bom (diferença pequena, informada em p.p.) |

**Proporcionalidade**: uma imprecisão sem conceito verificado recebe só os fatos (o que aconteceu, a alternativa e sua continuação); conceito e "como reconhecer" ficam para erros e erros graves, ou para imprecisões com fato verificado.

Os textos não atribuem causas psicológicas (desatenção, pressa etc.); um teste garante a ausência desses termos nos templates.

## 5. Exercícios

### 5.1 Seleção

Critérios mínimos (`checkCandidate`): análise completa, profundidade ≥ mínimo, lance classificado como erro/erro grave (ou imprecisão com mate perdido/tática desperdiçada), ≥ 2 lances legais, e o lance errado **não** pode estar dentro da tolerância (senão a posição é descartada como ambígua). No máximo *N* por partida (padrão 4), priorizando a maior perda; posições repetidas são ignoradas.

**O lance jogado não pode cumprir o objetivo** (Sprint 4.7, PD-2; `playedMeetsGoal`): uma conversão não é criada a partir de um lance que manteve a expectativa ≥ 80%, porque o próprio lance jogado resolveria o exercício. Os outros objetivos não têm esse piso e continuam sendo criados: deixar uma torre desprotegida a +12 ainda ensina um fato concreto (a peça desprotegida), mesmo sem mudar o resultado. A mesma regra vale na criação manual ("Criar exercício desta posição"; `noErrorToTrain`). Conversões gravadas antes da 4.7 a partir desses lances não são apagadas: passam a aceitar o lance decisivo na validação.

**Revalidação na profundidade da árvore** (Sprint 4.4): a árvore de solução é buscada com mais profundidade que a análise rápida. Se ela aceitar o lance jogado na partida, não havia erro a treinar e o exercício é descartado (na geração automática e na criação manual). Isso só vale quando a árvore foi buscada **mais fundo** que a análise da posição: a árvore tem teto de 16, e uma análise configurada acima disso não pode ser desmentida por uma busca mais rasa (auditoria pós-merge A5-1). Exemplo real: 15.Bxd7+ da Partida da Ópera é "erro grave" na profundidade 11 e é aceito na 16. Sem motor disponível a árvore não é montada e essa verificação não acontece.

**Troca de lado** (decisão D3, Sprint 4.4): ao trocar a cor de uma partida entre brancas e pretas, os exercícios dela do lado antigo que **nunca foram tentados** são removidos na mesma transação que salva a cor; os já tentados ficam, com o histórico. Vale também para exercícios criados manualmente (não há campo que os distinga). Só acontece com a análise concluída, quando a mensagem informa quantos foram removidos. Remover a cor ou defini-la pela primeira vez não remove exercícios.

### 5.1.1 Vínculo com a partida (Sprint 4.6, B2)

Um exercício de partida guarda `source: 'game'`, `gameId` e `ply`: a meia-jogada do lance **jogado** na partida; a posição do exercício é a anterior a esse lance. É esse vínculo — sem tabela paralela — que liga a análise ao exercício (`services/exercises/origin.ts`):

- **Na análise**, o lance recebe o selo "Ex." (link para o exercício) e a ação "Criar exercício desta posição" vira "Abrir exercício". O FEN não decide a associação, só a **confere**: um `ply` que não leva à posição do exercício (registro inconsistente) não é ligado, para nunca abrir o lance errado. Exercícios de outra partida com a mesma posição continuam sem selo; criar de novo devolve o existente (deduplicação de `addExercise`).
- **No exercício**, a origem aparece só depois de **resolvido ou revelado** (falha ou veredito incerto não bastam: a análise da partida entregaria a resposta). Antes disso, "Origem e histórico" mostra só o texto "Exercício de uma partida sua · meia-jogada N", sem link. O resumo diz quem jogou o lance (pela cor da partida: você, seu adversário ou "foi jogado" quando a cor não está definida), a classificação e a perda gravadas na revisão **dessa mesma posição** e o melhor lance; nada é inferido. Sem a partida (excluída), a seção avisa e não mostra link.
- **O retorno** usa a rota existente `/analysis/:gameId?ply=N`, que abre a posição depois do lance N com a revisão dele. Abrir um lance por link **não** conta como revisão de uma marcação: só o link da lista "Posições marcadas" do painel (`&review=1`) marca como revisada a marcação que já existia ao abrir; uma marcação criada depois, na mesma tela, continua pendente (auditoria consolidada, AC-2).

### 5.2 Tipos e objetivos (`goalFor`)

| Tipo | Quando | Lances do usuário |
|---|---|---|
| Mate | A melhor linha é mate forçado para quem joga | N do "mate em N" (máx. 4; com N > 4, o aluno joga 4 lances que mantêm o mate em N forçado) |
| Sequência | A melhor linha ganha ≥ 2 pontos em ponto estável | ⌈meias-jogadas até o ganho / 2⌉, de 1 a 3: o primeiro corte da linha cujo ponto estável (recapturas pendentes incluídas) já tem o ganho, não o horizonte da medição. Um ganho no 1º lance vira "lance único" |
| Defesa | Tema defensivo (mate permitido, peça desprotegida, ameaça, cravada…) ou qualquer motivo **do adversário** (garfo, combinação sofridos…) | 1 |
| Conversão | Sem ganho material, posição vencedora (≥ 80%) | 2 |
| Lance único | Demais casos | 1 |

Quando o motivo é do adversário, o objetivo é defensivo ("evite a tática do adversário"), nunca "ganhe material". O título do exercício (o tema) fica oculto até o fim da primeira tentativa, porque entrega o motivo.

### 5.3 Árvore de solução (`buildSolutionTree`)

Construída com o motor ao criar o exercício: em cada posição do usuário, busca MultiPV (≥ 3) → **lances aceitos** = todos dentro da tolerância (padrão 5 p.p.) do melhor. Em metas de **conversão**, também é aceito todo lance que mantém a expectativa ≥ 80% (`keepWinOf`, Sprint 4.7, PD-2): o objetivo é manter a vantagem decisiva, e perto de 100% a expectativa satura (de +12 para +5 a perda é 11,2 p.p., mas a vantagem continua decisiva). Em metas de mate, só são aceitos lances que mantêm mate forçado **dentro do orçamento de mate** (N do mate em N menos os lances já jogados; a expectativa de vitória não distingue mate em 2 de mate em 5). Uma árvore nunca fica com a raiz vazia: se nenhum lance passar no filtro, a raiz usa os lances aceitos da análise da partida. Na raiz, o lance principal da análise da partida fica em primeiro quando continua aceito (a nova busca pode reordenar lances empatados), e até 2 lances aceitos são expandidos; abaixo dela, o principal. Cada lance expandido recebe até 2 **respostas do adversário que são defesas reais** (`defenseRepliesFrom`), recursivamente até o limite de lances. A expectativa de vitória satura em posições perdidas (todas as respostas valem ~0% para quem defende), então ela não basta: quando quem defende está levando mate, só a resposta com o **mate mais longo** (a mesma distância da melhor defesa) é aceita; nos demais casos a resposta precisa estar a até **50 centipawns** da melhor defesa, além da tolerância em p.p. Assim o adversário nunca "colabora" acelerando o mate ou entregando material.

### 5.4 Validação (`playSolverMove`)

1. Lance ilegal → recusado sem registro.
2. Xeque-mate dado pelo usuário → resolvido.
3. Lance na lista de aceitos → aceito. Fora da lista → **busca comparável**: uma única busca a partir da posição atual, restrita ao lance de referência e ao lance do aluno (`searchmoves` do UCI), de modo que as duas pontuações vêm da mesma busca e da mesma profundidade (antes, uma pontuação guardada era comparada com outra busca, sujeita a ruído). Se o motor não devolver as duas linhas, usa-se a busca da posição resultante. O lance é aceito se a perda ficar dentro da tolerância, ou, em metas de conversão, se a expectativa depois dele continuar ≥ 80% (e, em metas de mate, se o mate continuar forçado dentro do limite, contando o próprio lance). Lances que terminam a partida (afogamento, empate) são julgados pela pontuação terminal, sem motor.
4. **Zona de incerteza**: se a perda ficar entre a tolerância e tolerância + 3 p.p., o lance é verificado de novo com 4 de profundidade a mais. Se continuar nessa faixa, o veredito é **"incerto"**: o ChessQuest informa a perda medida e diz que não há confiança suficiente para considerar o lance certo ou errado. **Nada é registrado** (nem tentativa, nem revisão espaçada, nem evidência). Acima da faixa, o lance é recusado.
5. Sem motor disponível, um lance fora da lista **não** é julgado ("não verificável", nada é registrado).
6. Aceito: se atingiu o limite de lances → resolvido. Senão, o adversário responde com uma das respostas da árvore (escolha aleatória entre as equivalentes, para variar o treino); se o lance era uma alternativa não expandida, o motor calcula a resposta e o próximo nó na hora. Sem motor nesse caso, o exercício termina como resolvido, com aviso de que a continuação não foi verificada.
7. Limite rígido: 4 lances do usuário por exercício.

**Explicação do lance recusado** (Sprint 4.6, B1; `services/exercises/refutation.ts`). A regra de acerto e erro não muda: só o texto muda.

- **Refutação**: a resposta do adversário e até 4 meias-jogadas, em SAN numerada, tiradas da linha do lance do aluno na **mesma** busca comparável que o recusou. Se essa busca não trouxe resposta, ou se o veredito veio da busca da posição resultante, nenhuma refutação é mostrada, e o texto diz "o motor avalia que…".
- **Consequência**, a primeira regra que se aplica:
  1. a pontuação do lance é mate contra o aluno → "permite mate em N";
  2. a linha do lance chega a um ponto estável (§4.2) com perda de material ≥ 3 pontos, e a linha de referência, **também em ponto estável**, não perde o mesmo → "perde material (cerca de uma peça/torre/dama)" (3–4, 5–7, ≥ 8 pontos). Sem linha de referência estável não há comparação, e a regra de material não é usada (auditoria consolidada, AC-7): o melhor lance poderia perder o mesmo material;
  3. a linha de referência ganha, em ponto estável, ≥ 3 pontos a mais que a do aluno → "deixa de ganhar material (cerca de …)";
  4. senão, a mudança de faixa de expectativa, do lance de referência para o do aluno: vantagem decisiva (≥ 80%), vantagem (≥ 60%), igualdade (> 40%), desvantagem (> 20%), posição perdida. Na mesma faixa: "reduz a vantagem", "piora a posição" ou "piora uma posição já difícil".
- A perda em p.p., a tolerância e a profundidade ficam em "Detalhes do motor", recolhido.
- "Ver a refutação no tabuleiro" reproduz a linha a partir da posição depois do lance. É só exibição: não grava tentativa nem altera a revisão espaçada.

O registro de tentativa distingue: resolvido sem ajuda, com dicas (cada dica conta; repetir depois de errar na mesma sessão conta como uma dica) e solução consultada. **A dica 3 mostra o lance**: a partir dela, a tentativa conta como solução revelada (sem crédito, volta em 10 minutos), e o botão avisa antes (Sprint 4.4). A tentativa revelada é gravada **no momento em que a dica 3 aparece**, como em "Ver solução": sair da tela ou recarregar antes de jogar não transforma o lance mostrado em acerto independente. Depois disso, "Resolver de novo" conta como ajuda, como depois de ver a solução (auditoria pós-merge A2-1 e A2-2). Assim "com ajuda" significa ter precisado de uma pista, não ter recebido a resposta.

Dicas progressivas: 1 = o tipo de lance (mate imediato, xeque, captura, ataque duplo ou lance tranquilo), calculado da posição — o tipo de peça só é citado quando o jogador tem mais de uma peça desse tipo (citar "a dama" ou "o rei" já apontaria a peça, que é a dica 2); 2 = a casa da peça a mover; 3 = o lance.

**Repetição de prática**: uma tentativa feita menos de 10 minutos depois da tentativa anterior do mesmo exercício (por exemplo, "Resolver de novo" logo após ver a dica 3 ou a solução) não é registrada: não muda a repetição espaçada nem gera evidência de competência.

Dificuldade (1–5): base 2; +1 se o primeiro lance é tranquilo (sem captura/xeque); **+1 se o primeiro lance é um sacrifício** (captura com SEE negativa, ou a peça movida fica capturável com ganho — por exemplo Qh6+!! Kxh6); +1 se exige ≥ 3 lances; +0,5 se exige 2 lances (exceto capturas); −1 para captura simples; −0,5 se há várias soluções.

**Exercícios repetidos**: posições são comparadas **sem os contadores de lance**. A mesma posição alcançada em outro número de lance, em outra partida ou repetida na mesma partida não gera um segundo exercício.

Exercícios criados antes desta versão (esquema v1, linha única) são convertidos para a árvore na migração do banco para o esquema v2.

## 6. Repetição espaçada

Leitner simples (`services/scheduling/srs.ts`), intervalos padrão 1, 3, 7, 14, 30, 60 dias:

- Erro ou solução revelada → caixa 0, volta em 10 minutos.
- Acerto com 1 ou 2 dicas → mantém a caixa, metade do intervalo (mínimo 1 dia). Depois da dica 3 (o lance), conta como solução revelada.
- Acerto independente → agenda pelo intervalo da caixa atual e sobe uma caixa.

Treinos de linhas de abertura do repertório usam o mesmo agendador (erro → revisão em 10 minutos).

**Treino de linhas de abertura** (`services/openings/practice.ts`):

- Transposição: se o usuário joga antes o seu próximo lance da linha e, depois da resposta do adversário prevista na linha, o lance pulado leva exatamente à posição da linha (sem contar os contadores), a linha continua. O lance pulado continua devido.
- Desvio sem transposição: o motor compara o lance com o melhor (profundidade 12). Com perda ≤ tolerância dos exercícios (padrão 5 p.p.), o lance é "fora do repertório, mas jogável": o treino termina sem registrar erro. Acima disso, ou sem motor disponível, conta como erro.

**Identificação da abertura de uma partida** (`matchOpening`): a posição mais avançada de uma linha da biblioteca que **aparece na partida**, comparando posições (FEN sem contadores) e não sequências de lances — assim transposições contam (1.d4 Nf6 2.Bf4 d5 3.e3 e6 é o Sistema Londres). A partida precisa chegar à **posição que define a abertura** (por exemplo, Italiana = 3.Bc4, Ruy López = 3.Bb5, Najdorf = 5…a6). Antes disso não se atribui nome da biblioteca (usa-se o cabeçalho do PGN ou o ECO, se houver).

## 7. Perfil de competências

Competências: visão tática, cálculo, identificação de ameaças, defesa, estratégia, aberturas, finais, reconhecimento de padrões.

**Evidências** (`SkillEvent`, todas rastreáveis a uma partida/lance, exercício ou linha de abertura):

| Fonte | Peso | Resultado |
|---|---|---|
| Exercício | 1 (1/k na k-ésima tentativa do mesmo exercício) | 1 sem dica; 1 − 0,25·dicas com 1 ou 2 dicas; 0 se errou, viu a solução ou pediu a dica 3 (o lance). Exercícios com sequência ≥ 3 meias-jogadas também contam para "cálculo" (peso 0,5) |
| Lance de partida (fase: abertura/meio-jogo/final) | 0,2 | 1 bom+, 0,5 imprecisão, 0 erro |
| Erro de partida com conceito verificado | 0,5 | 0 na competência do conceito, se for uma competência em que a partida também registra sucesso (ver abaixo) |
| Oportunidade aproveitada (ganho ≥ 2 encontrado, mate encontrado, único lance que manteve uma posição não vencedora (< 60%) → defesa, peça ameaçada salva) | 0,5 | 1 |
| Treino de abertura | 0,5 | 1 / 0 |

**Estimativa**: Beta(1,1) + Σ peso_efetivo·resultado (α) e Σ peso_efetivo·(1−resultado) (β). Mostra-se a média e o intervalo de credibilidade de 90% (aproximação normal da Beta). Nenhum rating é inferido; nenhum dado inicial é exigido.

**Competência de cada evidência** (`skillOf`): um motivo tático que o **adversário** pôde usar (ataque duplo, ataque descoberto, cravada, sobrecarga, desvio) mede **identificação de ameaças**; o mesmo motivo **não aproveitado pelo jogador** mede visão tática / reconhecimento de padrões. O mesmo vale para a competência dos exercícios gerados.

**Peso efetivo** (`effectiveWeights`):

- Decaimento por idade com meia-vida de 120 dias (o perfil acompanha o desempenho recente). A idade de uma evidência de partida é contada **da data em que a partida foi jogada** (data do PGN; sem data confiável, a data de importação), e não da análise (Sprint 4.4): analisar hoje uma partida de um ano atrás não torna os erros dela recentes, e reanalisar não muda a data. As evidências gravadas antes disso são redatadas ao abrir o app (só o campo `at` dos eventos de partida).
- Tentativas repetidas do **mesmo exercício** valem 1/k (k = ordem da tentativa): resolver 15 vezes a mesma posição soma ≈ 3,3, não 15.
- Uma partida contribui com no máximo peso 1 por competência (uma partida tem poucos exemplos de cada tema).
- **Exclusões** (Sprint 4.5): excluir uma partida remove também as evidências das tentativas nos exercícios dela, como já fazia a exclusão de um exercício. Evidências de exercícios que não existem mais (deixadas por exclusões de partidas antes da 4.5) são removidas ao abrir o app (decisão D-5). Evidências de partidas e de aberturas nunca são tocadas por essa limpeza. Um backup restaurado sem a tabela de exercícios (arquivo editado à mão) tem as evidências de exercício tratadas da mesma forma, porque elas apontam para exercícios que não existem no banco.
- Evidência de partida só é registrada a partir de conceitos **verificados** (§4.3) e de ameaças "en prise" reais (lances legais + SEE).
- **Só competências que a partida mede nos dois sentidos** (Sprint 4.7, PD-1; `GAME_SUCCESS_SKILLS`): fases (aberturas, estratégia, finais), visão tática, reconhecimento de padrões, defesa e identificação de ameaças. Uma partida mostra erros de **cálculo** (captura que perde material, desvio não aproveitado), mas nenhuma regra registra um acerto de cálculo numa partida; uma série dessas evidências seria só de fracassos e apontaria "Precisa revisar" qualquer que fosse o nível do jogador. Por isso esses erros não viram evidência, e os gravados antes da 4.7 são ignorados na estimativa e no gráfico (`isMeasurableEvidence`). Eles continuam visíveis como padrões de erro recorrentes (contagem, não taxa), e o cálculo continua medido pelos exercícios.
- Nenhuma evidência **positiva** (nem de fase) vem de um lance sem escolha real: único lance legal, ou posição em que o adversário já tinha mate forçado antes do lance.

**Diagnóstico histórico e evolução recente** (Sprint 4.5, decisão D-4 B). O perfil responde a duas perguntas diferentes:

- **Evolução recente**: a estimativa principal, com o decaimento acima. É o que move estado, tendência e dificuldade-alvo.
- **Diagnóstico histórico**: a mesma estimativa Beta com **todas** as evidências, partidas antigas incluídas, **sem decaimento** (o 1/k por repetição continua). É mostrado com o período coberto ("Diagnóstico histórico: 40% (…) · 60 evidência(s) de 01/2025 a 03/2025") e serve de ponto de partida para quem importa histórico.

Falta de dados recentes não é falta de habilidade: um jogador que só importou partidas antigas vê "Sem evidência recente" e o diagnóstico histórico, e não "Precisa revisar".

**Estado da competência** (cinco estados mostrados ao jogador):

| Estado | Regra |
|---|---|
| Sem evidência recente | última evidência há > 30 dias, com ≥ 2 de peso bruto (com menos, "evidências insuficientes"). Avaliado antes dos demais |
| Evidências insuficientes | peso efetivo < 2 |
| Precisa revisar | taxa recente (eventos **do mesmo tipo** nos **últimos 30 dias**, no máximo os 8 mais novos e no mínimo 4, ver Tendência) 20 p.p. abaixo da taxa desse tipo; **ou limite superior do intervalo de 90% < 50%** (claramente abaixo de 50%, mesmo sem queda recente), **medido só sobre as evidências dos últimos 30 dias** (qualquer tipo, repetições com peso 1/k, sem decaimento) **e desde que sejam pelo menos 4** (auditoria final da 4.5, FA-1 e FA-7). Erros de semanas ou meses atrás não pedem revisão: nem com uma única evidência recente (que não troca "Sem evidência recente" por "Precisa revisar"), nem com uma amostra recente boa (quem acertou os exercícios recentes não é mandado revisar por erros antigos). O diagnóstico histórico continua mostrando a fraqueza antiga |
| Consolidada (provisório) | peso ≥ 10, média ≥ 75%, limite inferior ≥ 60% **e** acertos independentes em ≥ 5 exercícios distintos, **dos quais ≥ 2 com dificuldade ≥ 3** (capturas triviais sozinhas não consolidam) |
| Em desenvolvimento | demais casos ("evidências iniciais" quando o peso é < 6) |

Antes, uma competência com muitas evidências e taxa baixa aparecia como "desempenho consistente", o que soava positivo.

**Exibição**: com poucas evidências, ou só com evidências antigas ("sem evidência recente"), o perfil mostra só o intervalo da evolução recente ("entre X% e Y%"), sem o número central; o diagnóstico histórico mostra o número quando tem peso ≥ 2.

**Tendência**: compara os eventos recentes com os 8 anteriores a eles (≥ 4); diferença > 10 p.p. → subindo/caindo. **"Recente" é uma janela de tempo** (auditoria independente da 4.5, AI-1): só entram eventos dos últimos 30 dias, no máximo os 8 mais novos, e são necessários pelo menos 4. Abaixo disso não há taxa recente, tendência nem "Precisa revisar" por queda. Antes, uma única evidência recente fazia eventos de semanas ou de um ano contarem como "recentes". A linha de base da comparação pode ser mais antiga, porque a tendência compara agora com antes. A comparação usa **um só tipo de evidência** (Sprint 4.5): as medições diretas (exercícios e treinos de abertura) quando existem, senão os lances de partidas. Misturar tipos fazia a troca de tipo parecer evolução: lances de partidas antigas seguidos de exercícios de hoje viravam "subindo".

**Influência da dificuldade**: a dificuldade não pondera a estimativa, porque não há dados para calibrar pesos por dificuldade sem arbitrariedade. Ela entra no critério de consolidação (acima) e na dificuldade-alvo.

**Dificuldade-alvo**: começa em 1; duas vitórias independentes seguidas em exercícios de dificuldade ≥ alvo sobem 1; um erro desce 1. O filtro "No meu nível" mostra exercícios a ±1 do alvo. O tempo de resposta é registrado, mas não entra no cálculo.

## 8. Recomendações e dashboard

"Seu próximo treino" (Sprint 4.1: ciclo adaptativo; detalhes em `docs/SPRINT4-1-RELATORIO.md`), em ordem de prioridade:

1. **Muitas revisões vencidas** (≥ 5, metade da meta diária padrão): as revisões vêm primeiro, e a mensagem cita o padrão que vem depois delas.
2. **Padrão de erro recorrente** nas **10 partidas analisadas mais recentes** (pela data do PGN; empate desfeito pela importação). Uma data só é confiável se for uma data de calendário real (`AAAA.MM.DD`, ano ≥ 1400) e não posterior ao dia da importação; partidas sem data confiável (ausente, incompleta como `2024.??.??`, inválida como `2023.13.45` ou futura) nunca recebem uma data inventada: contam como as mais antigas, só entram na janela se faltarem partidas datadas, e a mensagem diz quantas estão nela. O padrão é o mesmo conceito verificado **do mesmo lado** em pelo menos 2 lances do usuário (com a cor definida). O lado faz parte do padrão: permitir um ataque duplo ("Ataque duplo do adversário") e deixar de aplicar um ("Ataque duplo não aproveitado") são fraquezas diferentes, com conselhos diferentes. A recomendação lista os lances que a justificam, com link para a posição. A prioridade é `ocorrências recentes × fator do desempenho nos exercícios do mesmo padrão`:
   - cada exercício conta **uma vez**, com o resultado da última tentativa registrada; entram os 10 exercícios do padrão tentados mais recentemente;
   - menos de 3 exercícios: **amostra insuficiente**, fator 1 (nada muda);
   - acerto **sem ajuda** < 50%: **dificuldade**, fator 1,5 (acertos com dica não contam como independentes);
   - ≥ 5 exercícios, ≥ 80% sem ajuda e ao menos 2 deles de dificuldade ≥ 2: **dominado nos exercícios**, fator 0,5; qualquer revisão vencida passa à frente dele;
   - caso contrário, fator 1.
   O histórico antigo continua nas telas de progresso; só deixa de decidir a recomendação.
3. Revisões pendentes.
4. **Padrão em dificuldade só nos exercícios** (sem recorrência recente nas partidas), com os números dos exercícios.
5. **Competência que precisa de revisão**, com os números que a sinalizaram (taxa recente, intervalo, quantidade de evidências) e link para os exercícios dessa competência (`/train?skill=…`).
6. Mais diagnóstico (competências com evidências insuficientes); sem partidas, convida a importar.

**Revisão vencida** = exercício já tentado cuja data de revisão chegou (`srs.lastReviewedAt` definido e `dueAt ≤ agora`). A barra lateral, o dashboard e a Evolução usam essa mesma regra (Sprint 4.5), e a barra lateral recalcula a cada minuto, então uma revisão que vence com o app aberto aparece sem recarregar. Um exercício novo nasce com `dueAt` = criação, mas é material novo, não revisão; na lista de treino ele continua marcado "Pendente" como antes. Exercícios de motivo bilateral criados antes de existir `motifSide` contam como tática do próprio jogador.

**Sessão guiada** (`/train/session`): fila de até `dailyGoal` exercícios, sem repetir nenhum, nesta ordem: revisões vencidas (mais atrasadas primeiro), exercícios do foco recomendado, exercícios a ±1 da dificuldade-alvo da competência. Exercícios não vencidos cuja última tentativa foi um acerto sem ajuda ficam de fora: a repetição espaçada já decidiu quando eles voltam. Também ficam de fora os tentados há menos de 10 minutos (janela de prática), porque uma nova tentativa não seria gravada. O plano fica só no armazenamento local do navegador, válido até o fim do dia ou até "Encerrar"; os resultados são as tentativas normais (mesma janela de prática, mesmo reagendamento, mesmas evidências de perfil).

**Revisão vencida na tela Treinar** (auditoria FA-4, Sprint 4.6): a tela Treinar também recalcula a cada minuto (o mesmo `useMinute` da barra lateral e do dashboard). O botão "Pendentes (N)" mantém sua regra (revisões vencidas e exercícios novos), e a passagem do tempo só muda o que é exibido: nenhuma tentativa, evidência ou agenda é gravada.

**"Minhas partidas estão melhorando?"** (Evolução, Sprint 4.6, B3; `seriousErrorTrend` em `services/stats/stats.ts`):

- **Métrica**: erros sérios por partida (até a Sprint 4.6 a tela dizia "erros graves", o mesmo nome da classe `blunder`; renomeado na 4.7 para não confundir) = lances **do usuário** classificados como `mistake` ("Erro") ou `blunder` ("Erro grave") ÷ partidas. Usa a classificação já gravada na análise; os lances do adversário não contam. **Exceção (Sprint 4.7, PD-2, decisão do usuário):** não conta o lance depois do qual a expectativa de quem moveu continua ≥ 80% (`DECISIVE_WIN_PERCENT`, a faixa "vantagem decisiva"). Perto de 100% a expectativa satura, e +12 → +5 (97,5% → 86,3%, perda de 11,2 p.p.) é classificado como "Erro" sem mudar o resultado da partida. A análise mantém a classificação; a mudança vale só para esta contagem, e a série mostrada antes desta versão pode diminuir. O perfil de competências (evidência de fase) e os padrões de erro recorrentes continuam usando a classificação gravada: a exceção, decidida para este indicador, não foi estendida a eles.
- **Amostra**: só partidas com análise concluída e cor do usuário definida.
- **Ordem**: pela data do PGN (`gameTime`). Partidas sem data confiável contam como as mais antigas, como na recomendação. A hora da importação só desempata partidas da mesma data (ou sem data), nunca substitui a data da partida.
- **Janelas**: as N partidas mais recentes contra as N imediatamente anteriores, sem sobreposição. N = 10 a partir de 20 partidas; de 6 a 19 partidas, N = metade do total arredondada para baixo (com total ímpar, a partida mais antiga fica de fora). Com menos de 6 partidas: "Sem partidas suficientes".
- **Direção**: diferença = média recente − média anterior, arredondada a 3 casas. Abaixo de 0,3 erro por partida em valor absoluto: "Estável em relação às partidas anteriores". A partir de 0,3: "Menos erros sérios por partida" (diferença negativa) ou "Mais erros sérios por partida" (diferença positiva). A tela mostra as duas médias e o tamanho das duas amostras, e não atribui causa à mudança. **Amostra pequena**: com 3 partidas por grupo (6 ou 7 partidas), um único erro já muda a média em 0,33, acima do limiar. Nesse caso a direção é mostrada sem a cor de melhora ou piora e com o aviso "Amostra pequena" (revisão independente, M1). **Partidas sem data** nas janelas comparadas: a tela diz quantas são e que entram como as mais antigas, e a direção também perde a cor, porque partidas recentes sem data podem inverter a comparação (auditoria consolidada, AC-5).
- **O que mede e o que não mede**: mede a frequência dos seus erros sérios por partida, segundo a classificação do motor gravada. Não mede força enxadrística, precisão por lance, imprecisões, qualidade das vitórias nem a força dos adversários; partidas curtas e longas pesam igual; uma reanálise em outra profundidade pode mudar classificações. Menos erros sérios é um sinal, não uma prova de melhora geral.
- Substitui "Análises feitas por dia", que media uso do app, não qualidade das partidas.

**Datas exibidas** (auditoria FA-3, Sprint 4.6). A data do PGN é guardada como 00:00 UTC do dia da partida e é lida em UTC; qualquer outro instante (importação, tentativa de exercício, evidência de partida sem data no PGN, nome do arquivo de backup) é lido no calendário local. Um instante é tratado como data do PGN quando cai exatamente às 00:00:00.000 UTC, que é o que `gameTime` produz; um relógio em milissegundos praticamente nunca produz esse valor. Vale para o dia dos gráficos de evolução por competência e para o mês da linha "Diagnóstico histórico".

O dashboard mostra partidas analisadas (de quantas importadas), exercícios resolvidos, acerto independente, revisões pendentes, desempenho recente por dia, padrões de erro recorrentes e as competências **agrupadas por estado** (precisam revisar, em desenvolvimento, consolidadas, evidências insuficientes) com o intervalo de cada uma — sem rating.
