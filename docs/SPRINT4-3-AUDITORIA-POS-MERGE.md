# Sprint 4.3 — Auditoria pós-merge

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Objeto pedido | `main` depois da integração do PR #5 |
| Objeto auditado | `main` em `e63c59b36ea5822c0647e49fa4b7f2216ffd8d2f` (merge do PR #5) |
| Veredito | **APROVADA COM RESSALVAS** (§10) |

> **Histórico deste relatório.** Na primeira rodada, o PR #5 ainda estava aberto e o veredito foi **INCONCLUSIVA**. O usuário autorizou o merge, feito com merge commit às 15:01 UTC. As seções abaixo registram os dois momentos.

Legenda: **[F]** fato verificado no repositório ou no GitHub · **[E]** resultado de execução ou log · **[I]** inferência.

## 1. Resumo executivo

- **[F] Primeira rodada:** a premissa não se confirmou. O PR #5 estava aberto e a `main` continuava em `4445f72`. O veredito foi **INCONCLUSIVA**.
- **[F] Depois da autorização:**
  - o PR #5 foi integrado com **merge commit** `e63c59b` (pais: `4445f72` e `7870a0a`);
  - a árvore do merge é **idêntica** à de `7870a0a`, sem resolução de conflito;
  - a branch de origem foi mantida.
- **[E]** A CI do push na `main` (run `42384359803`, SHA `e63c59b`) passou:
  - typecheck;
  - Vitest 348/348, com os 21 testes do Stockfish real;
  - build;
  - Playwright 49/49.
- **[F]** As correções da Sprint 4.3 (P2-1, P2-2, P2-3 e os achados da revisão) estão na `main`.
- **Regressões:** nenhuma.
- **Ressalvas:**
  - os P3-1 e P3-4;
  - o cabeçalho desatualizado do `SPRINT4-3-RELATORIO.md`, que ainda diz "ainda não commitadas";
  - a `main` local e a baseline ainda não foram atualizadas.

## 2. Identificação dos commits

| Item | SHA | Origem |
|---|---|---|
| `main` antes do merge | `4445f7215498547ee2ee5f9b9a8195faf26b8156` | merge do PR #4 (baseline) |
| Commit original da Sprint 4.3 | `1031e60b246b6d3d274ad11c15f7897844012c9a` | PR #5 |
| Correções da auditoria (HEAD final do PR) | `7870a0a61b8f5c6f178fd0006824e069eaf744df` | PR #5 |
| **Merge commit do PR #5 = `origin/main`** | `e63c59b36ea5822c0647e49fa4b7f2216ffd8d2f` | integrado em 2026-11-07 15:01:42 UTC |

## 3. Estado da integração

### Depois do merge autorizado [F]

| Pergunta | Resposta |
|---|---|
| PR #5 está merged? | **Sim**. `state: MERGED`, `mergedAt: 2026-11-07T15:01:42Z` |
| Estratégia | **Merge commit** (`gh pr merge --merge --match-head-commit 7870a0a…`). Sem squash nem rebase |
| SHA do merge commit | `e63c59b36ea5822c0647e49fa4b7f2216ffd8d2f` |
| HEAD final do PR | `7870a0a61b8f5c6f178fd0006824e069eaf744df` |
| `7870a0a` está na `main`? | **Sim** |
| Árvore do merge vs `7870a0a` | Idêntica (`git diff 7870a0a e63c59b` vazio) |
| `main` remota | `e63c59b` |
| Branch de origem | Mantida (`refs/heads/feat/sprint4-3-reliable-training-loop` = `7870a0a`) |
| PRs abertos | Nenhum |
| Ambiente local | Continua na branch da 4.3 (`7870a0a`). A `main` local **não** foi atualizada, conforme as restrições, e está atrás de `origin/main` |

### Primeira rodada, antes da autorização [F]

| Pergunta | Resposta |
|---|---|
| PR #5 está merged? | **Não**. `state: OPEN`, `mergedAt: null`, `mergeCommit: null` |
| Estratégia de merge | Não se aplica (pela regra do projeto, deve ser merge commit) |
| SHA do merge commit | Não existe |
| HEAD final do PR | `7870a0a…` (commits do PR: `1031e60`, `7870a0a`) |
| `7870a0a` está na `main`? | **Não** (`git merge-base --is-ancestor` falhou) |
| `main` remota atualizada? | Está em `4445f72`, sem commits novos desde a baseline do PR #4 |
| Situação para merge | `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, sem revisões registradas |
| PRs abertos | Só o #5 |

### Ambiente local [F]

| Item | Valor |
|---|---|
| Branch atual | `feat/sprint4-3-reliable-training-loop` |
| HEAD local | `7870a0a…`, igual ao remoto da branch (0 à frente, 0 atrás) |
| `main` local | Não foi trocada nem atualizada, conforme as restrições |
| Working tree | Limpa, exceto `?? .claude/` |
| `.claude/` | Preservada e não rastreada |

Nenhuma ação de sincronização foi feita.

## 4. CI

| Execução | SHA | Evento | Resultado |
|---|---|---|---|
| `42376996427` | `7870a0a` | `pull_request` | **sucesso** (check `verify`, 2m13s) |
| `42344071395` | `1031e60` | `pull_request` | sucesso (substituída pela anterior) |
| `42342167980` | `4445f72` | `push` na `main` | sucesso (CI pós-merge do PR #4) |
| **`42384359803`** | **`e63c59b`** | **`push` na `main`** | **sucesso: CI pós-merge do PR #5** |

Detalhe da execução pós-merge `42384359803` (log) **[E]**:

- Vitest: 22 arquivos, **348/348**, com `engine-integration.test.ts` (**21 testes com Stockfish real**).
- Build ok.
- Playwright: **49 passed**.

O SHA testado é o do merge commit atual da `main`.

Detalhe da execução `42376996427` (log) **[E]**:

- Arquivos do motor conferidos (`test -s` dos `.js` e `.wasm`).
- typecheck ok.
- Vitest: **22 arquivos, 348/348**, incluindo `engine-integration.test.ts` com **21 testes com Stockfish real** (motor WASM, sequências e corpus de explicações).
- Build ok.
- Playwright: **49 passed**.

**[I]** Num `pull_request`, o GitHub testa o merge do PR com a base (`refs/pull/5/merge`), ou seja, `7870a0a` sobre `4445f72`. Como a `main` não mudou desde então, o resultado do merge deve ter a mesma árvore. **Isso não substitui a CI do push na `main`**, que precisa ser conferida depois da integração.

## 5. Validação das correções (no HEAD do PR)

Conferido no código de `7870a0a` **[F]**. Os testes citados passaram na CI acima **[E]**.

### Persistência e recuperação

| Requisito | Evidência | Situação |
|---|---|---|
| Retomada da derivação depois de fechar a aba | `GameAnalysis.derivation`. `saveColorMarkingPending` e `startAnalysis` gravam `'pending'` na mesma transação da cor ou da análise. `reconcileDerivations` roda em `App.tsx` depois de `recoverInterruptedAnalyses` | ✔ |
| Exercícios e perfil consistentes com a cor | `markDerived` só marca `'done'` se a cor usada continuar salva, conferindo na mesma transação. A derivação refaz até 3 passadas se a cor mudar | ✔ |
| Sem mudança desnecessária de schema | O campo `derivation` não é indexado. `SCHEMA_VERSIONS` continua `[1, 2]` | ✔ |

### Integridade das evidências

| Requisito | Evidência | Situação |
|---|---|---|
| Remoção limitada à partida | `replaceGameSkillEvents(gameId, [])`, teste P2-2 (eventos de exercício, abertura e outra partida preservados) | ✔ |
| Deduplicação | `addExercise` confere `fenKey` na mesma transação. A escolha de posições exclui as de outras partidas. As da própria partida são puladas antes de chamar o motor | ✔ |
| Limite por partida | `selectExercisePositions(max)` escolhe sempre o mesmo conjunto. Há teste de derivação parcial "sem ultrapassar o limite" | ✔ |

### Confiabilidade dos testes

| Requisito | Evidência | Situação |
|---|---|---|
| Troca rápida de cor protegida | Teste P2-3 com motor retido num portão. A mutação "fila removida" falha | ✔ |
| Remoção isolada | Teste P2-2. A mutação "sem filtro `source: 'game'`" falha | ✔ |
| Testes falham sem a proteção | 7 mutações detectadas no Vitest e 1 no E2E (`SPRINT4-3-RELATORIO.md` §6.3) | ✔, executado antes do commit e não repetido nesta auditoria |

### Processamento

| Requisito | Evidência | Situação |
|---|---|---|
| Partida com problema não bloqueia as outras | `try/catch` por partida em `reconcileDerivations`, com teste | ✔ |
| Falha individual previsível | A partida fica `'pending'`, o erro vai para o console local e ela é tentada de novo na próxima abertura | ✔ (sem aviso na interface; ver §9) |
| Interface igual ao estado persistido | `derivationMessage` reflete o resultado devolvido. O E2E confere a marca `'done'` e os exercícios só do lado escolhido depois de recarregar | ✔, com o P3-1 e o P3-3 (§8) |

## 6. Estado da arquitetura

Mudanças da Sprint 4.3 em relação à `BASELINE-MAIN.md` (ainda fora da `main`):

- **Dexie:** o histórico de versões passou a ser explícito (`SCHEMA_VERSIONS`, `defineSchema`). O débito 5 da baseline foi eliminado.
- **Ciclo partida → exercício → perfil:**
  - a derivação pode ser repetida sem efeito colateral;
  - roda em fila por partida;
  - tem uma marca persistida (`derivation`);
  - é reconciliada ao abrir o app.
  - **[I]** É o maior acréscimo de complexidade da sprint (`analysisRunner.ts` passou para 257 linhas). Está justificado e coberto por testes.
- **Interface:** `RouteErrorBoundary` em volta das rotas. Estatísticas sem partidas sem cor.
- **E2E:** porta dedicada 4176, sem reaproveitar servidor existente.
- **Princípios:** sem rede nova, backend, login ou telemetria. O backup inclui `derivation` porque o campo faz parte da análise.

**Riscos de manutenção [I]:**

- `analysisRunner.ts` concentra fila, passadas, transações e reconciliação. Uma mudança futura no fluxo de derivação deve passar obrigatoriamente pelos testes de `user-color.test.ts`.
- A reconciliação só roda ao abrir o app. Uma marca `'pending'` restaurada de backup espera a próxima abertura.

## 7. Débitos resolvidos e pendentes

| Débito | Origem | Situação no HEAD do PR |
|---|---|---|
| 1. Contador "Revisões pendentes" limitado a 5 | Baseline | **Resolvido** |
| 2. Limites de classificação gravados na análise | Baseline | Pendente (backlog) |
| 3. Layout em 768 px | Baseline | Pendente (backlog) |
| 4. Mate pelo `measureAfter` recebe "Excelente" | Baseline | Pendente (backlog) |
| 5. Armadilha do versionamento Dexie | Baseline | **Resolvido** |
| 6. E2E reaproveitando servidor na 4173 | Baseline | **Resolvido** |
| 7. Sem ESLint | Baseline | Pendente (backlog) |
| Cor definida depois da análise não gerava nada (bug A) | Auditoria de entrada 4.3 | **Resolvido** |
| Estatísticas misturando os dois lados (bug B) | Auditoria de entrada 4.3 | **Resolvido** |
| Contador "Treinar" da barra lateral conta exercícios novos como "revisões pendentes" | Visto na 4.3 | **Pendente** (`AppShell.tsx:20,43`) |
| Exercícios do lado antigo ao trocar a cor | Decisão de produto | **Pendente da sua decisão** |
| **Novo:** cabeçalho do relatório 4.3 desatualizado ("ainda não commitadas") | Esta auditoria | Pendente (só documentação) |

## 8. P3 não tratados

| P3 | Descrição | Impacto real | Probabilidade | Custo | Dependências | Recomendação |
|---|---|---|---|---|---|---|
| **P3-1** | Se a derivação falha depois de a cor ser salva, o toast em `GamesPage.onColor` mostra o erro cru ou "Não foi possível salvar a cor", **mas a cor foi salva** | Informação falsa ao usuário. Ele tenta de novo e a cor já está gravada. Com a 4.3, a marca fica `'pending'` e a derivação é refeita na próxima abertura, o que a mensagem também não diz | Baixa (exige falha de IndexedDB ou do motor) | Pequeno (mensagem e um teste) | Nenhuma | **Sprint 4.4**, junto com o P3-4 |
| **P3-2** | Falha no carregamento sob demanda de uma tela mostra "Um dado desta tela não pôde ser lido", e "Tentar de novo" não resolve | O usuário fica sem saída, salvo recarregar. Só acontece depois de uma atualização do app com a aba antiga aberta, ou offline | Baixa num app local servido de arquivos estáticos | Pequeno a médio (detectar o erro de import e oferecer "Recarregar") | Nenhuma | **Backlog** (reavaliar quando houver distribuição com atualizações frequentes ou PWA) |
| **P3-3** | `MAX_DERIVE_PASSES = 3`: com trocas contínuas de cor, o valor devolvido pode não corresponder à cor final | Só o toast pode ficar impreciso. A marca fica `'pending'` e a reconciliação corrige o estado | Muito baixa (exige 3+ trocas durante uma derivação) | Pequeno | Nenhuma | **Backlog** |
| **P3-4** | Os toasts "Cor removida" e "serão gerados quando a análise terminar", e a nota da Evolução sobre partidas sem cor, não têm E2E | Uma regressão nesses textos passaria despercebida | Média em mudanças futuras da tela de partidas | Pequeno | Pode ir junto com o P3-1 | **Sprint 4.4**, opcional, junto com o P3-1 |

Registrados pela revisão e mantidos sem mudança:

- reconciliação só ao abrir o app;
- exercício sem árvore recebe `'done'`;
- exercícios dos dois lados acima do limite depois de idas e voltas de cor.

Os três seguem no backlog, e o último depende da decisão sobre o lado antigo.

## 9. Regressões ou riscos encontrados

- **Regressões:** nenhuma **[E]**. A CI está verde, e os números são iguais ou maiores que os da baseline (322 → 348 no Vitest, 47 → 49 no Playwright, 21 testes com o motor real).
- **Risco de processo [F]:** resolvido com o merge. A Sprint 4.4 deve partir de `origin/main` = `e63c59b`, depois de atualizar a `main` local, o que não foi feito nesta auditoria.
- **Risco de documentação [F]:** o cabeçalho do `SPRINT4-3-RELATORIO.md` (linha 5) está desatualizado. A memória do projeto e a baseline também ainda não refletem a 4.3.
- **Riscos de produto** encontrados na auditoria funcional: estão no `SPRINT4-4-PLANEJAMENTO.md` §2. O mais relevante é que as evidências de partida são datadas pelo dia da análise, e não pelo da partida.

## 10. Veredito da auditoria

**APROVADA COM RESSALVAS.**

- **Primeira rodada:** INCONCLUSIVA, porque o PR #5 não estava integrado.
- **Comprovado depois do merge autorizado:**
  - merge commit `e63c59b`, com árvore idêntica a `7870a0a`;
  - CI do push na `main` verde no SHA correto, inclusive Stockfish real e E2E;
  - correções presentes;
  - nenhuma regressão.
- **Ressalvas:**
  1. os P3-1 e P3-4 (propostos para a Sprint 4.4);
  2. o cabeçalho desatualizado do `SPRINT4-3-RELATORIO.md`;
  3. a baseline (`BASELINE-MAIN.md`) e a `main` local ainda não refletem `e63c59b`.

Nenhuma ressalva bloqueia a evolução.
