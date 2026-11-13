# Sprint 4.6 — Planejamento

> **Decisão do usuário (2026-11-08): Alternativa B.** Ordem prevista: B1 → PA-1 + B3 → B2 (cortável), com FA-3, FA-4 e o aviso do solucionador (FA-5).
>
> **Situação (2026-11-08), branch `feat/sprint4-6-understand-mistakes`, sem commit:**
>
> | Item | Situação |
> |---|---|
> | B1 (com o aviso do solucionador, FA-5) | Implementado e validado; revisão sem achados graves |
> | PA-1 | Implementado e validado; medição em `SPRINT4-6-PA1-B3-RELATORIO.md` §6 |
> | B3 | Implementado e validado |
> | FA-3 | Implementado e validado |
> | FA-4 | Implementado e validado |
> | B2 | Implementado e validado; relatório em `SPRINT4-6-B2-RELATORIO.md`. Revisão independente sem achados críticos, altos ou médios pendentes |
> | Auditoria consolidada (2026-11-09) | Aprovada com ressalvas: 7 achados médios corrigidos, débitos LOW documentados. `SPRINT4-6-AUDITORIA-CONSOLIDADA.md` |

Proposta original, escrita antes da implementação e aprovada como Alternativa B. O que foi entregue está na tabela de situação acima e nos relatórios de cada etapa. Base: `main` em `302f7a9` (merge do PR #8). O diagnóstico completo está em `docs/POST-SPRINT4-5-AUDITORIA.md`.

## 1. Diagnóstico

**Integridade e correção.** A auditoria pós-Sprint 4.5 não encontrou P0 nem P1:

- As relações entre partida, exercício, tentativa e evidência estão protegidas por transações.
- A suíte completa passa na `main` (401 Vitest, 23 com o motor real, 59 Playwright).
- O schema não mudou e o Stockfish está íntegro.

Portanto, a Sprint 4.6 **não precisa** ser uma sprint de emergência.

**O gargalo é pedagógico.** O app identifica bem **onde** o usuário errou e **quanto** perdeu, mas explica pouco **por que** o lance falha:

- **No exercício**, um lance errado recebe "X não resolve: a expectativa cai 23,4 p.p. em relação ao melhor lance (tolerância 5)". Não aparece a resposta do adversário que pune o lance, embora a busca do motor que fez esse julgamento já tenha calculado a linha (`sequence.ts:327`; `MoveAssessment` guarda só os placares).
- **Na análise**, um erro sem motivo tático verificado recebe só a avaliação e o melhor lance (`explain.ts:338`, confiança "limited").
- **O ciclo não fecha nas pontas:**
  - Na análise, um lance que já virou exercício não mostra isso nem leva até ele. O botão "Criar exercício" só avisa "Já existe".
  - A Evolução mede exercícios e competências, mas não mostra se **as partidas** estão melhorando, ou seja, menos erros graves por partida ao longo do tempo. O gráfico "Análises feitas por dia" mede atividade no app, não evolução.

**Dívida técnica relevante.** Há um P2 de desempenho (PA-1): cada posição analisada regrava a análise inteira, e as páginas abertas recarregam **todas** as análises a cada gravação. O custo cresce com o tamanho da biblioteca de partidas. Os P3 FA-2 a FA-6 foram reavaliados: FA-3 e FA-4 são triviais, FA-5 encaixa na entrega 1, e FA-2 e FA-6 podem esperar.

## 2. Objetivo

> **Fazer o usuário entender por que errou e ver se o treino chega às partidas.**

O problema central é que o treino mostra veredito e número, não a causa, e o usuário não consegue ver se treinar melhora o jogo.

## 3. Alternativas

### Alternativa A — Conservadora (confiabilidade e dívida)

| Item | Conteúdo |
|---|---|
| A1 | PA-1: gravação do progresso da análise com intervalo mínimo, e consultas de status sem carregar `positions`, com medição antes e depois |
| A2 | FA-2 (tipo da série escolhido dentro da janela recente), FA-3 (UTC só para data de PGN), FA-4 (`useMinute` na tela Treinar) |
| A3 | FA-5 (testes da inicialização em etapas e região viva sempre montada), FA-6 (teste com duas conexões), débito 3 da baseline (ações abaixo da dobra em 768 px) |

- **Impacto para o usuário:** baixo e pouco visível. Melhora a fluidez com muitas partidas e corrige casos de borda.
- **Risco:** baixo.
- **Esforço:** médio.

### Alternativa B — Evolução do produto (ciclo pedagógico), com as correções necessárias

| Entrega | Conteúdo |
|---|---|
| **B1. Refutação explicada no exercício** | Lance rejeitado: mostrar a resposta do adversário e a linha curta que punem o lance, vindas da mesma busca que o julgou. Traduzir a perda em consequência ("perde a dama", "permite mate em 2", "perde cerca de um peão"), em vez de só p.p. Permitir ver a linha no tabuleiro. Feedback numa região viva sempre montada (fecha FA-5 do solucionador) |
| **B2. Do erro da partida ao exercício, e de volta** | Na análise, lances com exercício derivado recebem um selo e um link "Treinar esta posição". Depois de resolver (ou revelar), o exercício mostra a explicação do erro original da partida (`whatHappened`/`betterAlternative`), com link para o lance na análise |
| **B3. "Minhas partidas estão melhorando?"** | Na Evolução, erros graves (erro/capivarada) por partida, pela **data da partida**, comparando as últimas N partidas com as N anteriores. Só aparece com amostra mínima, e mostra "Sem partidas suficientes" quando não há. Substitui "Análises feitas por dia" |

Correções incluídas porque são pequenas ou tocam a mesma área: **PA-1** (necessária para B3, que lê todas as análises), **FA-3** e **FA-4**.

- **Impacto para o usuário:** alto. Responde "por que meu lance não serve?" no momento em que a dúvida surge, e mostra se o treino chega ao jogo.
- **Risco:** médio (seção 7).
- **Esforço:** grande, se feito por inteiro (veja a seção 4 para a ordem de corte).

### Comparação

| Critério | A | B |
|---|---|---|
| Valor para o usuário | Baixo, quase invisível | Alto: muda o momento central do treino |
| Integridade | Mantida | Mantida: nenhuma mudança de schema prevista (selo e link calculados de `exercises.gameId` + `ply`) |
| Risco técnico | Baixo | Médio: texto pedagógico precisa ser correto; nova consulta pesada em B3 |
| Esforço | Médio | Grande |
| Dívida tratada | FA-2 a FA-6, PA-1, 768 px | PA-1, FA-3, FA-4, FA-5 (parte do solucionador) |
| Dívida que fica | — | FA-2, FA-6, teste da inicialização (FA-5), 768 px |

## 4. Recomendação

**Alternativa B**, em três etapas, com corte explícito caso o esforço estoure:

1. **B1**, a de maior impacto pedagógico, usando dados que o motor já calcula.
2. **PA-1 + B3**, com PA-1 antes, porque B3 adiciona mais uma leitura de todas as análises.
3. **B2**, cujo risco e esforço são os menores. Se a sprint precisar ser reduzida, B2 passa para a 4.7.

**Justificativa.** A auditoria não encontrou problema de integridade que exija prioridade sobre funcionalidades. Os P3 restantes têm impacto baixo e, os triviais, entram junto. O que mais limita a evolução do usuário hoje é entender o erro, não a confiabilidade dos dados. A Alternativa A deixaria o produto mais robusto sem mudar o que o usuário aprende.

## 5. Escopo proposto e critérios de aceite

### B1 — Refutação explicada

1. Um lance rejeitado na verificação comparável mostra o lance de resposta do adversário e uma linha de até 4 meias-jogadas, em SAN, tirados da linha (`pv`) do lance jogado na **mesma** busca que gerou o veredito.
2. A perda aparece como consequência concreta, com regras verificáveis:
   - mate contra o usuário → "permite mate em N";
   - diferença material na linha ≥ 3 → "perde a peça/qualidade/dama";
   - caso contrário, faixas de expectativa ("perde vantagem decisiva", "cede a vantagem") sem p.p. no texto principal.

   O valor em p.p. fica em detalhe recolhido.
3. Quando o caminho foi `measureAfter` (sem linha comparável) ou o motor não devolveu `pv`, o texto continua honesto ("o motor avalia que…"), sem inventar refutação.
4. "Ver a refutação no tabuleiro" mostra a linha sem alterar a tentativa nem o SRS.
5. O feedback fica num contêiner `role="status"` sempre montado (FA-5, solucionador).
6. Nenhuma tentativa muda de classificação: a regra de acerto/erro não é alterada.

### B2 — Do erro ao exercício

1. Na lista de lances da análise, a meia-jogada com exercício derivado tem um selo acessível (texto, não só ícone) e um link para `/train/:id`.
2. O botão "Criar exercício desta posição", quando o exercício já existe, vira "Abrir exercício".
3. O exercício, depois de resolvido ou revelado (nunca antes, para não entregar a resposta), mostra o resumo do erro original e o link para o lance na análise.
4. Exercícios sem `gameId` (manuais ou de abertura) não mostram nada disso.

> **Implementação (2026-11-08):** o resumo usa só dados gravados — o lance jogado (da partida), a classificação, a perda e o melhor lance (da revisão da análise, quando ela é da mesma posição) — em vez de regenerar o texto de `explainMove`. O selo é "Ex." com borda e nome acessível completo; o link do selo e o "Abrir exercício" levam a `/train/:id`; o retorno usa `/analysis/:gameId?ply=N`. Detalhes em `SPRINT4-6-B2-RELATORIO.md`.

### B3 — Partidas melhorando

1. Métrica: erros graves (classes `mistake` + `blunder`) do **usuário** por partida analisada com cor definida, ordenados pela data da partida (`gameTime`; partidas sem data contam como as mais antigas, como em `recentGames`).
2. Comparação: últimas N partidas contra as N anteriores (N = 10, ou metade do total se houver menos de 20). Com menos de 6 partidas no total aparece "Sem partidas suficientes".
3. Exibe os dois valores, a direção e a amostra ("últimas 10 vs. 10 anteriores"), sem chamar de "evolução" uma diferença menor que um limiar definido (p. ex., 0,3 erro/partida).
4. "Análises feitas por dia" sai da Evolução.

### Correções incluídas

- **PA-1:**
  - `onProgress` grava no máximo uma vez a cada X ms (e sempre ao concluir, pausar ou falhar);
  - a lista de partidas obtém o status sem carregar `positions`;
  - medição antes e depois com uma biblioteca sintética, registrada no relatório.
- **FA-3:** UTC só para horários vindos de `gameTime` (data do PGN); `importedAt` e exercícios no dia e mês locais.
- **FA-4:** `useMinute()` na tela Treinar.

### Arquivos e módulos prováveis

| Área | Arquivos |
|---|---|
| B1 | `src/services/exercises/sequence.ts` (veredito com `pv`/consequência), `src/features/training/useExerciseSession.ts`, `ExerciseSolver.tsx`, possivelmente `src/services/chess/material.ts` |
| B2 | `src/features/analysis/MoveList.tsx`, `ExplanationPanel.tsx`, `src/features/training/ExerciseDetails.tsx` / `ReferenceSolution.tsx`, `src/services/pedagogy/explain.ts` (reuso) |
| B3 | `src/services/stats/stats.ts` (nova função pura), `src/features/progress/ProgressPage.tsx`, `ProgressCharts.tsx` |
| PA-1 | `src/services/analysis/analysisRunner.ts` / `gameAnalyzer.ts`, `src/features/games/GamesPage.tsx` |
| FA-3/FA-4 | `src/services/stats/stats.ts`, `src/features/progress/SkillProfile.tsx`, `src/features/training/TrainingPage.tsx` |

**Sem mudança de schema Dexie, de dependências nem de motor.** Se B2 ou PA-1 precisarem de um índice novo, isso vira decisão separada do usuário, com migração e teste de upgrade.

## 6. Plano de testes

- **B1, unitários** (`tests/sequence*.test.ts`, motor roteirizado):
  - `rejected` traz a linha da mesma busca;
  - cada regra de consequência (mate, material, faixa);
  - sem `pv` → texto sem refutação;
  - a regra de acerto não muda.
- **B1, motor real** (`engine-integration`): uma posição conhecida em que o lance errado é refutado por um tema claro (p. ex., peça pendurada), com a refutação esperada.
- **B1, E2E:** lance errado mostra a resposta do adversário; "ver no tabuleiro" não grava tentativa; região `role="status"` presente antes do primeiro feedback.
- **B2:** unitário da associação lance ↔ exercício; E2E análise → selo → exercício → explicação depois de resolver, e ausência dela antes.
- **B3:** unitários com datas fixas (fuso de São Paulo, como em `evidence-dates`), amostra insuficiente, partidas sem data e sem cor; E2E com dados semeados.
- **PA-1:** teste de que a análise concluída/pausada/com erro é sempre gravada; contagem de gravações limitada; medição de desempenho registrada (não como teste instável).
- **FA-3/FA-4:** casos `importedAt` 23h30 de Brasília e exercício em 31/10 às 22h; E2E com relógio simulado na tela Treinar.
- **Regressão:** suíte completa, com metas de no mínimo 401 Vitest, 23 com motor real e 59 Playwright, e cobertura ≥ 80% em todas as métricas.

## 7. Riscos e dependências

| Risco | Mitigação |
|---|---|
| Texto pedagógico errado (refutação que não é a punição real) | Usar só a `pv` da mesma busca que julgou; sem `pv`, não afirmar refutação; teste com motor real |
| Linha do motor *lite* curta ou instável em profundidade baixa | Mostrar no máximo 4 meias-jogadas; consequência baseada em placar e material da linha, não em interpretação |
| Entregar a resposta antes da hora (B2) | Explicação só depois de resolver ou revelar; E2E cobre o "antes" |
| B3 incentivar conclusões com pouca amostra | Amostra mínima, limiar de diferença e texto que nomeia a amostra |
| Esforço total grande | Ordem B1 → PA-1+B3 → B2, com B2 cortável |
| Dependência: dados de partidas com cor definida | Sem cor, B3 mostra o motivo (como "Erros mais frequentes" já faz) |

## 8. Fora do escopo

- Jogar contra o computador.
- Login, nuvem, sincronização, telemetria, serviços pagos e IA generativa.
- Mudanças de schema Dexie, de dependências (inclusive ESLint) e do motor.
- FA-2, FA-6 e o teste da inicialização em etapas (parte de FA-5) na Alternativa B: ficam para a sprint seguinte.
- Débitos 2, 3 e 4 da baseline (limiares da época, 768 px, mate equivalente "Excelente").
- Coordenação completa entre abas e índice contra exercícios duplicados.
- Teste em celular físico (recomendado só se B1 mudar o layout do solucionador).

## 9. Estimativa relativa

| Entrega | Esforço |
|---|---|
| B1 | médio |
| B2 | pequeno a médio |
| B3 | pequeno a médio |
| PA-1 | pequeno a médio (inclui medição) |
| FA-3 + FA-4 | pequeno |
| **Alternativa B completa** | **grande** (médio sem B2) |
| Alternativa A completa | médio |

A decisão entre A e B, e se B2 entra, fica com o usuário.
