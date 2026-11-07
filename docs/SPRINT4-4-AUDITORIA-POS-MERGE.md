# Sprint 4.4 — Auditoria pós-merge

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Commit auditado | `9e1243d45b721962ea35efc89c2f80a8350f06cf` (`origin/main`, merge do PR #6) |
| CI pós-merge | run `42392930558` (push na `main`, SHA `9e1243d`): **sucesso** |
| Veredito | **APROVADA COM RESSALVAS** (§11) |

Legenda: **[F]** fato verificado no código ou no GitHub · **[E]** resultado de execução · **[I]** inferência.

## 1. Identificação do commit auditado

| Item | SHA |
|---|---|
| `main` antes do merge | `e63c59b36ea5822c0647e49fa4b7f2216ffd8d2f` (merge do PR #5, Sprint 4.3) |
| HEAD revisado do PR #6 | `eaf76e17a0e4c24db7349c74ef6ae598a577c008` |
| Merge commit (= `origin/main`) | `9e1243d45b721962ea35efc89c2f80a8350f06cf`, pais `e63c59b` e `eaf76e1` |

## 2. Confirmação da integração do PR #6 [F]

- **Pré-condição:** na primeira verificação o PR #6 estava aberto, e a auditoria parou só com o diagnóstico. O usuário autorizou o merge na sequência.
- **Integração:** `state: MERGED`, `mergedAt: 2026-11-07T16:45:55Z`, por **merge commit** (`gh pr merge --merge --match-head-commit eaf76e1…`), sem squash nem rebase.
- **Conteúdo:** a árvore do merge é **idêntica** à do HEAD revisado (`git diff eaf76e1 9e1243d` vazio).
- **Repositório:** a branch de origem foi mantida, e não há PRs abertos.
- **Ambiente:** a auditoria rodou numa **worktree isolada e descartável** em `9e1243d`, com `npm ci`. O checkout de trabalho e a `main` não foram alterados. A pasta `.claude/` foi preservada.

## 3. Status da CI pós-merge [E]

Run `42392930558`, evento `push`, SHA `9e1243d` (o merge commit atual da `main`): **sucesso**.

- Vitest 366/366, incluindo `engine-integration.test.ts`, com 21 testes do Stockfish real.
- Build ok.
- Playwright 51 passed.

## 4. Resumo executivo

- **Integração:** a Sprint 4.4 está na `main`. CI pós-merge e reprodução local (typecheck, Vitest, motor real, cobertura, build, Playwright) passam no código integrado.
- **Testes:** as 10 mutações críticas foram refeitas no código integrado, numa cópia isolada, e todas foram detectadas.
- **Caso de referência:** confirmado com o Stockfish real pelo caminho integrado. O 15.Bxd7+ da Partida da Ópera é classificado como "erro grave" na profundidade 11 e **não vira exercício**.
- **Riscos:** nenhum risco de corrupção ou perda grave de dados (nenhum P0 ou P1).
- **Defeitos reproduzidos:** a auditoria reproduziu **dois defeitos P2** que enfraquecem objetivos da própria sprint:
  1. **A2-1:** recarregar a página depois da dica 3 apaga a informação de que o lance foi mostrado, e a tentativa conta como **acerto independente com crédito total**. O E2 só vale enquanto a tela não é recarregada.
  2. **A5-1:** com a profundidade de análise configurada acima de 16, a revalidação do O1 usa uma árvore **mais rasa** que a análise e pode **descartar um erro legítimo**.
- **Débitos P3:** cinco débitos de baixo impacto, documentados (§8).
- **Recomendação:** corrigir os dois P2 antes de a Sprint 4.5 aumentar a dependência do perfil e dos exercícios.

## 5. Escopo e metodologia

1. Confirmação no GitHub de estado do PR, merge commit, igualdade de árvore e CI do push.
2. Leitura de `BASELINE-MAIN.md`, `SPRINT4-3-RELATORIO.md`, `SPRINT4-3-AUDITORIA-POS-MERGE.md`, `SPRINT4-4-PLANEJAMENTO.md`, `SPRINT4-4-RELATORIO.md`, `METHODOLOGY.md`, `ARCHITECTURE.md` e do histórico Git (`1031e60`, `7870a0a`, `e63c59b`, `eaf76e1`, `9e1243d`).
3. Leitura do código integrado nos módulos tocados:
   - `analysisRunner.ts`, `analysisRepo.ts`, `gameDate.ts`;
   - `validate.ts`, `useExerciseSession.ts`, `ExerciseSolver.tsx`;
   - `AppShell.tsx`, `GamesPage.tsx`, `ExplanationPanel.tsx`, `generate.ts`;
   - `trainingRepo.ts`, `skills.ts`, `ProgressCharts.tsx`, `database.ts`.
4. Execução completa dos scripts na worktree isolada (§7).
5. **Sondas temporárias**, criadas só na worktree e descartadas:
   - Vitest com o Stockfish real (Partida da Ópera pelo caminho integrado);
   - Vitest com motor roteirizado (coerência de profundidade do O1);
   - Vitest de escrita depois de remoção (`recordAttempt`);
   - Playwright (dica 3 e recarregar).
6. **Mutações** refeitas na worktree, cada uma restaurada antes da seguinte.

## 6. Resultado por eixo

### A. Integridade temporal das evidências (E1): conforme, com um P3

- **[F]** `deriveFromAnalysis` usa `gameEvidenceTime(game, a.updatedAt)` (`analysisRunner.ts:123`). A data é a do PGN quando confiável. Senão, é a de importação. `fallback` só vale sem `importedAt`.
- **[F]** `gameTime` rejeita datas ausentes, incompletas (`????.??.??`, `2026.??.??`), inválidas (`2023.13.45`, `2023.02.30`), anteriores a 1400 e posteriores à importação + 1 dia. Os testes estão em `adaptive-boundaries` e `evidence-dates`.
- **[F]** `redateGameEvidence`:
  - roda numa transação `rw` sobre `games` e `skillEvents`;
  - filtra `source === 'game'` e altera **só `at`** via `bulkUpdate`;
  - pula eventos já corretos, então é idempotente;
  - deixa intocados os eventos de partidas inexistentes.
  - **[E]** Os testes de redatação, idempotência, preservação de eventos de exercício e abertura e "partida inexistente" passam, e as mutações M1–M3 foram detectadas.
- **Impactos:**
  - **[F]** O decaimento (meia-vida de 120 dias), a tendência e o estado "precisa revisar" agora seguem a data da partida.
  - **[F]** A revisão vencida (SRS) não depende de `skillEvents`, então não é afetada.
  - **[F]** A ordenação cronológica das partidas (`toAnalyzedInputs`) já usava `gameTime` e não mudou.
  - **[I]** Um usuário que só importou partidas com mais de 30 dias e tem ≥ 6 de peso bruto vê as competências como "Precisa revisar" (regra `stale` de `estimateSkill`). É coerente com a regra documentada ("conhecimento antigo é a revisar"), mas agora acontece também para quem acabou de começar a usar o app. Registrado como observação de produto (D-4), não como defeito.
- **[E] A4-1 (P3):** o dia do gráfico "Evolução da competência" desloca em fusos negativos (§8).

### B. Contabilização de dicas (E2): parcialmente conforme (A2-1 P2, A2-2 P3)

- **[F]** O nível 3 de `hintForNode` devolve "O lance é X" (`validate.ts`). Com 2 dicas usadas, o botão diz "Mostrar o lance (conta como revelada)", e o texto da dica e o retorno avisam.
- **[F]** `attemptResult` faz `correct && !revealed && !moveGiven` e `revealed || moveGiven`. O resultado é `exerciseOutcome = 0`, `outcomeOf = 'fail'` (caixa 0, 10 min) e evento sem `independent`. **[E]** As mutações M4 e o E2E `sequence.spec` (tentativa gravada como revelada) confirmam.
- **[E] A2-1 (P2):** a informação "a dica 3 foi vista" existe só no estado React. Recarregar ou sair da tela antes de jogar zera o estado, e a tentativa seguinte é gravada como **acerto independente** (§8).
- **[F] A2-2 (P3):** depois de resolver com a dica 3 (status `solved`), "Resolver de novo" zera `retries`. Depois de "Ver solução" (status `revealed`), o retry conta como uma dica (§8).
- **Retomada da sessão guiada:** usa o mesmo componente, então herda o A2-1.

### C. Contador de treinamento (E3): conforme

- **[F]** `AppShell.tsx` conta `where('srs.dueAt').belowOrEqual(now).filter(isDueReview)`, a mesma regra do dashboard (`DashboardPage.tsx:61`):
  - exercícios novos (sem `lastReviewedAt`) ficam de fora;
  - exercícios futuros ficam fora pelo índice `srs.dueAt`;
  - repetições de prática não regravam o exercício, porque `recordAttempt` sai antes.
- **[F]** A consulta é `useLiveQuery`. Ela recalcula a cada escrita em `exercises`, inclusive depois de `recordAttempt`, que faz `put` no exercício.
- **[E]** Coberto pelo E2E de 4 exercícios (2 novos, 1 vencido, 1 futuro), com a barra e o dashboard em 1. A mutação foi detectada antes do merge e a regra não mudou desde então.
- **[F] Limitação anterior à sprint:** um exercício que vence com o app aberto só entra no contador na próxima escrita em `exercises`, porque `Date.now()` é lido na consulta. Baixo impacto e sem registro novo.

### D. Troca de cor (E4): conforme

- **[F]** Na falha, `GamesPage.onColor` relê a partida (`g !== undefined && g.userColor === color`) e escolhe a mensagem por `colorChangeFailureMessage`. Nunca diz "não salva" quando a cor foi salva. **[E]** A mutação M5 foi detectada.
- **[F]** O aviso de análise em andamento usa `isRunning(gameId) || status === 'running'` e aparece desde o início. **[E]** Há E2E com análise real.
- **[F]** Fechar a aba no meio do processamento deixa a marca `'pending'`, que é reconciliada na próxima abertura. Partidas são independentes (`try/catch` por partida). Os testes da 4.3 continuam passando.

### E. Validação aprofundada de exercícios (O1): conforme no padrão, com A5-1 (P2) e A5-2 (P3)

- **[E] Caso de referência, Stockfish real e caminho integrado** (`startAnalysis` na profundidade 11 → `changeUserColor('w')`):
  - 15.Bxd7+ (meia-jogada 29) é classificado como `blunder` (`winLoss` 22,9);
  - a derivação termina com `exercisesAdded: 0`;
  - **nenhum exercício na meia-jogada 29**.
- **[F]** `acceptsPlayedMove` só descarta quando o **lance jogado** está entre os `accepted` da raiz da árvore. Exercícios em que a árvore não aceita o lance são mantidos. **[E]** Na sonda da Sprint 4.4 com 4 partidas, 15 de 16 exercícios foram mantidos.
- **[F]** Sem motor, ou com falha do motor, `completeExercise` devolve o exercício sem árvore, e `acceptsPlayedMove` dá `false`. O exercício é mantido. É um comportamento seguro: nada é descartado sem verificação, e a limitação está documentada.
- **[E] A5-1 (P2):** a árvore usa `min(analysisDepth, 16)` (`analysisRunner.ts:98`). Com a profundidade configurada em 20, a árvore é mais rasa que a análise e descarta o erro (§8).
- **[F] A5-2 (P3):** a proteção é coberta na suíte só por motor roteirizado. O caso real da Ópera não faz parte da suíte.
- **[F]** A tolerância da árvore é `settings.exerciseTolerance`, a mesma de `buildExercise`. É coerente.

### F. Remoção na troca de lado (O2/D3): conforme

- **[F]** A remoção acontece dentro da transação de `saveColorMarkingPending`, em `[games, analyses, exercises, attempts]`. Ela só ocorre:
  - com análise concluída;
  - com cor anterior definida;
  - com a cor nova diferente da anterior.
- **[F]** Só são removidos exercícios da partida, do lado antigo e com 0 tentativas. Como não têm tentativas, também não têm evidências de exercício, e não sobram órfãos. Os exercícios tentados ficam com tentativas, evidências e agendamento.
- **[F]** Exercícios criados manualmente também são removidos, conforme a decisão D3 registrada.
- **[E]** As mutações M7–M10 foram detectadas (desligado, apaga tentados, ignora a partida, remove sem análise concluída).
- **Trocas rápidas [F]:** a fila por partida mais a reconferência da cor em `deriveNow`/`markDerived` mantêm o estado final igual à última cor. Os testes P2-3 continuam passando.
- **Riscos residuais** (P3, já registrados na revisão da sprint):
  - uma derivação em andamento pode gravar um exercício do lado antigo entre a conferência da cor e `addExercise`;
  - **[E] A6-1:** `recordAttempt` recria um exercício removido (§8).

### G. Reconciliação de operações interrompidas: conforme

| Cenário | Comportamento verificado |
|---|---|
| Aba fechada durante a análise | `recoverInterruptedAnalyses` passa `running` para `paused`. A retomada é manual. A análise incompleta não deriva |
| Aba fechada durante a derivação | A marca `'pending'` foi gravada junto com a conclusão ou com a cor. `reconcileDerivations` refaz a derivação na abertura (Vitest + E2E com recarregar) |
| Troca de cor durante a derivação | A cor é reconferida antes de cada `addExercise`. `markDerived` devolve `'changed'` e a derivação faz nova passada (até 3) |
| Partida excluída durante o processamento | `deriveNow` remove as evidências e devolve `null`. Sem exercícios novos (teste L4) |
| Duas chamadas simultâneas, mesma aba | `serialized` aplica a ordem, e a marca é relida dentro da fila |
| Uma partida falha | `try/catch` por partida. Ela continua `'pending'` e as outras terminam |
| Duas abas | **[I]** A fila é por aba. `addExercise` e as transações evitam duplicatas, e o estado final converge pela marca. É uma limitação anterior, sem perda |
| Partida que sempre falha | **[F]** Fica `'pending'` para sempre, com erro só no console. Tentada a cada abertura, sem aviso na interface. P3 anterior, já no backlog |

## 7. Resultados reais dos testes [E]

Executados na worktree isolada em `9e1243d`, com `npm ci`:

| Verificação | Resultado |
|---|---|
| Arquivos do motor (`cmp` com `node_modules/stockfish/bin`) | Idênticos |
| `npm run typecheck` | ok |
| `npx vitest run` | **366/366** (23 arquivos) |
| `npm run test:engine` (isolado) | **21/21** |
| `npm run coverage` (`src/services`, `src/db`) | linhas **93,61** · statements **90,05** · branches **82,71** · funções **86,59** |
| `npm run build` | ok |
| `npm run test:e2e` (porta 4176) | **51** da suíte, todos passando. A primeira execução mostrou 52 porque incluiu a sonda temporária, removida em seguida |

Os números coincidem com a CI pós-merge e com o relatório da sprint. Nenhuma falha ambiental.

**Mutações no código integrado** (cópia isolada, cada uma restaurada antes da próxima):

| Mutação | Resultado |
|---|---|
| M1 evidência datada pela análise | Detectada (4 testes) |
| M2 `redateGameEvidence` sem gravar | Detectada (2) |
| M3 sem data → data da análise | Detectada (1) |
| M4 dica 3 conta como acerto | Detectada (1) |
| M5 mensagem diz "não salva" | Detectada (2) |
| M6 sem revalidação O1 | Detectada (1) |
| M7 D3 desligado | Detectada (2) |
| M8 D3 apaga exercícios tentados | Detectada (1) |
| M9 D3 sem filtrar a partida | Detectada (1) |
| M10 D3 remove sem análise concluída | Detectada (1) |

As mutações de E2E (contador e redatação na abertura) foram detectadas antes do merge. O código correspondente é idêntico no merge.

## 8. Achados

Não há P0 nem P1.

### A2-1 — Recarregar depois da dica 3 transforma a solução mostrada em acerto independente (P2)

- **Arquivo:** `src/features/training/useExerciseSession.ts` (`hints` em `useState`; `finish` usa `attemptResult(correct, revealed, hints)`) e `hint()`, que não grava nada.
- **Reprodução [E]:**
  1. Abrir um exercício e pedir as 3 dicas. A dica 3 mostra "O lance é Ra7". Nada é gravado.
  2. Recarregar a página.
  3. Jogar a solução.
  4. Resultado gravado: `{correct: true, revealed: false, hintsUsed: 0}` e eventos `{independent: true, outcome: 1}`.
- **Impacto:** anula o E2 para quem recarrega ou sai da tela, de propósito ou por acidente (a sessão guiada retomada também). O exercício sobe de caixa e o perfil recebe crédito integral por uma resposta fornecida. Antes da 4.4 a mesma brecha existia, com crédito 0,25, para as dicas 1–3. A sprint passou a exigir uma garantia que o recarregamento contorna.
- **Recomendação:** ao mostrar a dica 3, gravar a tentativa revelada na hora, como já faz "Ver solução" (`reveal` chama `finish(false, true)`). As tentativas seguintes ficam na janela de prática e não são gravadas. Teste E2E: dica 3 → recarregar → resolver → uma única tentativa, revelada.
- **Prazo:** corrigir **antes da Sprint 4.5** (é pequeno e é integridade de evidência).

### A5-1 — Com profundidade de análise acima de 16, a revalidação do O1 descarta erros legítimos (P2)

- **Arquivo:** `src/services/analysis/analysisRunner.ts:98` (`treeOptions`: `depth: Math.min(settings.analysisDepth, 16)`) e `:140` (`if (acceptsPlayedMove(complete, r.uci)) continue;`). A mesma regra vale em `ExplanationPanel.tsx`.
- **Reprodução [E]** (motor roteirizado, sonda temporária):
  1. `analysisDepth: 20`. A análise na profundidade 20 classifica 3.Nd4 como `blunder`.
  2. Na profundidade 16, o lance parece igual.
  3. Resultado: `changeUserColor` devolve `exercisesAdded: 0`. O erro encontrado pela busca mais funda é descartado por uma busca mais rasa.
- **Impacto:** limitado a quem configura a análise completa acima de 16 (o padrão é 16; a tela aceita até 30). Essa pessoa perde exercícios de erros reais sem aviso. O O1 assume "árvore mais profunda que a análise", o que só vale para a análise rápida ou com profundidade ≤ 16.
- **Recomendação:** aplicar o descarte só quando a árvore for mais profunda que a análise da posição (`tree.depth > before.depth`). Alternativa: montar a árvore com pelo menos a profundidade da análise. Teste com motor roteirizado, como na sonda.
- **Prazo:** corrigir **antes da Sprint 4.5** ou no início dela (pequeno e localizado).

### A2-2 — Repetir depois de resolver com a dica 3 não conta como ajuda (P3)

- **Arquivo:** `useExerciseSession.ts`, `retry`: `setRetries((r) => (status === 'failed' || status === 'revealed' ? r + 1 : 0))`. Uma solução com a dica 3 termina com `status: 'solved'`.
- **Cenário:** resolver com a dica 3 (gravado como revelada), esperar mais de 10 minutos na mesma tela e clicar em "Resolver de novo". A nova tentativa conta como independente. Depois de "Ver solução", a mesma sequência conta como uma dica.
- **Impacto:** baixo (exige esperar a janela de prática na mesma tela), mas é uma inconsistência entre `hints`, `retries` e o resultado gravado.
- **Recomendação:** tratar "resolvido com o lance mostrado" como `revealed` para o retry. Pode ir junto com o A2-1.

### A4-1 — O gráfico de evolução da competência desloca o dia em fusos negativos (P3)

- **Arquivo:** `gameDate.ts` (`Date.UTC(y, m, d)`, meia-noite UTC) contra `ProgressCharts.tsx` (`SkillHistoryChart` agrupa por `dayKey`, que usa a hora **local**).
- **Evidência [E]:** com `TZ=America/Sao_Paulo`, `Date.UTC(2025, 0, 10)` vira `2025-1-9` em hora local.
- **Impacto:** no Brasil (UTC−3), uma partida de 10/01 aparece como 09/01 no gráfico. É só exibição: o decaimento usa diferença de tempo, e o erro é de 3 horas.
- **Recomendação:** criar a data da partida ao meio-dia UTC, ou exibir datas de partida em UTC. Sprint futura.

### A5-2 — O caso real do O1 não está na suíte automatizada (P3)

- A proteção só é testada com motor roteirizado. A confirmação com o Stockfish real (Ópera, 15.Bxd7+) existe só nas sondas.
- **Recomendação:** acrescentar o caso da Ópera a `engine-integration.test.ts`, que roda na CI. Custo estimado de cerca de 1–2 minutos de CI. Por causa do estado de hash do motor, conferir isolado e dentro da suíte.

### A6-1 — `recordAttempt` recria um exercício removido em outra aba (P3)

- **Arquivo:** `src/db/trainingRepo.ts`, `recordAttempt`: `db.exercises.put(updated)` sem conferir se a linha ainda existe.
- **Reprodução [E]:** exercício gravado, removido (como faz o D3 em outra aba) e depois uma tentativa registrada. Resultado: `exercises = 1, attempts = 1`.
- **Impacto:** raro (duas abas, troca de lado enquanto o exercício está aberto) e não destrutivo. O exercício volta com histórico.
- **Recomendação:** dentro da transação, sair sem gravar se o exercício não existir mais, e avisar. Sprint futura.

### A7-1 — Consultas novas varrem tabelas com índice disponível (P3, desempenho)

- `redateGameEvidence` usa `skillEvents.filter(source === 'game')`, e `removeUnattemptedExercises` usa `exercises.filter(gameId…)`. Existem índices `skillEvents.source` e `exercises.gameId`.
- **Impacto:** desprezível nos volumes locais atuais. `redate` roda a cada abertura, com custo O(eventos).
- **Recomendação:** trocar por `where('source').equals('game')` e `where('gameId').equals(id)` quando o arquivo for tocado de novo.

## 8.1 Correções feitas depois desta auditoria

O usuário pediu a correção dos dois P2. Elas foram feitas na branch `fix/sprint4-4-audit-p2`, a partir de `9e1243d`:

| Achado | Correção | Testes |
|---|---|---|
| **A2-1** (P2) | `useExerciseSession.hint()` grava a tentativa revelada quando a dica 3 aparece. O fim dessa execução (resolver, errar ou ver a solução) não grava outra tentativa | E2E novo: dica 3 → recarregar → resolver dá uma única tentativa revelada, sem evento independente, na caixa 0. O E2E existente confere a gravação imediata |
| **A2-2** (P3, no mesmo ponto do código) | "Resolver de novo" depois de uma execução revelada conta como ajuda | E2E novo com relógio simulado: a segunda tentativa, após 11 min, fica `correct: true, hintsUsed: 1` |
| **A5-1** (P2) | `acceptsPlayedMove(ex, uci, analysedDepth)` só descarta quando `tree.depth > analysedDepth`. Vale na geração e na criação manual | Integração com motor roteirizado (análise 20, árvore 16: o exercício é mantido) e 3 testes unitários. O teste O1 existente (análise 11, árvore 16: descarta) continua passando |

**Mutações:** quatro, todas detectadas por falha de asserção:

- gate de profundidade removido;
- dica 3 sem gravar;
- retry antigo;
- regravação no fim da execução.

**Resultados:** typecheck ok, Vitest **370**, motor real 21, Playwright **53**. Cobertura: linhas 93,62, statements 90,06, branches 82,73, funções 86,59.

## 9. Dívidas técnicas

| Dívida | Origem | Situação |
|---|---|---|
| A2-1, A5-1 | Sprint 4.4 | **Novas**, recomendadas antes da 4.5 |
| A2-2, A4-1, A5-2, A6-1, A7-1 | Sprint 4.4 | **Novas**, baixas |
| Derivação em andamento pode gravar um exercício do lado antigo depois da limpeza | Anterior, mais visível com o D3 | Registrada no relatório 4.4 §6 |
| Partida com derivação sempre falhando fica `'pending'` sem aviso na interface | 4.3 (P3) | Backlog |
| Reconciliação só ao abrir o app | 4.3 | Backlog |
| P3-2 (falha de carregamento de tela), P3-3 (limite de passadas) | 4.3 | Backlog |
| Débitos 2, 3, 4 e 7 da baseline | Baseline | Backlog, sem mudança |
| Contador não atualiza por passagem do tempo | Anterior | Não registrado antes; baixo impacto |

## 10. Comparação com a baseline

| Item | Baseline (`d49f797`) | Sprint 4.3 (`e63c59b`) | Sprint 4.4 (`9e1243d`) |
|---|---|---|---|
| Esquema | v2 (implícito) | v2, histórico explícito `[1, 2]` | v2, `[1, 2]`, **sem mudança** |
| Vitest | 322 | 348 | **366** |
| Motor real | 21 | 21 | 21 |
| Playwright | 47 | 49 | **51** |
| Cobertura (linhas · branches) | 90,97 · 80,15 | 93,26 · 82,03 | **93,61 · 82,71** |
| Dependências | — | sem mudança | **sem mudança** (`package.json` e lockfile intocados) |
| Rede, backend, telemetria | nenhuma | nenhuma | **nenhuma** (sem `fetch`, XHR, WebSocket ou URLs novas) |
| Motor (`public/engine`, `src/services/engine`) | — | sem mudança | **sem mudança**; arquivos idênticos aos do pacote |

**Mudanças arquiteturais da 4.4**, todas previstas no planejamento:

- módulo `services/games/gameDate.ts`;
- `redateGameEvidence` na inicialização;
- remoção D3 dentro da transação da cor;
- `acceptsPlayedMove` na geração e na criação manual.

Não houve mudança arquitetural fora do previsto. Os dados existentes são preservados: as únicas reescritas são o `at` de eventos de partida e a remoção D3, ambas aprovadas.

## 11. Veredito final

**APROVADA COM RESSALVAS.**

- **Por que aprovada:**
  - integração correta;
  - CI e reprodução local verdes no SHA integrado;
  - esquema, dependências, rede e motor preservados;
  - todas as proteções críticas com testes sensíveis (10/10 mutações detectadas);
  - caso de referência do O1 confirmado com o motor real.
  - Não há achado P0 ou P1.
- **Ressalvas:**
  - dois P2 reproduzidos (A2-1 e A5-1), que reduzem a eficácia de E2 e de O1 em cenários delimitados;
  - cinco P3.
  - Nenhuma ressalva corrompe ou perde dados.

### Recomendações para a próxima etapa (sem planejar a Sprint 4.5)

- **Corrigir antes da Sprint 4.5** (pequenos e isolados):
  - **A2-1:** gravar a tentativa revelada ao mostrar a dica 3;
  - **A5-1:** só descartar quando a árvore for mais profunda que a análise.
- **Podem entrar na 4.5 sem ampliar o escopo:**
  - A2-2, junto com o A2-1;
  - A5-2: o caso real da Ópera na suíte do motor;
  - A6-1: `recordAttempt` sem recriar exercícios.
- **Backlog:**
  - A4-1 (fuso no gráfico);
  - A7-1 (índices);
  - aviso na interface para partida com derivação sempre falhando;
  - itens anteriores.
- **Decisão de produto a considerar (D-4):** se partidas antigas importadas devem levar competências a "Precisa revisar" para um usuário novo, ou se esse estado deve exigir evidência recente de exercício.
