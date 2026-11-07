# ChessQuest — Sprint 3: relatório final

Data: 2026-11-03 · Ponto de partida: branch `fix/sprint3-phase1`, depois das 7 fases de correção da auditoria anterior ([AUDITORIA-SPRINT3.md](AUDITORIA-SPRINT3.md)). Nenhum trabalho anterior foi descartado e nenhum comando destrutivo de Git foi usado. As mudanças deste relatório foram commitadas em `7b82a53`.

## Linha de base (antes de qualquer alteração)

- 211 testes Vitest passando, incluindo a integração com o Stockfish real (o enunciado do sprint citava 161; o número tinha crescido nas fases anteriores).
- Typecheck limpo. A suíte E2E tinha 12 testes.
- Os defeitos abaixo foram **reproduzidos com o Stockfish 19 real** (mesmo WASM do app, em processo filho) ou com posições construídas, antes da correção. Cada um ganhou um teste de regressão.

## 1. Problemas encontrados

| # | Área | Problema reproduzido | Evidência |
|---|---|---|---|
| E1 | Exercícios | **O adversário "colabora"**: as respostas da árvore eram escolhidas por expectativa de vitória, que satura em 0% para quem está perdido. Por isso o adversário podia acelerar o mate ou entregar material. | Q+T × R, `8/8/8/4k3/8/8/2Q5/1R4K1 w`, mate em 7: depois de Kh2 Kf4 Rb5, a árvore aceitava **…Kf3 (mate em 2)** ao lado de …Ke3 (mate em 3). |
| E2 | Exercícios | **Falso negativo por ruído entre buscas**: um lance fora da árvore era julgado comparando a pontuação **guardada** do melhor lance (de uma busca anterior) com uma **nova** busca da posição resultante. As duas medições têm horizontes e profundidades diferentes. | Teste com motor simulado: na mesma busca os lances valem 20 e 15 cp, mas contra a pontuação guardada (60 cp) o lance válido seria recusado. |
| E3 | Exercícios | Não havia veredito de **incerteza**: uma perda de 5,1 p.p. com tolerância de 5 virava "errado" e era registrada como falha. | Regra de código (`judge`). |
| E4 | Exercícios | **Exercícios repetidos**: a deduplicação usava o FEN completo. A mesma posição com outro contador de lances (outra partida, repetição na mesma partida) gerava outro exercício. | `selectExercisePositions` e `addExercise`. |
| E5 | Exercícios | A **dificuldade ignorava sacrifícios**: Qh6+!! Kxh6 (dama entregue) recebia a mesma nota que um xeque comum. | `estimateDifficulty`. |
| E6 | Dicas | A dica 1 dizia "lance tranquilo **de a dama**" (erro de concordância) e, com uma única dama ou com o rei, **apontava a peça** tanto quanto a dica 2. | `motifHint`. |
| X1 | Explicações | **4.Nxe5? (armadilha Blackburne-Shilling) atribuído a "Princípios de abertura"** sempre que a linha do motor não mostrava perda de material em 6 meias-jogadas. O resultado dependia do estado do motor: o teste do corpus passava na suíte completa e **falhava quando rodado isoladamente**. | `r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4`, linha Qg5 Bxf7+ Kd8 Ng4 Nh6 c3 …, tema `opening`, competência "Aberturas". |
| X2 | Explicações | Faltavam duas das seis perguntas: **qual era a ameaça do adversário** e **o que acontece depois da alternativa**. | Estrutura de `Explanation`. |
| X3 | Explicações | Os tipos de erro não eram diferenciados: só havia "erro tático", "erro posicional" ou "questão de mate". Oportunidade perdida, erro de cálculo e erro estratégico apareciam todos como "Erro tático"/"Erro posicional", e lances bons não diziam se eram o melhor lance ou um equivalente. | `explainMove`. |
| X4 | Explicações | Falta de proporcionalidade: uma imprecisão sem causa verificada recebia a mesma lição completa ("conceito", "como reconhecer") que um erro grave. | `explainMove`. |
| X5 | Material | `settledSwing` encerrava a medição numa posição "calma" mesmo quando o **próximo lance da linha era uma captura**. Nos dois sentidos, a quiescência era incompleta: na primeira tentativa de correção, uma linha que termina numa captura sem recaptura possível (3.Nd4?? … Qxd5) passou a ser "não estabilizada" e o marcador "perda de material" sumia. Isso também foi corrigido (ver C9). | Teste de integração `analyzes a real game and flags the knight blunder`. |
| P1 | Perfil | Uma competência com **muitas evidências e taxa baixa** aparecia como "Desempenho consistente", com etiqueta verde. | 2 acertos em 10: intervalo de 90% de cerca de 5% a 45%, mostrado como "consistente". |
| P2 | Perfil | Um **garfo sofrido** era contado em "Reconhecimento de padrões", como se fosse uma tática própria não vista. O que falhou foi a identificação da ameaça do adversário. | `THEME_SKILL['fork'] = 'patterns'` aplicado aos dois lados. |
| P3 | Perfil | "Domínio provisório" podia ser alcançado **só com exercícios triviais** (dificuldade 1). | `estimateSkill`. |
| R1 | Recomendações | Um garfo **sofrido** gerava a mensagem "Houve N ataques duplos **não aproveitados**", porque os padrões não separavam o lado do jogador do lado do adversário. | `errorThemes` agrupava só por tema. |
| R2 | Recomendações | Sem padrão recorrente e sem revisões pendentes, uma competência sinalizada como "precisa revisar" **nunca virava recomendação**. | `nextTraining`. |
| D1 | Dashboard | Não havia evolução por competência no dashboard. "Partidas analisadas" aparecia só como nota de rodapé de "Partidas importadas". | `DashboardPage`. |
| O1 | Aberturas | A identificação usava **prefixo exato de lances**: transposições não eram reconhecidas (1.d4 Nf6 2.Bf4 d5 3.e3 e6 → sem nome). | `matchOpening`. |
| O2 | Aberturas | A linha Escandinava com …Qd6 termina em **+1,02** para as brancas (motor, profundidade 16), sem nenhum aviso ao aluno que a estuda com as pretas. | Conferência das 19 linhas com o motor. |

**Verificado e sem defeito**: as 19 linhas de abertura são legais. Nenhum lance de livro perde mais de 3,8 p.p. (o maior é o próprio 1…d5 da Escandinava). As posições finais ficam entre +0,04 e +0,66, exceto a linha O2. As variantes conferem com a teoria: Giuoco Piano, Dois Cavalos 4.Ng5 d5 5.exd5 Na5, Fechada/Trocas/Berlim, Ortodoxa e Trocas do GDR, Londres, Najdorf (6.Be3 e 6.Bg5), Francesa Avanço, Caro-Kann Clássica e Avanço, Escandinava. A persistência e as migrações não mudaram (esquema v2).

## 2. Problemas efetivamente corrigidos

| # | Correção |
|---|---|
| C1 (E1) | `defenseRepliesFrom`: com mate contra quem defende, só é aceita a resposta com a **mesma distância de mate da melhor defesa**. Nos demais casos, a resposta precisa ficar a até **50 cp** da melhor (além da tolerância em p.p.). Vale para a árvore e para as respostas calculadas ao vivo. |
| C2 (E2) | **Busca comparável**: o lance fora da árvore e o lance de referência são avaliados na **mesma busca** (`searchmoves`), na mesma profundidade. Se o motor não devolver as duas linhas, o sistema volta ao método antigo. |
| C3 (E3) | **Veredito "incerto"**: uma perda entre a tolerância e tolerância + 3 p.p. é verificada de novo com +4 de profundidade. Se continuar na faixa, o aluno é informado de que não há confiança suficiente, e **nada é registrado** (tentativa, revisão espaçada e perfil ficam intactos). |
| C4 (E4) | Deduplicação por posição **sem contadores**, entre partidas e dentro da mesma partida. |
| C5 (E5) | +1 de dificuldade quando o primeiro lance é um sacrifício (SEE negativa ou peça que fica capturável com ganho). |
| C6 (E6) | A dica 1 tem concordância correta e só cita o tipo de peça quando o jogador tem mais de uma. |
| C7 (X1) | Um lance forçante (captura, xeque ou promoção) sem motivo reconhecido vira o tema **"Lance forçante que não se sustenta"** (cálculo, explicação limitada) e nunca um tema de fase. O subconjunto de testes que falhava isoladamente agora passa nas duas formas de execução. |
| C8 (X2–X4) | Novas seções **"Qual era a ameaça do adversário"** (apenas fatos legais: mate em 1 no lance nulo ou peça capturável com ganho; omitida quando não há ameaça, nunca negada) e **"O que acontece depois da alternativa"** (linha do motor e avaliação). Etiqueta do **tipo de decisão**: erro tático, oportunidade perdida, erro de cálculo, erro estratégico, erro posicional, defesa em posição perdida, lance correto, lance equivalente. **Imprecisões não verificadas** recebem só os fatos. |
| C9 (X5) | Quiescência: a medição continua quando o próximo lance da linha é uma captura ou promoção. Uma linha que passa do horizonte e termina numa captura **sem recaptura legal** (e sem xeque) é considerada estável. Linhas curtas continuam sem verificação, como antes. |
| C10 (P1) | Quatro estados: **evidências insuficientes / em desenvolvimento / consolidada (provisório) / precisa revisar**. "Precisa revisar" também quando o limite superior do intervalo de 90% fica abaixo de 50%. |
| C11 (P2) | `skillOf`: motivos táticos do adversário (garfo, descoberto, cravada, sobrecarga, desvio) contam como **identificação de ameaças**, nas evidências das partidas e nos exercícios gerados. |
| C12 (P3) | A consolidação exige, entre os 5 exercícios distintos resolvidos sem ajuda, **pelo menos 2 com dificuldade ≥ 3**. |
| C13 (R1, R2) | Os padrões de erro passam a ser **tema + lado**, com rótulos ("Ataque duplo do adversário" / "… não aproveitado(a)") e conselhos próprios. Nova recomendação de **competência a revisar**, com os números que a justificam e filtro `/train?skill=…`. |
| C14 (D1) | Dashboard: "Partidas analisadas (de N importadas)", "Exercícios resolvidos" e um painel de **competências agrupadas por estado**, com o intervalo de cada uma (sem rating). Filtro por competência na tela Treinar. |
| C15 (O1, O2) | Abertura identificada **por posição** (transposições), mantendo a exigência da posição que define a abertura. Aviso na linha …Qd6 da Escandinava. |

**Decisões deliberadas de não alterar** (sem justificativa técnica suficiente):

- **Peso da dificuldade na estimativa**: não há dados para calibrar pesos por dificuldade sem arbitrariedade. A dificuldade passou a contar só no critério de consolidação (C12), além da dificuldade-alvo que já existia.
- **Crédito parcial em sequências** (B6 da auditoria anterior): continua pendente de decisão, porque muda o modelo.

## 3. Arquivos modificados

Serviços: `src/services/exercises/sequence.ts`, `generate.ts`, `validate.ts` · `src/services/chess/material.ts` · `src/services/pedagogy/concepts.ts`, `explain.ts` · `src/services/adaptation/skills.ts` · `src/services/recommendations/recommend.ts` · `src/services/stats/stats.ts` · `src/services/openings/library.ts` · `src/db/trainingRepo.ts` · `src/types/domain.ts` (tema `unsound_forcing`).

Interface: `src/features/training/useExerciseSession.ts`, `ExerciseSolver.tsx`, `TrainingPage.tsx` · `src/features/analysis/ExplanationPanel.tsx` · `src/features/dashboard/DashboardPage.tsx`, **`SkillStates.tsx` (novo)** · `src/features/progress/ProgressPage.tsx`, `SkillProfile.tsx` · `src/styles/features.css`.

Testes: `tests/sequence.test.ts`, `training.test.ts`, `pedagogy.test.ts`, `skills.test.ts`, `openings.test.ts`, `engine-integration.test.ts` · `e2e/mvp.spec.ts`, `e2e/a11y.spec.ts`.

Documentação: `README.md`, `docs/METHODOLOGY.md`, este relatório.

## 4. Funcionalidades aprimoradas

- **Exercícios**: o adversário sempre defende da melhor forma; alternativas válidas são julgadas na mesma busca do lance de referência; casos limítrofes são declarados incertos em vez de errados; não há exercícios duplicados; a dificuldade considera sacrifícios; a dica 1 não entrega a peça.
- **Explicações**: as seis perguntas pedagógicas (ameaça, motivo da falha, alternativa e continuação, conceito), o tipo de erro rotulado e o tamanho proporcional à gravidade. Capturas mal calculadas não são mais tratadas como "princípios de abertura".
- **Perfil**: os quatro estados pedidos; taxa baixa sinalizada para revisão; táticas sofridas medidas como identificação de ameaças; consolidação que exige exercícios não triviais.
- **Recomendações e dashboard**: padrões separados por lado, recomendação por competência com números, competências por estado no dashboard, filtro por competência no treino.
- **Aberturas**: identificação por posição; aviso honesto sobre a linha …Qd6.

## 5. Testes executados e resultados

| Verificação | Resultado |
|---|---|
| Vitest (unitários + integração + **Stockfish real**) | **234 passaram** (eram 211), 14 arquivos |
| Subconjunto do motor real que dependia do estado do hash (`-t "Sprint 3|outside the stored"`) | 8 passaram (antes, 1 falhava) |
| Cobertura (serviços + dados) | Linhas 89,3% · instruções 85,1% · funções 79,2% · ramos 78,2% |
| Playwright E2E | **17 passaram** (eram 12): fluxo completo, aberturas, backup, sequência, dicas, teclado, rótulos acessíveis, e **sem rolagem horizontal em 320/375/768/1024/1440 px** no dashboard, treino, evolução e aberturas |
| Requisições externas | Nenhuma (asserção do E2E principal) |
| Erros no console | Nenhum (asserção do E2E e conferência manual no navegador) |
| Typecheck | Limpo |
| Build de produção | Aprovado |
| Persistência e migrações | Esquema continua na v2; o novo tema é aceito pelo backup (que não restringe temas); testes de persistência passando |

Testes novos, um por defeito: E1 (unitário + motor real na posição Q+T × R), E2 e E3 (motor simulado, com verificação de `searchmoves` e da nova verificação mais profunda), E4, E5, E6, X1 (com a linha real), X2–X4, X5/C9 (captura iminente, captura sem recaptura, troca pendente), P1, P2, P3, R1, R2, O1, e E2E do dashboard e da etiqueta do tipo de erro. **Nenhum teste antigo foi removido.** Um teste foi ajustado ao critério de consolidação mais rigoroso: o caso de domínio passou a incluir exercícios de dificuldade 3, e um novo teste garante que só exercícios fáceis **não** consolidam.

Verificação manual no navegador (origem `audit.localhost`, separada dos seus dados): análise da partida Blackburne-Shilling. A explicação de 4.Nxe5 mostra a linha que refuta o lance, a alternativa Nxd4 e sua continuação, e o painel de competências aparece no dashboard.

## 6. Limitações restantes

- O veredito "incerto" depende de uma faixa fixa (tolerância + 3 p.p.); avaliações do Stockfish *lite* podem oscilar além disso em posições muito complexas.
- Exercícios e evidências **já gravados** mantêm a competência calculada na época (por exemplo, um garfo sofrido continua em "padrões"). Reanalisar a partida recalcula as evidências dela; exercícios antigos não são reclassificados.
- "Erro estratégico" é definido de forma estreita (perda de avaliação numa posição vencedora sem mudança de material). Planos e estrutura de peões continuam sem análise própria.
- A seção de ameaça só reconhece mate em 1 e peças capturáveis com ganho; ameaças de mate em 2+ ou de garfo no lance seguinte não são nomeadas.
- Motivos ainda não detectados: espeto, raio-X, interferência, ataque a peões que protegem peças (o 4…Qg5 da Blackburne aparece como "combinação" ou como "lance forçante que não se sustenta", e não como ataque duplo).
- A deduplicação de exercícios (`addExercise`) percorre a tabela inteira a cada inserção, porque não há índice por posição. Com centenas de exercícios o custo é desprezível; com milhares, a geração fica mais lenta. O índice pode entrar na migração v3 (prioridade 1).
- `src/db/trainingRepo.ts` importa `fenKey` de `services/analysis/gameAnalyzer`: a camada de dados passou a depender da camada de serviços. Funciona, mas a função deveria morar num módulo utilitário compartilhado.
- Navegar para `?ply=N` estando já na mesma partida não muda o lance exibido (vindo de outra tela, funciona).

## 7. Riscos conhecidos

- **Não determinismo do motor**: o mesmo lance pode receber linhas diferentes conforme as buscas anteriores (hash). Os testes do corpus agora passam nos dois modos de execução, mas outras posições limítrofes podem variar entre execuções.
- O critério de 50 cp para respostas "equivalentes" do adversário é uma escolha documentada, não calibrada com dados.
- A busca comparável depende de o motor respeitar `searchmoves` (o Stockfish respeita). Se outro motor não respeitar, o sistema volta ao método antigo, que é menos preciso.

## 8. Próximas prioridades recomendadas

1. **Reclassificar exercícios antigos** (competência por `skillOf`) numa migração v3, com teste de migração.
2. **Ameaças em 2 lances**: mate em 2 no lance nulo (via motor) e ataque duplo iminente, para a seção "ameaça do adversário".
3. **Motivo "ataque a peça + peão-defensor"** (4…Qg5 contra e5/g2), para que armadilhas clássicas de abertura sejam explicadas por padrão, e não como combinação.
4. **Crédito parcial em sequências** (B6), se aprovado: distingue "achou o 1º lance" de "não achou nada".
5. **Repertório de pretas contra 1.d4** (por exemplo, a Eslava): hoje as defesas de pretas da biblioteca cobrem só 1.e4. Uma linha bem escolhida, não muitas.
6. Calibrar a faixa de incerteza e a margem de 50 cp com um corpus maior de posições reais do usuário.
