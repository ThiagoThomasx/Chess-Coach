# Sprint 4.5 — Auditoria de débitos e planejamento

- **Data:** 2026-11-07.
- **Situação:** aprovada pelo usuário (D-4 = B, D-5 = limpar) e implementada na branch `feat/sprint4-5-consistent-profile`. Ver `SPRINT4-5-RELATORIO.md`.

Legenda: **[R]** reproduzido por execução · **[I]** demonstrado por inspeção de código · **[H]** risco hipotético, não reproduzido.

## 1. Baseline auditado

| Item | Valor |
|---|---|
| Branch local | `main`, limpa (só `?? .claude/`, que não é versionada) |
| HEAD local = `origin/main` | `edf4de89c049bccbdf12c7b63bcc10aaec238e3c` |
| Merge commit do PR #7 | `edf4de8` (pais: `9e1243d` e `ff233c4`) |
| Merge do PR #6 | `9e1243d` |
| PRs abertos | Nenhum |
| CI do HEAD | run `42396932386`, sucesso: Vitest 370, motor real 21, build, Playwright 53 |

**Divergências de documentação** [I], registradas e não corrigidas:

- `docs/BASELINE-MAIN.md` ainda descreve `d49f797` (pós-Sprint 4.2), com 322 / 21 / 47 testes. Ele lista como abertos os débitos 1, 5 e 6, que foram resolvidos na Sprint 4.3.
- `docs/SPRINT4-4-RELATORIO.md`, linha 5, diz "PR aberto para revisão", mas o PR #6 já foi integrado.
- `docs/SPRINT4-4-AUDITORIA-POS-MERGE.md` §8.1 registra as correções A2-1, A2-2 e A5-1 como feitas numa branch. Elas foram integradas pelo PR #7.

## 2. Metodologia e arquivos inspecionados

- **Documentos:**
  - `SPRINT4-4-RELATORIO.md`, `SPRINT4-4-AUDITORIA-POS-MERGE.md`, `SPRINT4-4-PLANEJAMENTO.md`;
  - `SPRINT4-3-RELATORIO.md`, `SPRINT4-3-AUDITORIA-POS-MERGE.md`;
  - `BASELINE-MAIN.md`, `METHODOLOGY.md`, `ARCHITECTURE.md`.
- **Código:**
  - `src/db/`: `database.ts`, `trainingRepo.ts`, `analysisRepo.ts`, `gamesRepo.ts`;
  - `src/services/`: `analysis/analysisRunner.ts`, `games/gameDate.ts`, `stats/stats.ts`, `adaptation/skills.ts`, `training/session.ts`;
  - `src/features/`: `progress/ProgressCharts.tsx`, `progress/ProgressPage.tsx`, `progress/SkillProfile.tsx`, `training/TrainingPage.tsx`, `training/ExerciseSolver.tsx`, `games/GamesPage.tsx`;
  - `src/components/layout/AppShell.tsx`, `playwright.config.ts`, `package.json`.
- **Execução:** numa worktree descartável em `edf4de8`, com `npm ci`, removida no fim. O checkout de trabalho e os dados reais do IndexedDB (`localhost:5173`) não foram tocados.
- **Sondas temporárias**, todas descartadas:
  - Vitest com `fake-indexeddb` e com o Stockfish real (processo filho);
  - Playwright com relógio simulado (`page.clock`), na porta isolada 4176;
  - Node com `Intl.DateTimeFormat` em 7 fusos.
- Os testes existentes não foram tratados como prova de ausência de defeitos. Cada item foi conferido no código e, quando possível, reproduzido.

## 3. Débitos conhecidos, revalidados

### P3-1 — Fuso horário no gráfico de evolução [R]

**Armazenamento.** `gameTime` (`src/services/games/gameDate.ts:21`) grava a data do PGN como `Date.UTC(y, m-1, d)`, ou seja, meia-noite UTC. Esse valor vira o `at` das evidências de partida (`gameEvidenceTime`, `:35`).

**Exibição.** `SkillHistoryChart` (`src/features/progress/ProgressCharts.tsx:61-63`) agrupa por `dayKey` (`src/services/stats/stats.ts:45`), que usa a hora **local**.

**Reprodução em 7 fusos** (partida de 10/01/2025):

| Fuso | Meia-noite UTC (atual) | Meio-dia UTC (alternativa) |
|---|---|---|
| America/Sao_Paulo, America/Los_Angeles | **09/01** ✗ | 10/01 |
| UTC, Europe/Lisbon, Asia/Tokyo | 10/01 | 10/01 |
| Pacific/Auckland, Pacific/Kiritimati | 10/01 | **11/01** ✗ |

**Onde corrigir.** Nenhum instante único representa uma data sem hora em todos os fusos. Gravar meio-dia UTC só desloca o problema para UTC+12 a +14. Gravar meia-noite local faria o dado depender do aparelho, e `redateGameEvidence` reescreveria os dados em outro fuso.

**Recomendação.** Corrigir na **apresentação**: no gráfico, evidências `source: 'game'` são agrupadas pelo dia **UTC**, porque representam uma data de calendário; as demais continuam no dia local. Isso não exige mudança de dado nem de esquema.

**Impactos verificados [I]:**

- Ordenação e recência (`toAnalyzedInputs`, `RECENT_GAMES`) comparam números, então não mudam.
- O decaimento usa diferença de tempo e não muda.
- `session.ts:108` (plano do dia) usa `dayKey(now)` e não é afetado.

### P3-2 — Partida da Ópera sem teste com o motor real [R]

- **Fixture:** a partida está em `tests/fixtures.ts:4` (`OPERA_GAME`).
- **Reprodução determinística.** Em dois processos novos do Stockfish real (hash vazio), a análise na profundidade 11 deu resultado **idêntico** nas duas execuções.
  - Meia-jogada 29, 15.Bxd7+: classificado como `blunder`, `winLoss` 22,9.
  - Avaliação antes: +812, com melhor lance Bxf6. Avaliação depois: +261, com a melhor defesa vista como 15…Nxd7 16.Qb7.
  - Na profundidade 16, a busca da posição anterior coloca **15.Bxd7+ em primeiro (+1167)**, à frente de Bxf6 (+752) e Qxe6 (+589).
- **Fragilidade.** A classificação na profundidade 11 depende do motor e do estado de hash. Um teste que só exigisse "é blunder na 11" quebraria com outra versão do motor, ou dentro da suíte depois de outras buscas (efeito conhecido, registrado na memória do projeto).
- **Teste proposto,** que valida o comportamento e não só a presença do fixture:
  1. **Pré-condição congelada:** usar como fixture a análise da profundidade 11 das meias-jogadas 28 e 29, isto é, as linhas observadas acima. A classificação `blunder` fica determinística e independe do motor.
  2. **Parte real:** com o Stockfish real, montar a árvore (`withSolutionTree`, profundidade 16, MultiPV 3) e afirmar que `acceptsPlayedMove(ex, 'b5d7', 11)` é verdadeiro. A asserção é robusta: Bxd7+ é o **melhor** lance na 16, com margem de cerca de 400 cp.
  3. **Resultado integrado:** `deriveFromAnalysis` com essa análise e o motor real não cria exercício na meia-jogada 29.
  4. Rodar o teste com um processo de motor novo, ou com `ucinewgame`, e conferir isolado e dentro da suíte.
  5. Opcional, como sentinela: um teste com o motor na profundidade 11 que só registra se a classificação mudar. Sem falhar a suíte, ele avisa quando o fixture congelado ficou obsoleto.

### P3-3 — Exercício removido recriado por uma tentativa [R]

- **Fluxo:** `recordAttempt` (`src/db/trainingRepo.ts:63-72`) roda numa transação `rw` sobre `attempts`, `exercises` e `skillEvents`. Ela lê a tentativa anterior e faz `exercises.put(updated)` com o objeto que o solver tem em memória, **sem conferir se a linha ainda existe**.
- **Reprodução:**
  1. Partida com a cor brancas e um exercício gerado.
  2. Troca para pretas: o D3 remove o exercício nunca tentado, e a contagem fica 0.
  3. Tentativa registrada com o objeto antigo (outra aba, ou a mesma tela aberta).
  4. Resultado: `{resurrected: true, side: 'w', userColor: 'b', attempts: 1, exEvents: 1}`.
- **Impacto.** O exercício do lado antigo volta, agora "tentado", e por isso **o D3 nunca mais o remove**. Fica um exercício que contradiz a cor salva. Não há perda: a tentativa é legítima, porque o usuário de fato resolveu.
- **Concorrência.** As transações do IndexedDB serializam escritas no mesmo objeto. O problema não é atomicidade, e sim falta de uma verificação de existência dentro da transação.
- **Solução recomendada** (baixa complexidade): dentro da transação, `const current = await db.exercises.get(ex.id)`.
  - Se não existir: não gravar nada, devolver `{ removed: true }` e a interface avisar que o exercício foi removido (troca de lado ou exclusão).
  - Se existir: usar `current.srs` para o reagendamento, e não o objeto em memória. Isso também evita sobrescrever um agendamento mais novo feito em outra aba.

### P3-4 — Consultas sem índice [R, medição indicativa]

**Índices existentes** (`src/db/database.ts:44-56`):

| Tabela | Índices |
|---|---|
| `exercises` | `id, gameId, theme, skill, difficulty, srs.dueAt, createdAt, source` |
| `skillEvents` | `++id, skill, at, source, ref.gameId, ref.exerciseId` |

**Consultas que fazem varredura:**

| Consulta | Frequência | Índice disponível? |
|---|---|---|
| `analysisRepo.ts:63`: `skillEvents.filter(source === 'game')` | **Toda abertura** do app (`redateGameEvidence`) | Sim (`source`) |
| `analysisRunner.ts:239`: `exercises.filter(gameId && side)` | Cada troca de lado | Sim (`gameId`) |
| `trainingRepo.ts:26`: `exercises.filter(fenKey(e.fen) === key)` | Cada exercício criado | **Não**: `fenKey` é calculado e não há índice |

**Medição** com `fake-indexeddb` (20 mil eventos e 3 mil exercícios). É indicativa, porque não representa o IndexedDB do navegador:

| Consulta | Varredura | Com índice |
|---|---|---|
| `skillEvents`, `source = game` (5 mil linhas) | 227 ms | 32 ms |
| `exercises`, `gameId` (6 linhas) | 45 ms | 0,5 ms |
| Deduplicação do `addExercise` | 38 ms | — |

**Recomendação:**

- Trocar as duas primeiras por `where('source').equals('game')` e `where('gameId').equals(id)`. É só mudança de consulta, sem esquema.
- **Não** criar índice para a deduplicação. Exigiria campo novo e migração, e o custo atual só aparece com milhares de exercícios.
- `AppShell.tsx:25` já usa o índice `srs.dueAt`.

## 4. Débitos complementares

### C1 — Derivação em andamento grava um exercício do lado antigo depois da limpeza [R, com escalonamento injetado]

- **Fluxo.** Em `deriveFromAnalysis` (`analysisRunner.ts:136-141`): árvore → `getGame` (reconfere a cor) → `acceptsPlayedMove` → `addExercise`. A troca de cor (`saveColorMarkingPending`) **não passa pela fila** e pode confirmar entre a reconferência e a gravação.
- **Reprodução.** A segunda leitura de `games.get` foi interceptada, e a troca para pretas confirmou antes de ela devolver a resposta antiga.
  - Resultado: cor `b`, um exercício de brancas nunca tentado, e `derivation: 'done'`.
  - A passada seguinte (cor `b`) **não remove** o exercício de brancas, e a marca fica `'done'`. A reconciliação não corrige nada.
- **Proteção existente:** a reconferência da cor reduz a janela a algumas microtarefas. Sem injeção, a probabilidade é muito baixa.
- **Recomendação:** fazer a reconferência e a gravação **na mesma transação** sobre `games` e `exercises`. Por exemplo, `addExercise(ex, { expectColor })`, que sai sem gravar se a cor mudou. O esforço é baixo e fecha a janela por completo.

### C2 — Derivação que sempre falha fica `'pending'` sem aviso [R]

- **Reprodução.** Com uma análise concluída e corrompida (`reviews` ausentes), duas reconciliações seguidas dão `reconciled: 0` e 2 erros **só no console**. Depois disso: `status: 'complete'`, `derivation: 'pending'`, 0 exercícios.
- **O que o usuário vê:** a partida aparece como analisada, sem exercícios nem evidências, e nada indica o motivo.
- **Proteção existente:** o erro não bloqueia as outras partidas, e a tentativa se repete a cada abertura.
- **Probabilidade:** baixa. Falhas do motor já são absorvidas (`completeExercise`). Sobram só dados corrompidos ou erro de armazenamento.
- **Recomendação:** monitorar. Se entrar, mostrar um selo "Exercícios pendentes" na linha da partida, com "Tentar de novo", que chama a derivação da partida. Não precisa de campo novo: o estado já está em `derivation`.

### C3 — O contador de "Treinar" não acompanha a passagem do tempo [R]

- **Fluxo.** `AppShell.tsx:23-26` usa `useLiveQuery` com `Date.now()` lido no momento da consulta. A consulta só refaz quando há escrita no banco.
- **Reprodução** (Playwright com relógio simulado): exercício já tentado, vencendo em 2 minutos.

| Momento | Barra lateral | Dashboard |
|---|---|---|
| t0 | 0 | 0 |
| +3 min, navegando sem recarregar | **0** | **1** |
| Depois de recarregar | 1 | 1 |

- **Impacto:** os dois números se contradizem na mesma tela. É baixo, mas é exatamente a coerência que a E3 pretendia.
- **Recomendação:** corrigir, com esforço trivial. Por exemplo, um "minuto atual" nas dependências da consulta, atualizado por um intervalo de 60 s.

## 5. Débitos estruturais do baseline

| Débito | Situação na `main` | Classificação | Recomendação |
|---|---|---|---|
| Versionamento do esquema Dexie | **Resolvido na 4.3**: `SCHEMA_VERSIONS` explícito e acrescentado ao fim (`database.ts:42-72`), com testes de upgrade v1→v2→v3 | Era risco funcional latente; hoje não há risco | Nada a fazer. Atualizar `BASELINE-MAIN.md` |
| Playwright reutilizando servidor na 4173 | **Resolvido na 4.3**: porta 4176 e `reuseExistingServer: false` (`playwright.config.ts:9,24`) | Era risco de desenvolvimento | Nada a fazer |
| Ausência de ESLint | **Continua**: nenhuma ocorrência de `eslint` no `package.json` | Manutenção e qualidade. `react-hooks/exhaustive-deps` pegaria dependências erradas de hooks, uma classe de defeito relevante neste projeto (A2-1 era de estado em hook) | **Fora da 4.5**, salvo decisão sua: é dependência nova de desenvolvimento e gera ruído inicial |

## 6. Decisão de produto: partidas antigas importadas (D-4)

### O que acontece hoje [R]

Desde a E1, o perfil aplica decaimento pela **data da partida**, com meia-vida de 120 dias. Na prática, isso já é a alternativa C. Simulação com `estimateSkill`: 20 partidas, 3 evidências cada, cerca de 40% de sucesso.

| Cenário | Estado mostrado | Peso efetivo |
|---|---|---|
| 20 partidas de **1 ano atrás**, nada recente | **Precisa revisar** | 2,07 |
| 20 partidas de **3 meses atrás** | **Precisa revisar** | 10,1 |
| 20 partidas das **últimas 3 semanas** | Em desenvolvimento | 17,0 |
| 20 partidas de 1 ano + 5 exercícios hoje (80%) | Evidências iniciais, **tendência "subindo"** | 5,2 |

Dois efeitos contrariam o princípio "não confundir falta de dados recentes com falta de habilidade":

1. **A regra de antiguidade** (`skills.ts:217-219`, última evidência há mais de 30 dias com peso bruto ≥ 6) marca **"Precisa revisar"** para quem acabou de importar partidas antigas. Isso acontece antes de qualquer outra regra, e a mensagem sugere uma deficiência que os dados não mostram.
2. **A tendência** (`skills.ts:202-207`) compara os últimos 8 eventos com os 8 anteriores, sem separar a origem. Quando exercícios recentes, de taxa naturalmente diferente, chegam depois de lances de partidas antigas, aparece **"subindo"** sem nenhuma evolução real (achado N2, §7).

### Diagnóstico histórico versus evolução recente

- **Diagnóstico histórico:** o que as partidas, inclusive as antigas, revelam sobre as competências. Serve de ponto de partida para um usuário novo.
- **Evolução recente:** o que o jogador demonstra **agora** (exercícios e partidas recentes). É o que deve mover tendência, "precisa revisar" e dificuldade-alvo.

### Alternativas

| Critério | A. Peso igual | B. Histórico separado do recente | C. Peso decrescente em tudo (atual) |
|---|---|---|---|
| Fidelidade pedagógica | Baixa: um erro de 2 anos pesa como o de ontem | **Alta**: cada visão responde a uma pergunta | Média: correta para a evolução, mas apaga o diagnóstico inicial |
| Risco de distorcer o perfil | Alto: um histórico grande abafa o progresso recente | Baixo, se a interface rotular as duas visões | Médio: falsos "Precisa revisar" e tendência artificial |
| Utilidade para o iniciante | Alta no começo, ruim depois | **Alta**: o diagnóstico existe no primeiro dia, e a evolução começa a contar com prática real | Baixa: só vê "Precisa revisar" ou "Evidências insuficientes" |
| Coerência com recência e evidências | Contraria a E1 e a meia-vida | Mantém a E1 na evolução e acrescenta uma leitura sem decaimento | Coerente, mas com os dois efeitos acima |
| Complexidade | Baixa: tirar o decaimento das partidas | **Média**: segunda estimativa (sem decaimento ou com meia-vida longa), regra "sem evidência recente", tendência por origem, rótulos na Evolução | Baixa para manter. Corrigir os efeitos é baixo a médio |
| Mudança no banco | Não | **Não**: tudo é calculado de `skillEvents`, que já tem `source` e `at` | Não |

### Recomendação (a decisão é sua)

**B.**

- **Diagnóstico histórico:** todas as evidências, sem decaimento, mostradas com o período coberto ("com base em 20 partidas de jan–mar/2025").
- **Evolução recente:** o estimador atual, com decaimento, mais duas mudanças:
  - **"Sem evidência recente"** passa a ser um estado próprio, separado de "Precisa revisar", que fica reservado para queda recente ou taxa claramente abaixo de 50%;
  - a **tendência** compara evidências da mesma origem (exercícios com exercícios, partidas com partidas).

**Variante mínima, se preferir menos escopo (C'):** manter C e corrigir só os dois efeitos (o novo estado "sem evidência recente" e a tendência por origem). Não cria o diagnóstico histórico. O iniciante continua sem um ponto de partida, mas também deixa de receber um diagnóstico falso.

## 7. Achados novos

### N1 — Excluir uma partida deixa as evidências dos exercícios dela no perfil [R] — P2

- **Fluxo.** `deleteGame` (`src/db/gamesRepo.ts:73-84`) apaga tentativas, exercícios, `skillEvents` com `ref.gameId`, marcações, análise e partida. As evidências de **exercício** só têm `ref.exerciseId` (`skills.ts`, `eventsFromAttempt`) e **ficam no banco**.
- **Comparação.** `deleteExercise` (`trainingRepo.ts:34-41`) apaga essas evidências. A confirmação da interface diz "Excluir esta partida, sua análise e os exercícios derivados?" (`GamesPage.tsx:150`), e o teste `persistence.test.ts:70` se chama "deletes a game with its derived data".
- **Reprodução.** Exercício tentado (1 evidência) e depois `deleteGame`. Resultado: exercício apagado, tentativa apagada, **evidência mantida** (`exerciseEventsAfter: 1`).
- **Impacto.** O perfil continua contando resultados de exercícios que não existem mais e que o usuário pediu para excluir.
- **Recomendação:**
  - em `deleteGame`, apagar também `skillEvents.where('ref.exerciseId').anyOf(exIds)` na mesma transação;
  - decidir se as evidências órfãs já existentes devem ser limpas uma vez (D-5).

### N2 — A tendência "subindo/caindo" mistura tipos de evidência [R] — P2

- **Fluxo.** `estimateSkill` (`skills.ts:202-207`) compara as taxas dos últimos 8 eventos com os 8 anteriores, ponderadas por peso, sem considerar `source`.
- **Reprodução.** 60 evidências de partidas de 1 ano atrás e 5 exercícios de hoje. Resultado: `trend: 'up'` (seta "subindo" em `SkillProfile.tsx:49`). A mudança vem do tipo de evidência, e não do desempenho.
- **Impacto.** O indicador que o usuário lê como "evolução" pode ser fabricado pela ordem em que importa e treina.
- **Recomendação:** tendência por origem, de preferência só com exercícios, que são medições diretas. Faz parte da D-4.

### N3 — Na Evolução, "Revisões pendentes / exercícios vencidos" conta exercícios novos [I] — P3

- **Evidência.** `ProgressPage.tsx:39` faz `exercises.filter(e => e.srs.dueAt <= now)` e exibe o resultado com esse rótulo (`:63-65`). O dashboard e a barra lateral usam `isDueReview`. Com 2 exercícios novos e nenhuma revisão, o dashboard mostra 0 e a Evolução mostra 2.
- A tela Treinar ("Revisar pendentes (N)", com etiqueta "Pendente" na lista) inclui exercícios novos **de propósito**, como registrado na METHODOLOGY §8, e não é defeito.
- **Recomendação:** usar `isDueReview` na Evolução, ou mudar o rótulo. Esforço trivial.

## 8. Débitos já resolvidos (não duplicar)

| Item | Onde foi resolvido |
|---|---|
| A2-1: dica 3 contornada por recarregar | PR #7 (`useExerciseSession.ts:155`), com E2E |
| A2-2: retry depois da dica 3 | PR #7 (`useExerciseSession.ts:184`), com E2E e relógio simulado |
| A5-1: árvore mais rasa descartando erro | PR #7 (`generate.ts:231`), com testes |
| Débitos 1, 5 e 6 da baseline | Sprint 4.3 |
| Contador da barra lateral contando exercícios novos | Sprint 4.4 (E3). Resta a parte de passagem do tempo (C3) |

Continua como observação já registrada no backlog, e **não é achado novo**: um acerto feito mais de 10 minutos depois de ver a solução conta como independente (`PRACTICE_WINDOW_MS`). Isso vale também quando a dica 3 foi vista dentro da janela de prática de uma tentativa anterior.

## 9. Interações entre fluxos

| Sequência | Resultado | Item |
|---|---|---|
| Troca de lado (D3 remove) → tentativa com o objeto antigo | Exercício do lado antigo recriado e protegido do D3 para sempre | P3-3 |
| Derivação em andamento → troca de lado confirmada no intervalo | Exercício do lado antigo gravado, marca `'done'`, sem correção posterior | C1 |
| Treinar os exercícios de uma partida → excluir a partida | Evidências dos exercícios ficam no perfil | N1 |
| Importar partidas antigas (E1 + meia-vida) → regra de antiguidade | "Precisa revisar" sem nenhuma prática | D-4 |
| Partidas antigas → exercícios recentes | Tendência "subindo" artificial | N2 |
| App aberto → revisão vence com o tempo | Barra lateral e dashboard divergem | C3 |
| Análise corrompida → reconciliações | `'pending'` permanente sem aviso | C2 |
| Duas abas derivando a mesma partida | **[H]** A fila é por aba. `addExercise` deduplica e `markDerived` converge pela cor. Não reproduzido, sem perda esperada | Monitorar |
| Restaurar backup com marcas `'pending'` → próxima abertura | Redatação e reconciliação na abertura. Comportamento documentado | OK |

## 10. Priorização

| ID | Problema | Sev. | Impacto para o usuário | Prob. | Evidência | Esforço | Recomendação |
|---|---|---|---|---|---|---|---|
| N1 | Excluir partida deixa evidências de exercícios | **P2** | Perfil conta dados que o usuário excluiu | Média (todo usuário que exclui partida já treinada) | [R] | Baixo | **Corrigir** |
| N2 | Tendência mistura origens | **P2** | Seta de evolução fabricada | Média (iniciantes que importam histórico) | [R] | Baixo a médio | **Corrigir** (com a D-4) |
| D-4 | "Precisa revisar" para quem só tem partidas antigas | **P2** (fidelidade) | Diagnóstico falso no primeiro uso | Alta para novos usuários com histórico | [R] | Médio (B) ou baixo (C') | **Decidir e implementar** |
| P3-3 | Tentativa recria exercício removido | P3 | Exercício do lado errado volta e fica permanente | Baixa | [R] | Baixo | **Corrigir** |
| C1 | Corrida entre derivação e troca de lado | P3 | Exercício do lado errado com marca `'done'` | Muito baixa | [R] com injeção | Baixo | **Corrigir** (junto com P3-3) |
| C3 | Contador não acompanha o tempo | P3 | Números contraditórios | Média (app aberto por muito tempo) | [R] | Trivial | **Corrigir** |
| N3 | "Revisões pendentes" da Evolução conta novos | P3 | Terceiro número diferente para o mesmo rótulo | Alta quando há exercícios novos | [I] | Trivial | **Corrigir** (junto com C3) |
| P3-1 | Fuso no gráfico de evolução | P3 | Dia deslocado no gráfico | Alta no Brasil, só exibição | [R] | Baixo | Opcional |
| P3-2 | Ópera sem teste com o motor real | P3 | Nenhum (falta de rede de proteção) | — | [R] | Baixo a médio | Opcional |
| P3-4 | Duas consultas sem índice | P3 | Nenhum perceptível hoje | — | [R] (medição indicativa) | Baixo | Opcional |
| C2 | `'pending'` permanente sem aviso | P3 | Partida sem exercícios, sem explicação | Baixa | [R] | Médio | Monitorar ou opcional |
| ESLint | Ausência de lint | — | Nenhum direto | — | [I] | Médio (dependência nova) | Fora da 4.5, salvo decisão |
| Duas abas | Fila por aba | — | — | — | [H] | — | Monitorar |
| Documentação | Baseline e relatórios desatualizados | — | Confunde auditorias futuras | — | [I] | Trivial | Atualizar na 4.5 |

**Resumo:**

- **Problemas reproduzidos (10):**
  - os 4 débitos conhecidos: P3-1, P3-2, P3-3 e P3-4;
  - os 3 complementares: C1, C2 e C3;
  - os achados novos N1 e N2;
  - o falso "Precisa revisar" da D-4.
- **Só por inspeção (3):** N3, ausência de ESLint e as divergências de documentação. Os débitos estruturais 5 e 6 foram conferidos no código e estão resolvidos.
- **Hipotético:** duas abas derivando a mesma partida.
- **Já corrigidos:** A2-1, A2-2, A5-1 e os débitos 1, 5 e 6.

## 11. Proposta da Sprint 4.5

### 1. Objetivo central

Fazer o perfil e os contadores continuarem verdadeiros quando ações individualmente corretas se combinam: excluir, trocar de lado, treinar em outra aba, deixar o app aberto e importar histórico antigo.

### 2. Obrigatórios

| # | Item | Descrição |
|---|---|---|
| E1 | **N1** | `deleteGame` apaga também as evidências dos exercícios da partida. Limpeza das órfãs existentes conforme a D-5 |
| E2 | **D-4 + N2** | Implementar a alternativa aprovada (B ou C'). Nas duas, entram a tendência por origem e o estado "sem evidência recente", separado de "Precisa revisar" |
| E3 | **P3-3 + C1** | `recordAttempt` confere a existência do exercício (e usa o `srs` atual) dentro da transação. `addExercise` confere a cor esperada na mesma transação da gravação |
| E4 | **C3 + N3** | O contador da barra lateral acompanha o tempo. A Evolução usa a mesma regra de revisão vencida |
| E5 | **Documentação** | Atualizar `BASELINE-MAIN.md` para o novo SHA e corrigir as situações desatualizadas dos relatórios 4.4 |

### 3. Se houver capacidade

- P3-1: dia UTC para evidências de partida no gráfico.
- P3-2: teste da Ópera com fixture congelado e árvore real.
- P3-4: duas consultas com índice.
- C2: selo "Exercícios pendentes" com "Tentar de novo".

### 4. Fora do escopo

- ESLint, salvo decisão sua.
- Índice para a deduplicação de exercícios (exigiria migração).
- Coordenação entre abas.
- Janela de prática depois de revelar.
- Débitos 2, 3, 4 e 7 da baseline.
- P3-2 e P3-3 da Sprint 4.3: falha de carregamento de tela e limite de passadas.

### 5. Dependências

- E2 depende da D-4, e a decisão vem antes de qualquer código.
- E1 depende da D-5.
- E3 e E4 são independentes.
- E5 fica por último, com os números finais.
- O teste da Ópera (opcional) não depende de nada.

### 6. Riscos de regressão

| Item | Risco |
|---|---|
| E2 | Muda estados e setas visíveis do perfil. Exige testes de fronteira em `skills` e revisão dos testes de `adaptive-boundaries` e `skills` |
| E1 | Remover evidências é destrutivo. Deve ficar restrito a `exerciseId` da partida excluída, na mesma transação, com teste de que outras partidas e eventos de abertura ficam intactos |
| E3 | `recordAttempt` está no caminho de toda tentativa. O teste do caminho normal (A1/A5, prática, sessão guiada) precisa continuar verde |

### 7. Critérios de aceitação

| Item | Critérios |
|---|---|
| E1 | Depois de `deleteGame`, não há `skillEvents` com `ref.exerciseId` dos exercícios da partida. Eventos de outras partidas, de exercícios avulsos e de aberturas ficam intactos. A limpeza das órfãs (se aprovada) é idempotente e só remove eventos cujo exercício não existe |
| E2 (B) | Um usuário com 20 partidas de 1 ano atrás e nenhuma prática **não** vê "Precisa revisar". Vê o diagnóstico histórico com o período e "sem evidência recente" na evolução |
| E2 (B e C') | 5 exercícios recentes depois de partidas antigas não geram "subindo" por mistura de origem. "Precisa revisar" continua aparecendo para queda recente de exercícios e para limite superior abaixo de 50% |
| E3 | Uma tentativa num exercício removido não recria a linha, não grava tentativa nem evidência, e a interface informa. Uma tentativa normal continua gravando os três registros. Uma derivação com a cor trocada no intervalo não grava exercício do lado antigo |
| E4 | Com o relógio simulado, um exercício que vence com o app aberto aparece no contador em até 60 s, sem escrita no banco. A Evolução, o dashboard e a barra lateral mostram o mesmo número de revisões vencidas |
| Geral | Esquema `[1, 2]` sem mudança, nenhuma dependência nova, nenhuma chamada de rede. Vitest, motor real e Playwright verdes, com contagens iguais ou maiores e cobertura ≥ 80%. Cada correção desfeita temporariamente faz algum teste falhar |

### 8. Testes necessários

| Tipo | Testes |
|---|---|
| Unitários | Estados e tendência de `estimateSkill` com origens mistas e evidência antiga. Regra de revisão vencida compartilhada |
| Integração (`fake-indexeddb`) | `deleteGame` com evidências de exercício, de abertura e de outra partida. `recordAttempt` com exercício removido e com `srs` mais novo. `addExercise` com cor trocada (reproduzindo C1 por interceptação, como na sonda). Limpeza idempotente das órfãs |
| Stockfish real | Nenhum obrigatório. Opcional: Ópera com fixture congelado e árvore real |
| E2E | Contador com `page.clock` (C3). Evolução e dashboard coerentes (N3). Diagnóstico de usuário só com partidas antigas (E2). Excluir partida treinada e conferir o perfil (N1) |

### 9. Estimativa

**Média.**

| Item | Esforço |
|---|---|
| E2 | Médio com B, baixo com C'. Concentra o risco |
| E1, E3 e E4 | Baixo cada |
| E5 | Trivial |

### 10. Migração Dexie

**Não é necessária.** Todas as mudanças são de consulta, de regra de cálculo ou de interface. `skillEvents` já tem `source`, `at` e `ref.exerciseId`.

## 12. Decisões que dependem do usuário

| Decisão | Opções | Recomendação |
|---|---|---|
| **D-4** (§6) | A, B, C ou C' | **Decidido pelo usuário em 2026-11-07: B** (diagnóstico histórico separado da evolução recente) |
| **D-5** | Na correção do N1, limpar uma vez as evidências de exercício órfãs que já existem (eventos cujo exercício não existe mais) ou só impedir novas | Limpar. É idempotente, mas é uma remoção de dados existentes, por isso precisa da sua autorização explícita |
| **ESLint** | Incluir numa sprint própria (dependência nova de desenvolvimento) ou manter fora | Manter fora da 4.5 |
| **Opcionais** | Quais entram se houver capacidade (P3-1, P3-2, P3-4, C2) | P3-2 e P3-1 primeiro |
