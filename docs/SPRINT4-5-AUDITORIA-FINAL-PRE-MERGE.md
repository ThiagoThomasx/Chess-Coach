# Sprint 4.5 — Auditoria final pré-merge (PR #8)

Auditoria somente leitura. Nenhum arquivo do projeto foi alterado além deste documento. Nenhum commit, push, merge ou rebase foi feito.

## 1. Identificação

| Item | Valor |
|---|---|
| Repositório | `ThiagoThomasx/Chess-Coach` |
| PR | [#8](https://github.com/ThiagoThomasx/Chess-Coach/pull/8): "feat: consistent profile and counters across combined actions (Sprint 4.5)" |
| Origem → destino | `feat/sprint4-5-consistent-profile` → `main` |
| Estado | Aberto, `MERGEABLE`, `mergeStateStatus: CLEAN` (sem conflitos) |
| SHA auditado (HEAD do PR) | `cd992e767619d31caf5dc989ff6a31f970abcad2` |
| Commits do PR | `64974b0` (Sprint 4.5) e `cd992e7` (correções AI-1 a AI-7) |
| Cópia local | `HEAD` local = `origin/feat/sprint4-5-consistent-profile` = SHA acima. Árvore limpa (só `.claude/` não rastreado, fora do projeto) |
| Data | 2026-11-07/08 |

**Mudou algo depois da auditoria independente?** Não. A auditoria independente (`docs/SPRINT4-5-AUDITORIA-INDEPENDENTE.md`) foi feita sobre `64974b0`. O único commit posterior é `cd992e7`, que aplica as correções AI-1 a AI-7 descritas na seção 11 daquele documento. Esse commit é o foco ampliado desta revisão (seção 6). O conteúdo bate com o que o relatório da Sprint 4.5 descreve: nenhuma mudança de schema, dependência, rede ou motor (`git diff origin/main...HEAD -- package.json package-lock.json public/ scripts/` vazio).

## 2. Estado da CI

| Check | Workflow | Resultado | SHA |
|---|---|---|---|
| `verify` | CI (`.github/workflows/ci.yml`) | **SUCCESS** (2026-11-08 02:28 → 02:30 UTC) | `cd992e7` (HEAD do PR) |

A CI roda em `ubuntu-latest` (fuso UTC): `npm ci`, checagem dos arquivos do Stockfish, typecheck, `npm test` (inclui o motor real), build e Playwright. A CI verde corresponde ao estado auditado.

## 3. Resumo executivo

O PR cumpre o que promete na maior parte das áreas. A integridade dos dados está preservada: exclusões, limpeza de evidências órfãs, `recordAttempt` e a derivação com troca de lado são transacionais e corretos em todas as ordens de execução analisadas. A suíte inteira passa localmente, com os números exatos do relatório (Vitest 391, motor real 23, Playwright 59, linhas 93,76%, branches 83,07%). Os testes das correções de dados detectam a remoção de cada correção (11 de 13 mutações detectadas; as 2 restantes são explicadas na seção 6).

Ficou **um P2 reproduzido** (FA-1): a correção AI-1 fechou o caminho da "queda recente", mas não o do limite fraco (`interval[1] < 50%`). Evidências antigas, de 35 a 200 dias, continuam gerando "Precisa revisar" e a recomendação "Revisar: …" quando existe **uma única** evidência recente. Sem essa evidência recente, a mesma competência aparece como "Sem evidência recente". Na prática, resolver um exercício hoje (até acertando) pode mudar a competência de "Sem evidência recente" para "Precisa revisar". Isso contraria a regra "evidências antigas não geram pedidos de revisão" da alternativa B e a mensagem do commit `cd992e7`. Não há perda nem corrupção de dados.

Há também **cinco P3** (FA-2 a FA-6), de baixo impacto.

**Veredito: APROVADO COM RESSALVAS** (seção 10).

## 4. Metodologia e comandos executados

1. Estado do PR: `gh pr view 8 --json state,headRefName,baseRefName,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,commits`; `git fetch origin`; `git rev-parse HEAD origin/feat/sprint4-5-consistent-profile`.
2. Leitura integral do diff `git diff origin/main...HEAD -- src/ tests/ e2e/` (32 arquivos, +1634/−115) e do código vizinho que ele afeta: `analysisRunner.ts` (derivação, fila por partida, `markDerived`, troca de lado), `analysisRepo.ts`, `gamesRepo.ts`, `trainingRepo.ts`, `backup.ts`, `database.ts` (índices), `recommend.ts`, telas de dashboard, Evolução e Treinar.
3. Suíte completa, executada na cópia local no SHA auditado:
   - `npm run typecheck`
   - `npx vitest run` (inclui `tests/engine-integration.test.ts` com o Stockfish real)
   - `npm run coverage`
   - `npm run build`
   - `npx playwright test` (o config sobe um `vite preview` próprio na porta dedicada, com `reuseExistingServer: false`, e cada teste usa um contexto novo do navegador)
   - `npx vitest run tests/engine-integration.test.ts` isolado (contagem do motor real)
4. Sondas de comportamento: scripts TypeScript **fora do projeto** (diretório temporário da sessão), empacotados com `npx esbuild` (baixado para o cache do npm, sem tocar `package.json` nem `node_modules`) e executados com Node. Eles importam `estimateSkill`/`estimateProfile`/`nextTraining` do código real e medem os cenários de E2.
5. Mutações: `git worktree add --detach` num diretório temporário, com `node_modules` ligado por junção. Cada mutação foi aplicada, os testes relevantes rodaram, e o arquivo foi restaurado. Ao final, o worktree foi removido (`git worktree remove` + `prune`). `git worktree list` e `git status` confirmam a cópia principal intacta no mesmo SHA.

## 5. Resultado por área

### E1 — Exclusão de partidas e integridade das evidências: **conforme**

- `deleteGame` (`src/db/gamesRepo.ts:75-90`) roda numa única transação `rw` sobre `games, analyses, bookmarks, exercises, attempts, skillEvents`. Ele apaga, nessa ordem, as tentativas, as **evidências `ref.exerciseId` dos exercícios da partida** (linha 80, novo), os exercícios, as evidências `ref.gameId`, os marcadores e a análise. É atômico: uma falha parcial desfaz tudo. `anyOf([])` vazio não apaga nada.
- O índice `ref.exerciseId` existe desde a v1 do schema (`database.ts`, `skillEvents: '++id, skill, at, source, ref.gameId, ref.exerciseId'`). Não depende de migração.
- `removeOrphanExerciseEvidence` (`src/db/trainingRepo.ts:98-110`) lê as chaves de `exercises` e apaga, **na mesma transação** `rw` (exercises + skillEvents), só eventos `source: 'exercise'` com `ref.exerciseId` que não está na tabela. Eventos de partida e de abertura não têm `exerciseId` e nunca são candidatos. É idempotente, o que está testado. Como `recordAttempt` só grava evidência depois de reler o exercício na própria transação, não existe janela em que uma evidência válida seja vista como órfã.
- Na inicialização (`App.tsx:33-38`), a limpeza é uma etapa independente: falhar nela não impede `concluir derivações`, e vice-versa.
- Mutação M1 (remover a linha 80) é detectada por `data-consistency.test.ts`. O E2E `consistency.spec.ts:114` cobre o fluxo na interface, e `:131` cobre a limpeza ao reabrir.
- **Não encontrei** cenário em que o perfil mantenha evidências de exercícios inexistentes depois da próxima abertura.

### E2 — Diagnóstico histórico e evolução recente: **parcialmente conforme (FA-1, FA-2)**

O que está correto (verificado no código e pelas sondas):

- **Separação**: `estimateSkill` (`src/services/adaptation/skills.ts:213-280`) calcula a evolução recente (posterior com decaimento, meia-vida de 120 dias) e o diagnóstico histórico (`history`, sem decaimento, com todas as evidências e partidas antigas incluídas).
- **Só evidência antiga** (nada nos últimos 30 dias) dá `no_recent` → "Sem evidência recente", sem taxa recente, sem tendência e sem número pontual. A linha "Diagnóstico histórico" continua exibida.
- **Recência de 30 dias e amostra mínima de 4**: taxa recente, tendência e queda recente só existem com ≥ 4 eventos de uma mesma série nos últimos 30 dias (`skills.ts:232-234`).
- **Tendência do mesmo tipo**: `comparableSeries` (`skills.ts:175`) usa medições diretas (exercício/abertura) quando há alguma, senão lances de partida.
- **Consistência entre componentes**: dashboard (`SkillStates`), Evolução (`SkillProfile`) e recomendações (`nextTraining`) consomem o mesmo `estimateProfile`/`confidence`. A barra lateral não mostra competências (só o contador de revisões). Não há cálculo paralelo divergente.
- Recomendações citam as competências `no_recent` mesmo quando outras são `insufficient` (testado; mutação M11 detectada).

O que falha: veja **FA-1**. Evidências antigas ainda geram "Precisa revisar" pelo limite fraco, desde que exista uma única evidência recente. Veja também FA-2, sobre a escolha de série.

Sondas (agora = 2026-11-07 15:00 UTC; exercícios distintos, peso 1):

| Cenário | Resultado |
|---|---|
| A. 20 erros há 35 dias, nada depois | `no_recent` ✔ |
| B. A + 1 acerto hoje | `needs_review`, `recentRate: null`, recomendação "Revisar: Visão tática" ✗ |
| C. A + 1 lance de partida (peso 0,3) acertado hoje | `needs_review` ✗ |
| D. 20 erros há 200 dias + 1 acerto hoje | `needs_review`, recomendação "Revisar" ✗ |
| E. 20 acertos há 60 dias + 3 erros hoje | `consistent`, sem taxa recente (3 < 4) ✔ |
| F. 6 exercícios acertados há 300 dias + 30 lances de partida errados nos últimos 10 dias | `needs_review` (correto pelo volume recente), mas `recentRate: null` e `trend: unknown` (FA-2) |

### E3 — Concorrência e integridade transacional: **conforme**

Todos os cenários foram analisados pela serialização das transações `rw` do IndexedDB. Duas transações `rw` com tabelas em comum nunca se intercalam, inclusive entre abas.

| # | Cenário | Ordem A | Ordem B | Resultado |
|---|---|---|---|---|
| 1 | Aba 1 registra tentativa; aba 2 exclui o exercício ou a partida | tentativa primeiro: depois a exclusão apaga a tentativa e a evidência (`deleteExercise`/`deleteGame`) | exclusão primeiro: `recordAttempt` relê o exercício, não acha e devolve `removed: true` sem gravar nada (`trainingRepo.ts:78-79`) | consistente ✔ |
| 2 | Troca de lado durante a geração automática | — | a troca remove os exercícios nunca tentados do lado antigo; o `addExercise` da derivação antiga confere a cor **na própria transação** (`trainingRepo.ts:33-34`) e para (`colorChanged` → `break`) | nenhum exercício do lado antigo é recriado ✔ |
| 3 | Tentativa depois da remoção | — | idem 1B; a UI mostra "Este exercício foi removido… A tentativa não foi gravada." | ✔ |
| 4 | Geração termina depois da mudança de contexto | — | `markDerived` só marca `done` se a cor ainda é a usada; senão repassa (até 3 vezes). Partida excluída: `deriveNow` apaga as evidências `ref.gameId` no fim | ✔ |
| 5 | Duas operações nos mesmos registros (duas tentativas, duas abas) | — | `recordAttempt` monta o SRS sobre o exercício **gravado**, não sobre a cópia da tela (teste e mutação M3) | ✔ |

Sobre a qualidade dos testes de concorrência:

- O teste da troca de lado (`data-consistency.test.ts`, terceiro bloco) é um intercalamento **real**: ele intercepta a 2ª leitura de `games.get`, dispara `changeUserColor` de verdade e espera 50 ms antes de devolver a leitura antiga. A mutação M4 (remover o guarda) é detectada.
- Os testes de "tentativa em exercício removido" e "SRS sobre o exercício gravado" são **sequenciais** (a remoção ou a atualização acontece antes da tentativa). Isso basta aqui, porque a garantia vem da releitura dentro da transação, e as duas ordens possíveis estão cobertas. Não há teste com duas conexões Dexie simulando abas. Os testes não provam a serialização do IndexedDB; eles dependem dela (P3 de cobertura, dentro de FA-6).

### E4 — Contadores e revisões vencidas: **conforme, com FA-4**

- Regra única `isDueReview` (só exercícios já tentados) na barra lateral (`AppShell.tsx`), no dashboard e na Evolução (`ProgressPage.tsx:44`, antes `dueAt <= now`). A mutação M12 sobrevive no Vitest, mas é coberta pelo E2E `consistency.spec.ts:72` (espera `1`, e não `3`).
- Atualização com o tempo: `useMinute` (intervalo de 60 s, limpo no desmonte). A barra lateral o usa como dependência do `useLiveQuery`. Dashboard e Evolução renderizam de novo e recalculam `now`. Atraso máximo de cerca de 60 s, sem efeito colateral nem gravação. A virada de dia é coberta porque `now` é recalculado a cada renderização. E2E com relógio simulado: `consistency.spec.ts:58` (barra lateral) e `:141` (dashboard).
- A tela Treinar ("Pendentes (N)") conta propositalmente novos + vencidos (AI-5). Ela não usa `useMinute` (FA-4).

### E5 — Gráfico e fuso horário: **conforme no caso principal, com FA-3**

- `evidenceDayKey` (`stats.ts:56`) lê evidência de partida no dia UTC (a data do PGN é gravada como 00:00 UTC) e as demais no dia local. Com isso, a partida de 10/01 aparece em 10/01 em São Paulo (antes, 09/01). O valor gravado (`at`) não muda.
- O teste fixa `TZ=America/Sao_Paulo` e confere que o fuso é negativo, então também protege na CI em UTC (mutação M10 detectada).
- Exceção: veja FA-3. Uma partida sem `[Date]` usa `importedAt`, que é um instante real, e é lida em UTC. O mês/ano da linha histórica usa UTC também para eventos de exercício.

### E6 — Consultas e índices: **conforme**

| Consulta | Antes | Depois | Índice |
|---|---|---|---|
| `redateGameEvidence` | `skillEvents.filter(source==='game')` (varredura) | `where('source').equals('game')` | `source` (v1) |
| `removeUnattemptedExercises` | `exercises.filter(gameId && side)` | `where('gameId').equals(id).filter(side)` | `gameId` (v1) |
| `deleteGame` (novo) | — | `where('ref.exerciseId').anyOf(ids)` | `ref.exerciseId` (v1) |
| `removeOrphanExerciseEvidence` (novo) | — | `where('source').equals('exercise')` + filtro | `source` (v1) |

Os resultados são equivalentes (mesmo predicado, só a seleção inicial muda). Nenhum índice novo, nenhuma versão nova de schema e nenhuma migração pendente. Bancos existentes são compatíveis.

### E7 — Stockfish e Partida da Ópera: **conforme, com a ressalva já conhecida**

- `tests/engine-integration.test.ts` roda o mesmo WASM servido pelo app (`stockfish-19-lite-single`) num processo filho (`tests/support/sf-bridge.cjs`), sem rede. São 23 testes, que passam isolados e dentro da suíte.
- Ópera, 15.Bxd7+ (meia-jogada 29): a análise rápida de profundidade 11 está **congelada** (valores reais capturados do motor), e só a árvore de profundidade 16 usa o motor ao vivo. Isso torna a pré-condição ("blunder" na profundidade 11) determinística. A asserção depende de Bxd7+ ser aceito na profundidade 16, onde é o melhor lance com folga de cerca de 400 cp, então o determinismo é suficiente. É um mock parcial da análise rápida, declarado no próprio teste e aceitável para isolar a regra O1.
- O segundo teste (AI-3) percorre `deriveFromAnalysis` integrado com o motor real e confere 0 exercícios.
- Nenhuma mudança em `engineService`, Worker ou arquivos do motor.

## 6. Revisão das correções pós-auditoria independente (`cd992e7`)

| Item | Verificação | Resultado |
|---|---|---|
| AI-1: janela recente por tempo | Código correto para taxa recente, tendência e queda (M6, M7 detectadas). **Não** cobre o caminho `interval[1] < 0,5` com evidências antigas decaídas (sondas B, C, D). O teste "year-old exercises plus one today" não verifica `confidence` | **Parcial → FA-1** |
| AI-2: dashboard e Evolução por minuto | `useMinute()` nas duas páginas; E2E com relógio simulado | ✔ |
| AI-3: Ópera integrada | `deriveFromAnalysis` com o motor real | ✔ |
| AI-4: fuso no teste | `TZ` fixado e verificado; M10 detectada | ✔ |
| AI-5/AI-6: rótulos | "Pendentes (N)" com `title`; "Evolução recente:"; E2E | ✔ |
| AI-7: documentação | Relatório atualizado | ✔ |
| Etapas de inicialização independentes | Correto por inspeção: cada `step` captura o próprio erro e resolve, então a próxima etapa roda. **Sem teste** (FA-5) | ✔ código / ✗ teste |
| Recomendação cita "sem evidência recente" | Testado; M11 detectada | ✔ |
| Feedback do solucionador acessível | `role="status" aria-live="polite"` presente. **Sem teste**, e a região é criada junto com o texto (FA-5) | ✔ parcial |

**Mutações** (cada uma aplicada isoladamente num worktree temporário):

| # | Mutação | Testes | Resultado |
|---|---|---|---|
| M1 | `deleteGame` sem apagar evidências `ref.exerciseId` | data-consistency | detectada |
| M2 | `recordAttempt` sem a checagem de exercício removido | data-consistency | detectada |
| M3 | SRS sobre a cópia da tela (`ex.srs`) | data-consistency | detectada |
| M4 | `addExercise` sem o guarda de cor | data-consistency | detectada |
| M5 | limpeza de órfãs sem o filtro `source = 'exercise'` | data-consistency | **sobreviveu**: equivalente hoje, porque eventos de partida e de abertura não têm `exerciseId`. O filtro é defensivo, não um defeito |
| M6 | amostra mínima 4 → 1 | skills | detectada (3 falhas) |
| M7 | janela de 30 dias removida | skills | detectada (4 falhas) |
| M8 | `comparableSeries` mistura os tipos | skills | detectada |
| M9 | volta ao "antigo = precisa revisar" | skills | detectada (3 falhas) |
| M10 | `evidenceDayKey` sempre local | evidence-dates | detectada |
| M11 | recomendação sem "sem evidência recente" | skills | detectada |
| M12 | Evolução com `dueAt <= now` | Vitest completo | sobreviveu no Vitest; coberta pelo E2E `consistency.spec.ts:72` |
| M13 | inicialização encadeada sem `catch` por etapa | — | não há teste que cubra (FA-5) |

Não encontrei condições especiais no código de produção que existam só para os testes passarem.

## 7. Resultados dos testes

| Indicador | Esperado (Sprint 4.5) | Obtido nesta auditoria | Situação |
|---|---:|---:|---|
| Typecheck | — | sem erros | ✔ |
| Vitest | 391 | **391 passed** (24 arquivos) | igual |
| Stockfish real | 23 | **23 passed** (arquivo isolado) | igual |
| Build de produção | — | ok (`vite build` em 731 ms) | ✔ |
| Playwright | 59 | **59 passed** (1,3 min) | igual |
| Cobertura de linhas | 93,76% | **93,76%** (1999/2132) | igual |
| Cobertura de branches | 83,07% | **83,07%** (1821/2192) | igual |
| Statements / funções | — | 90,27% / 87,16% | — |

A cobertura mede só `src/services/**` e `src/db/**` (script `coverage`). Componentes React e `App.tsx` ficam fora dela e dependem do E2E.

Não há dependência de estado residual: cada arquivo Vitest cria um `ChessQuestDB` com nome próprio, o Playwright sobe o próprio servidor (`reuseExistingServer: false`, `--strictPort`) e usa um contexto novo por teste.

## 8. Arquitetura e segurança dos dados

- **Rede, backend e telemetria**: nenhum `fetch`, `XMLHttpRequest`, `WebSocket` ou `sendBeacon` em `src/`. Nenhuma dependência nova (`package.json` e lockfile intactos). Stockfish intacto.
- **Schema e migrações**: nenhuma alteração. `SCHEMA_VERSIONS` intacto.
- **Perda de dados**: as únicas remoções novas são (a) evidências de exercícios que deixam de existir, por decisão D-5 aprovada, e (b) o já existente na troca de lado (D3). Nenhum caminho sobrescreve tentativas ou exercícios válidos.
- **Backups**: `exportBackup` exporta todas as tabelas, e `restoreBackup` substitui só as tabelas presentes no arquivo (`if (!rows) continue`). Num arquivo editado à mão sem `exercises`, a tabela atual de exercícios **é mantida**, e a limpeza remove na próxima abertura apenas as evidências do backup cujos IDs não existem no banco atual. Esse comportamento está documentado em `docs/METHODOLOGY.md:210` e em `SPRINT4-5-RELATORIO.md:113`. Em backups legítimos, exportados pelo app em qualquer versão (a tabela `exercises` existe desde a v1), a única remoção possível são as órfãs que já existiam no banco de origem, que é exatamente o que D-5 autoriza. **Não há risco adicional para backups legítimos.**

## 9. Achados classificados

### P0 / P1

Nenhum.

### FA-1 — Evidências antigas ainda geram "Precisa revisar" com uma única evidência recente (P2)

- **Arquivo**: `src/services/adaptation/skills.ts:259` (`else if (recentDrop || interval[1] < WEAK_UPPER_BOUND) confidence = 'needs_review'`), com `interval` vindo do posterior decaído (`skills.ts:222`) e `stale` calculado só a partir do último evento (`skills.ts:256`).
- **Reprodução**: 20 exercícios errados há 35, 90 ou 200 dias, mais 1 exercício **acertado** hoje.
- **Evidência**: `confidence: 'needs_review'`, `recentRate: null`, `history.level: 0,09`. `nextTraining` devolve "Revisar: Visão tática" → `/train?skill=tactics`. Sem o acerto de hoje, o resultado é `no_recent`. Um único lance de partida (peso 0,3) produz o mesmo efeito (cenário C).
- **Causa**: AI-1 aplicou a amostra mínima de 4 eventos recentes à queda recente, mas o limite fraco continua sendo avaliado sobre o posterior com decaimento. Com meia-vida de 120 dias, evidência de meses atrás ainda pesa bastante, e basta um evento recente para `stale` ser falso.
- **Impacto**: a competência aparece em "Precisam revisar" no dashboard e na Evolução, e a recomendação principal manda revisá-la, com base quase só em evidência antiga. O sinal oscila de forma contraintuitiva: resolver um exercício corretamente hoje troca "Sem evidência recente" por "Precisa revisar". Isso viola a regra explícita da alternativa B e a afirmação do commit `cd992e7` ("one recent event no longer turns weeks- or year-old data into 'needs review'"). Não afeta dados persistidos.
- **Cobertura**: nenhum teste verifica `confidence` nesse cenário. O teste "year-old exercises plus one today" usa 12/12, que fica acima de 50%.
- **Recomendação**: exigir `hasRecent` (≥ 4 eventos em 30 dias) também para o ramo `interval[1] < WEAK_UPPER_BOUND`, ou avaliar o limite fraco só sobre a janela recente. Sem amostra recente suficiente, o estado deveria ser `no_recent`, ou "Em desenvolvimento" com o histórico exibido. Junto, um teste com os cenários B, C e D, verificando `confidence` e a recomendação.

### FA-2 — A série de comparação ignora lances recentes de partida se houver qualquer exercício antigo (P3)

- **Arquivo**: `skills.ts:175-178` (`comparableSeries`).
- **Reprodução**: 6 exercícios acertados há 300 dias + 30 lances de partida errados nos últimos 10 dias.
- **Evidência**: `recentRate: null`, `trend: 'unknown'`. A série escolhida são os exercícios antigos, sem nenhum evento na janela. O estado `needs_review` sai corretamente pelo limite fraco.
- **Impacto**: a Evolução mostra "recente —" e nenhuma tendência, apesar de muita evidência recente de um mesmo tipo. Informação faltando, não incorreta.
- **Recomendação**: escolher o tipo pela disponibilidade **dentro da janela** (direta, se houver ≥ 4 recentes, senão partida).

### FA-3 — Dia/mês UTC aplicado a instantes reais (P3)

- **Arquivos**: `src/services/stats/stats.ts:56-60`; `src/services/games/gameDate.ts:34` (sem `[Date]`, o fallback é `importedAt`); `src/features/progress/SkillProfile.tsx:19` (`monthYear` em UTC para todas as evidências).
- **Reprodução**: importar, depois das 21h no horário de Brasília, uma partida sem cabeçalho `[Date]`. Ou ter o último evento histórico num exercício resolvido em 31/10 às 22h no horário de Brasília.
- **Impacto**: o ponto do gráfico cai no dia seguinte, ou a linha histórica mostra "11/2026" em vez de "10/2026". Só exibição.
- **Recomendação**: ler em UTC apenas quando o horário vem de `gameTime` (data do PGN). Para `importedAt` e exercícios, usar o dia/mês local.

### FA-4 — "Pendentes (N)" na tela Treinar não acompanha o tempo (P3)

- **Arquivo**: `src/features/training/TrainingPage.tsx:40,79`.
- **Reprodução**: deixar a tela Treinar aberta enquanto uma revisão vence. O botão só atualiza com uma gravação no banco ou na próxima navegação, ao contrário da barra lateral, do dashboard e da Evolução.
- **Recomendação**: chamar `useMinute()` na página, como em AI-2.

### FA-5 — Correções sem teste: inicialização independente e região viva do solucionador (P3, cobertura/a11y)

- **Arquivos**: `src/app/App.tsx:33-38`; `src/features/training/ExerciseSolver.tsx:98-99`.
- **Evidência**: a mutação M13 (encadear sem `catch` por etapa) não tem teste que a detecte. Também não há asserção de `role="status"`/`aria-live`. Além disso, o `<p role="status">` só é criado quando há feedback. Alguns leitores de tela não anunciam uma região viva inserida no DOM junto com o conteúdo, só mudanças numa região que já existia.
- **Recomendação**: um teste unitário com uma etapa rejeitando e as seguintes chamadas. Um contêiner `role="status"` sempre montado, com o texto trocado dentro dele, e uma asserção no E2E.

### FA-6 — Concorrência entre abas testada só por ordem sequencial (P3, cobertura)

- **Arquivo**: `tests/data-consistency.test.ts` (blocos de `recordAttempt`).
- **Evidência**: a remoção/atualização acontece antes da tentativa. A correção é garantida pela releitura dentro da transação `rw`, e as duas ordens possíveis estão cobertas, mas não há teste com duas conexões simulando abas.
- **Recomendação** (opcional): um teste com duas instâncias `ChessQuestDB` com o mesmo nome e operações disparadas em paralelo.

## 10. Débitos técnicos que permanecem (fora do escopo)

| Débito | Risco para esta integração | Classificação |
|---|---|---|
| Aviso para partidas cuja geração de exercícios falha persistentemente | A partida fica `pending` e é retentada a cada abertura; o erro vai para o console. Sem perda de dados | Débito aceitável |
| ESLint ausente | Typecheck estrito e testes cobrem o essencial | Débito aceitável |
| Índice contra exercícios duplicados (exigiria migração) | `addExercise` deduplica na transação (varredura por `fenKey`). Custo linear, sem risco de duplicata | Débito aceitável |
| Coordenação completa entre abas | Integridade garantida pelas transações (E3). O que resta é a UI de uma aba mostrar dado desatualizado até o próximo `liveQuery`, que é sem perda | Débito aceitável |
| Teste físico em celular | E2E cobre 320–768 px e toque emulado | Débito aceitável |

Nenhum desses itens bloqueia o merge.

## 11. Comparação com a auditoria independente anterior

| Auditoria anterior (sobre `64974b0`) | Situação no HEAD `cd992e7` |
|---|---|
| AI-1 (P2), janela por quantidade | **Parcialmente resolvido.** Taxa recente, tendência e queda: resolvido. O caminho do limite fraco permanece → FA-1 (P2) |
| AI-2 (P3), dashboard parado no tempo | Resolvido (a tela Treinar ficou de fora → FA-4) |
| AI-3 (P3), Ópera sem derivação integrada | Resolvido |
| AI-4 (P3), fuso no teste | Resolvido |
| AI-5 / AI-6 (P3), rótulos | Resolvidos |
| AI-7 (P3), documentação | Resolvido |
| E1, E3, E4 "conformes" | Confirmados de forma independente |
| Ressalva do backup parcial | Confirmada, documentada, sem risco para backups legítimos |
| Números de testes e cobertura | Reproduzidos exatamente |

## 12. Veredito final

> Este é o veredito sobre `cd992e7`. Para o estado depois da correção do FA-1 (`d474223`), veja a seção 13, que traz o veredito atualizado.

**APROVADO COM RESSALVAS**

- Nenhum P0 ou P1. A integridade dos dados está preservada: exclusões, limpeza de órfãs, tentativas e derivação são transacionais e consistentes em todas as ordens analisadas.
- CI verde no SHA auditado. A suíte completa reproduz exatamente os números reportados. Não há regressão funcional, e a arquitetura local-first está preservada (sem rede, sem dependências, sem schema novo).
- **Ressalva principal, FA-1 (P2):** evidências antigas ainda geram "Precisa revisar" e uma recomendação de revisão quando existe uma única evidência recente. Isso descumpre parcialmente a regra central da alternativa B e a correção AI-1. O impacto é só de diagnóstico e recomendação, sem dados afetados. Recomendação: corrigir antes do merge (mudança pequena e localizada em `skills.ts:259`, mais um teste). Se o merge seguir como está, aceitar a ressalva explicitamente e corrigi-la logo em seguida.
- **Ressalvas menores:** FA-2 a FA-6 (P3) podem ficar para depois do merge.

A decisão de integração é exclusivamente do usuário. Esta auditoria não fez merge, commit nem push, e não alterou nenhum arquivo além deste documento.

## 13. FA-1 — Correção pós-auditoria

### 13.1 Identificação

| Item | Valor |
|---|---|
| Achado | **FA-1** (P2): evidências antigas geravam "Precisa revisar" pelo limite fraco quando havia uma única evidência recente |
| Commit da correção | `d474223fcda7503d886f63f370f3cef276adcf86`, "fix: old evidence no longer asks for review through the weak bound (FA-1)", sobre `cd992e7` |
| Arquivos | `src/services/adaptation/skills.ts` (+6/−1), `tests/skills.test.ts` (+34), `docs/METHODOLOGY.md` (regra na tabela de estados), este relatório |
| Validação pós-correção | 2026-11-08, sobre o HEAD `d474223` (local = remoto = HEAD do PR #8), árvore limpa exceto `.claude/` (não versionada) |

### 13.2 Defeito, relevância e causa (antes da correção)

- **Defeito**: 20 exercícios errados há 35, 90 ou 200 dias + 1 acerto hoje → `needs_review` e a recomendação "Revisar: …". Sem o acerto de hoje → `no_recent`.
- **Relevância**: contrariava a regra da alternativa B ("evidências antigas não geram pedidos de revisão") e a afirmação da correção AI-1. Na prática, resolver um exercício corretamente piorava o estado exibido.
- **Causa**: o ramo `interval[1] < 50%` usava o posterior com decaimento (meia-vida de 120 dias, então o peso antigo continua alto), e um único evento recente bastava para `stale` ser falso.

### 13.3 Alteração implementada

Em `estimateSkill`, o ramo do limite fraco agora exige amostra recente:

```ts
const recentSample = events.filter((e) => now - e.at <= STALE_DAYS * DAY_MS).length >= MIN_RECENT;
const weak = recentSample && interval[1] < WEAK_UPPER_BOUND;
...
else if (recentDrop || weak) confidence = 'needs_review';
```

- Amostra recente: ≥ 4 eventos (`MIN_RECENT`) de **qualquer tipo** nos últimos 30 dias (`STALE_DAYS`), as mesmas constantes da janela recente. O "qualquer tipo" preserva o caso de exercícios antigos seguidos de muitos lances de partida errados recentes, que continua pedindo revisão.
- Ficam inalterados: o diagnóstico histórico (`history`, sem decaimento), a taxa recente, a tendência, a queda recente, `no_recent` e a consolidação. Sem amostra recente, a competência cai em "Em desenvolvimento" (ou "Consolidada", se cumprir os critérios), e a linha histórica continua mostrando a fraqueza.
- A correção não suprime revisões: com amostra recente fraca, a revisão continua sendo pedida (cenários B e C abaixo).

### 13.4 Os seis testes adicionados (`tests/skills.test.ts`, bloco "final audit FA-1")

| # | Cenário | Esperado | Regra validada | Sem a correção |
|---|---|---|---|---|
| 1–3 | 20 erros há 35 / 90 / 200 dias + 1 acerto hoje (`it.each`) | não `needs_review`; `history.level < 0,2`; recomendação sem "Revisar" | antigo não pede revisão; histórico preservado | **falha** (3) |
| 4 | 20 erros há 35 dias + 1 lance de partida (peso 0,3) hoje | não `needs_review` | vale também para evidência de partida | **falha** |
| 5 | 20 erros há 35 dias: `no_recent`; + 1 acerto hoje: não `needs_review` | sem a inversão de estado | um acerto não piora o estado | **falha** |
| 6 | (a) 8 erros recentes; (b) 6 exercícios antigos bons + 30 lances de partida errados recentes | `needs_review` nos dois | revisão legítima preservada, de qualquer tipo | passa (guarda) |

**Mutação**: removi o gate (`const weak = interval[1] < WEAK_UPPER_BOUND`) num worktree temporário, e os testes 1–5 falharam (5 failed | 36 passed). O guarda 6 também passa sem a correção, como deveria.

**Lacuna**: nenhum dos seis cobre amostra recente suficiente e **boa** acompanhada de muita evidência antiga ruim (FA-7 abaixo).

### 13.5 Testes nesta validação (HEAD `d474223`)

| Indicador | Antes da FA-1 (`cd992e7`) | Agora (`d474223`) |
|---|---:|---:|
| Typecheck | ok | **ok** |
| Vitest | 391 | **397** (+6 novos; nenhum existente removido ou alterado) |
| Stockfish real (arquivo isolado) | 23 | **23** |
| Build de produção | ok | **ok** |
| Playwright | 59 | **59** |
| Cobertura de linhas | 93,76% (1999/2132) | **93,76%** (2001/2134) |
| Cobertura de branches | 83,07% (1821/2192) | **83,09%** (1823/2194) |
| Statements / funções | 90,27% / 87,16% | 90,28% / 87,18% |

As pequenas diferenças de cobertura vêm das duas linhas e dos dois ramos novos (`recentSample && …`), todos cobertos pelos testes novos.

### 13.6 Revisão de regressões

Sondas com o código real (agora = 2026-11-08 15:00 UTC; exercícios distintos, peso 1):

| Cenário | Estado | Taxa recente / tendência | Histórico | Recomendação | Avaliação |
|---|---|---|---|---|---|
| A. 20 erros há 60 dias, só isso | `no_recent` | — / unknown | 5% | Ampliar o diagnóstico | ✔ |
| B. 10 erros recentes, só isso | `needs_review` | 0% / unknown | 8% | Revisar | ✔ revisão legítima |
| B2. 10 acertos recentes | `consistent` | 100% | 92% | — | ✔ |
| C. 20 erros antigos + 6 erros recentes | `needs_review` | 0% / stable | 4% | Revisar | ✔ |
| C2. 20 acertos antigos + 6 erros recentes | `needs_review` | 0% / down | 75% | Revisar | ✔ queda real |
| D. 20 erros antigos + 3 acertos recentes (< 4) | `consistent` | — / unknown | 16% | Ampliar | ✔ sem revisão abaixo da amostra mínima |
| **E. 20 erros há 60 dias + 4 acertos recentes** | **`needs_review`** | **100% / up** | 19% | **Revisar** | ✗ **FA-7** |
| E2. 20 erros há 60 dias + 8 acertos recentes | `consistent` | 100% / up | 30% | Ampliar | ✔ |
| **E3. 40 erros há 90 dias + 8 acertos recentes** | **`needs_review`** | **100% / up** | 18% | **Revisar** | ✗ **FA-7** |
| E4. 8 acertos + 4 erros recentes | `consistent` | 50% / down | 64% | — | ✔ |
| F. 6 exercícios antigos bons + 30 lances errados recentes | `needs_review` | — / unknown (FA-2) | 41% | Revisar | ✔ estado; FA-2 continua |

Componentes: dashboard (`SkillStates`), Evolução (`SkillProfile`) e recomendações (`nextTraining`) continuam consumindo o mesmo `estimateProfile(...).confidence`, e a correção só mexe dentro de `estimateSkill`. Barra lateral, contadores e revisões vencidas (`isDueReview`) não dependem dessa função e não mudaram. O Playwright completo (59) confirma as telas.

**Diagnóstico histórico, taxa recente, tendências e `no_recent`**: sem mudança de comportamento (o diff não toca esse código, e as sondas A, B2, C2 e E4 batem com a seção 5).

### 13.7 Achado novo: FA-7 — Com amostra recente suficiente e boa, evidências antigas ainda pedem revisão (P2)

- **Arquivo**: `src/services/adaptation/skills.ts:258-264`. Depois que o gate de amostra recente abre, o limite fraco continua avaliado sobre o posterior **com decaimento de todas as evidências** (`interval`, linha 220), e não sobre as evidências recentes.
- **Reprodução**: cenários E (20 erros há 60 dias + 4 acertos nos últimos dias) e E3 (40 erros há 90 dias + 8 acertos recentes).
- **Evidência**: `needs_review` e a recomendação "Revisar: Visão tática", ao lado de "recente 100% · subindo".
- **Impacto**: um jogador que melhorou e acertou todos os exercícios recentes é mandado revisar, por causa de erros de meses atrás. Contraria a regra "a decisão de revisão respeita os critérios de evidência recente" (cenários C e E desta validação). Só afeta diagnóstico e recomendação, sem dados persistidos.
- **Origem**: **não é uma regressão do `d474223`**. Já acontecia em `cd992e7` e na `main` (lá até com menos evidência recente). É a mesma família do FA-1, que corrigiu o caso de amostra insuficiente, mas não o de amostra suficiente e boa.
- **Consistência com a metodologia**: a implementação corresponde ao texto atual de `METHODOLOGY.md` ("limite superior < 50%, desde que haja pelo menos 4 evidências recentes"). O texto não promete avaliar o limite só sobre as evidências recentes. Portanto, não há divergência entre código e documento. O que diverge é a regra de produto mais ampla.
- **Recomendação**: avaliar o limite fraco sobre as evidências da janela recente (por exemplo, o posterior das últimas ≥ 4 evidências dos 30 dias), ou exigir também `recentRate < 0,5`. Junto, testes com os cenários E e E3, e a atualização da linha da metodologia.
- **Fora do escopo desta validação**: as regras desta etapa autorizam só a atualização do relatório. FA-7 está registrado e não corrigido.

### 13.8 Situação dos achados

| Achado | Situação |
|---|---|
| FA-1 (P2) | **Corrigido e validado** em `d474223`: testes, mutação, suíte completa e sondas |
| FA-7 (P2, novo) | **Aberto**, documentado acima. Não é regressão do commit |
| FA-2 a FA-6 (P3) | Abertos, sem mudança |

### 13.9 Veredito atualizado (estado `d474223` + este relatório)

**APROVADO COM RESSALVAS**

- FA-1 está tecnicamente corrigido. Os seis testes novos passam e detectam a remoção da correção. Não há regressão: suíte completa verde e mesmos números, mais os 6 testes novos. A documentação é consistente com o código. A integridade dos dados não é afetada.
- Nenhum P0 ou P1. Resta **um P2 aberto (FA-7)**, que impede o veredito APROVADO pelo critério "nenhum P0, P1 ou P2 aberto". FA-7 afeta só diagnóstico e recomendação, já existia antes do PR e está documentado.
- **Decisão a explicitar pelo usuário**: aceitar FA-7 como ressalva e corrigi-lo depois do merge, ou corrigi-lo antes. Recomendo corrigir antes do merge, porque é uma mudança pequena no mesmo ponto do código e na mesma regra de produto.
- CI: `verify` **SUCCESS** em `d474223`. O commit documental com este relatório dispara uma nova execução, cujo resultado consta do relatório final ao usuário.

### 13.10 FA-7 — Correção (depois de `8dea279`)

A pedido do usuário, o FA-7 foi corrigido na mesma branch. No momento deste registro, a correção ainda não tem commit.

- **Alteração** (`src/services/adaptation/skills.ts`, em `estimateSkill`): o limite fraco ("limite superior do intervalo de 90% < 50%") é medido sobre o posterior **só das evidências dos últimos 30 dias**, de qualquer tipo, com 1/k para repetições contado sobre todo o histórico, sem decaimento. Antes, ele usava o posterior decaído de todas as evidências. Continua exigindo ≥ 4 evidências nessa janela (FA-1). Queda recente, diagnóstico histórico, taxa recente, tendência, `no_recent` e consolidação ficam inalterados.
- **Testes** (`tests/skills.test.ts`, bloco "final audit FA-7", 4 casos, escritos antes da correção):
  - 20 erros há 60 dias + 4 acertos recentes, e 40 erros há 90 dias + 8 acertos recentes: não `needs_review`, taxa recente de 100%, histórico abaixo de 35% e recomendação sem "Revisar". Os dois **falharam antes** da correção (RED).
  - Dois guardas, que passavam antes e continuam passando: acertos antigos + erros recentes continuam pedindo revisão (queda real); e uma amostra recente claramente abaixo de 50% (5 erros + 1 acerto) pede revisão mesmo sem queda.
  - Os seis testes do FA-1 continuam passando, inclusive o guarda com 30 lances de partida errados recentes.
- **Sondas** (mesmos cenários da 13.6): **E** e **E3** passam a dar `consistent` ("Em desenvolvimento") e "Ampliar o diagnóstico". A, B, B2, C, C2, D, E2, E4 e F ficam com o mesmo resultado de antes (B, C, C2 e F continuam pedindo revisão).
- **Suíte**:

  | Verificação | Resultado |
  |---|---:|
  | Typecheck | ok |
  | Vitest | **401** (397 + 4) |
  | Stockfish real | **23** |
  | Playwright, com build de produção | **59** |
  | Cobertura de linhas | **93,77%** (2004/2137) |
  | Cobertura de branches | **83,09%** (1823/2194) |
  | Statements / funções | 90,30% / 87,22% |

- **Metodologia**: a linha "Precisa revisar" da tabela de estados em `docs/METHODOLOGY.md` passa a dizer que o limite é medido só sobre as evidências dos últimos 30 dias.

**Situação**: FA-1 e FA-7 estão corrigidos, e não há P0, P1 nem P2 aberto. Restam FA-2 a FA-6 (P3). Pelos critérios desta auditoria, o veredito passa a **APROVADO COM RESSALVAS** (apenas P3). Esse veredito ainda depende de duas coisas: o commit desta correção e a CI verde no novo SHA.
