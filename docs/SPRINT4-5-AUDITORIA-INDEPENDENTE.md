# Sprint 4.5 — Auditoria independente

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Branch | `feat/sprint4-5-consistent-profile` |
| Commit auditado | `64974b0cc425e1bc555cfbee173ebe342de3ae8f` (HEAD local = HEAD remoto) |
| Base | `edf4de89c049bccbdf12c7b63bcc10aaec238e3c` (`origin/main`, merge do PR #7) |
| Veredito | **APROVADO COM RESSALVAS** (§10) |

Legenda: **[R]** reproduzido por execução · **[I]** demonstrado por inspeção · **[H]** risco hipotético.

## 1. Baseline e commit-base

- **[R]** A branch está um commit à frente de `origin/main` (`64974b0`), com merge-base em `edf4de8`. Não há commits de outra origem.
- **Working tree:** limpa, exceto `?? .claude/` (não versionada, preservada).
- **Divergência com o contexto do pedido.** O pedido diz que "ainda não foi realizado commit". Na verdade, a sprint está commitada em `64974b0`, enviada, com o **PR #8 aberto**: `MERGEABLE / CLEAN`, CI `verify` aprovada, run `42429628113`. A auditoria foi feita sobre esse commit, sem alterar a branch nem o PR.
- **Escopo do diff** (29 arquivos, +1224 / −109): só `src/`, `tests/`, `e2e/` e `docs/`. **Não há mudança** em `package.json`, lockfile, `public/engine`, `src/services/engine`, `.github`, `playwright.config.ts`, `vite.config.ts` ou `src/db/database.ts` (esquema). Também não há `fetch`, XHR, WebSocket, `sendBeacon` ou URL nova.

## 2. Escopo e metodologia

1. Leitura do diff completo contra `edf4de8` e dos consumidores do perfil:
   - `SkillStates.tsx`, `SkillProfile.tsx`, `ProgressCharts.tsx`, `ProgressPage.tsx`;
   - `DashboardPage.tsx`, `TrainingPage.tsx`, `useTrainingLoop.ts`;
   - `recommend.ts`, `session.ts`, `AppShell.tsx`.
2. Execução completa numa **worktree descartável** em `64974b0`, com `npm ci`, removida no fim. O checkout de trabalho, a branch e os dados reais do IndexedDB não foram tocados.
3. **Sondas independentes**, temporárias e removidas no fim:
   - Vitest com os 7 cenários de perfil pedidos e variações;
   - concorrência real com operações intercaladas, sem `await` entre elas, sobre o mesmo banco IndexedDB (`fake-indexeddb`): exclusão de partida, troca de lado e limpeza de órfãs contra `recordAttempt`, nas duas ordens, de 10 a 20 rodadas cada;
   - Playwright com relógio simulado.
4. **Mutações independentes** (§5), aplicadas só na cópia descartável.

## 3. Resultado dos testes [R]

| Verificação | Resultado |
|---|---|
| Arquivos do motor (`cmp` com `node_modules/stockfish/bin`) | Idênticos |
| `npm run typecheck` | 0 erros |
| `npx vitest run` | **385/385** (24 arquivos) |
| `npm run test:engine` | **22/22** |
| `npm run build` | ok |
| `npm run test:e2e` (porta 4176) | **58/58** |
| CI do PR #8 (run `42429628113`, SHA `64974b0`) | sucesso |

## 4. Cobertura final (valores exatos) [R]

`npm run coverage`, `src/services` e `src/db`:

| Métrica | Valor |
|---|---|
| Statements | **90,25%** (2408/2668) |
| Branches | **83,05%** (1819/2190) |
| Functions | **87,14%** (515/591) |
| Lines | **93,74%** (1994/2127) |

Os valores coincidem com os do relatório da sprint.

## 5. Mutações

**Independentes**, refeitas por esta auditoria:

| ID | Mutação | Resultado |
|---|---|---|
| I1 | `deleteGame` sem apagar as evidências de exercício | Detectada (teste N1) |
| I2 | Limpeza apagando evidências de exercícios existentes | Detectada (teste D-5) |
| I3 | Antiguidade volta a dar "Precisa revisar" | Detectada (3 testes) |
| I4 | Taxa recente exibida sem evidência recente | Detectada |
| I5 | Tendência misturando origens | Detectada (teste N2) |
| I6 | `recordAttempt` sem conferir a existência do exercício | Detectada |
| I7 | `addExercise` sem guarda de cor | Detectada (corrida forçada) |
| I8 | Dia da partida em hora local | Detectada **só porque a máquina está em fuso negativo** (ver AI-4) |
| I9 | Derivação sem o descarte O1 (`analysisRunner.ts:140`), contra o teste da Ópera | **Sobreviveu** (ver AI-3) |
| I9b | A mesma mutação, contra a suíte com motor roteirizado | Detectada (teste O1 de `user-color`) |
| I10 | `acceptsPlayedMove` sem comparar profundidades, contra o teste da Ópera | Detectada |

**Relatadas pela sprint:** as 16 mutações de `SPRINT4-5-RELATORIO.md` §4 são coerentes com os testes inspecionados. As de E2E (contador por minuto, regra da Evolução) dependem da porta 4176 e do relógio simulado. Dessas, foi validado por esta auditoria o comportamento coberto, e não a mutação em si.

## 6. Achados

### Defeitos reproduzidos

#### AI-1 — A "janela recente" é por quantidade, não por tempo: dados antigos geram "Precisa revisar", taxa recente e tendência (P2)

- **Arquivo:** `src/services/adaptation/skills.ts:224-246`. `recentRate` usa os 8 últimos eventos da série; `previous`, os 8 anteriores; `recentDrop` compara esses 8 com a série inteira. O único limite de tempo é a regra de antiguidade (`stale`, linha 246), que olha só a **última** evidência.
- **Reprodução [R]:**

| Cenário | Estado | Taxa recente | Tendência | Recomendação |
|---|---|---|---|---|
| 24 exercícios de 45 a 60 dias atrás (12 certos, depois 12 errados) + 1 certo ontem | **`needs_review`** | **13%** | **caindo** | **"Revisar: Estratégia (taxa recente 13%…)"** |
| O mesmo com exercícios de 1 ano atrás | `initial` | 13% | caindo | — |
| 60 lances de partidas antigas (40%) + 2 lances recentes certos | `insufficient` | 75% | **subindo** | — |

- **Impacto:** contradiz a decisão D-4 B ("taxa recente e tendência não são calculadas a partir de dados antigos"). Basta **uma** evidência recente para que dados de semanas ou de um ano passem a ser lidos como "recentes".
  - No primeiro caso, a única evidência dos últimos 45 dias é um **acerto**, e mesmo assim o perfil e a recomendação pedem revisão por uma "queda" de mais de 30 dias atrás.
  - No terceiro, a Evolução mostra "Evidências insuficientes" ao lado de "recente 75% · subindo".
- **Correção recomendada:**
  - definir a janela recente por **tempo**: eventos da série nos últimos 30 dias (`STALE_DAYS`), comparados com os 30 dias anteriores ou com o restante da série;
  - exigir uma amostra mínima (por exemplo, ≥ 4 eventos recentes) para mostrar taxa recente, tendência e `recentDrop`;
  - abaixo disso: `recentRate = null`, tendência `unknown` e nenhum "Precisa revisar" por queda.
- **Testes:** os três cenários acima como testes unitários, e um E2E de recomendação.

#### AI-2 — O card do dashboard não acompanha o tempo, ao contrário da barra lateral (P3)

- **Arquivo:** `src/features/dashboard/DashboardPage.tsx:37` (`const now = Date.now()`, calculado só quando o componente renderiza de novo). A barra lateral recalcula a cada minuto (`useMinute`).
- **Reprodução [R]** (Playwright, relógio simulado): um exercício já tentado vence em 2 minutos e o usuário fica **no dashboard**. Depois de 3 minutos, a barra lateral mostra **1** e "Revisões pendentes" mostra **0**. É o caso inverso do C3 que a sprint corrigiu.
- **Impacto:** baixo, mas contraria o critério "dashboard e barra lateral mostram o mesmo número".
- **Correção:** usar `useMinute()` no dashboard (e na Evolução) como dependência do `now`.

#### AI-3 — O teste da Partida da Ópera não cobre o caminho integrado da derivação (P3)

- **Arquivo:** `tests/engine-integration.test.ts:257`. O teste chama `buildExercise`, `withSolutionTree` e `acceptsPlayedMove` diretamente, sem passar por `deriveFromAnalysis`.
- **Evidência [R]:** a mutação I9 (remover o descarte de `analysisRunner.ts:140`) **sobrevive** a esse teste. Ela só é detectada pelo teste roteirizado de `user-color.test.ts` (I9b).
- O relatório da sprint diz que o teste "afirma que a árvore aceita o lance (o exercício é descartado)", mas o descarte em si não é exercitado com o motor real. O passo 3 proposto no planejamento ("resultado integrado") não foi implementado.
- **Correção:** acrescentar ao teste a derivação integrada, com a análise congelada e o motor real, afirmando que não há exercício na meia-jogada 29. Ou ajustar o texto do relatório.

#### AI-4 — O teste do fuso horário só protege quando roda em fuso negativo (P3)

- **Arquivo:** `tests/evidence-dates.test.ts:135`.
- **Evidência [I/R]:** a mutação I8 foi detectada porque a máquina local está em fuso negativo. Num ambiente em UTC, como o runner Linux da CI, `dayKey` (local) e a chave UTC coincidem, e a mutação **passaria**.
- **Correção:** fixar o fuso do teste, por exemplo com `TZ=America/Sao_Paulo` no ambiente do Vitest (`test.env` ou script), ou testar com um fuso explícito via `Intl`.

### Defeitos demonstrados por inspeção

#### AI-5 — "Revisar pendentes (N)" da tela Treinar conta exercícios novos (P3)

- **Arquivo:** `src/features/training/TrainingPage.tsx:79,96`, que usa `srs.dueAt <= now`.
- A barra lateral (`AppShell.tsx:28`), o dashboard (`DashboardPage.tsx:61`), a Evolução (`ProgressPage.tsx:41`), a sessão (`session.ts:76`) e a recomendação (`useTrainingLoop.ts:28`) usam a **mesma função** `isDueReview`. Não existe uma segunda implementação da regra.
- A tela Treinar inclui exercícios novos de propósito (METHODOLOGY §8), mas o rótulo "Revisar pendentes" contradiz o contador "N revisões pendentes" da barra lateral. Com 2 exercícios novos e nenhuma revisão, a barra não mostra nada e o botão diz "Revisar pendentes (2)".
- **Correção:** renomear para "Pendentes (N)" ou "Novos e vencidos (N)".

#### AI-6 — Na Evolução, a faixa da evolução recente não tem rótulo (P3)

- **Arquivo:** `src/features/progress/SkillProfile.tsx:59`, contra a linha 24.
- A linha do diagnóstico histórico tem rótulo. A barra e o "entre X% e Y%" da evolução recente (com decaimento) não têm. Em "Sem evidência recente", a tela mostra lado a lado "entre 7% e 86%" e "Diagnóstico histórico: 41% (21%–62%)" (visto na verificação visual da sprint), e o usuário não sabe qual é qual.
- **Correção:** rotular a primeira como "Evolução recente".

#### AI-7 — Situação desatualizada no relatório da sprint (P3, documentação)

`docs/SPRINT4-5-RELATORIO.md:5` diz "Nada foi commitado, enviado ou aberto como PR". A sprint está em `64974b0`, com o PR #8 aberto.

### Riscos hipotéticos

- **[H] Concorrência real entre navegadores e abas:** as sondas usaram `fake-indexeddb`, que implementa a semântica de transações do IndexedDB, mas não é o motor do navegador. Não há motivo concreto para divergir, porque a proteção é a serialização de transações `rw` com escopo sobreposto, que é parte da especificação.

### Falsos positivos descartados

| Suspeita | Por que foi descartada |
|---|---|
| `TransactionInactiveError` na sonda de troca de lado | Artefato da sonda: ela trocava a conexão global no meio de uma transação aninhada. Com uma conexão, as duas ordens dão resultado consistente (§7, E3) |
| "Revisar pendentes (0)" lido na tela Treinar durante a sonda E4 | A leitura foi feita antes de os dados carregarem. Não foi usada como evidência |
| Contagem de revisão vencida com implementações diferentes | Todas usam `isDueReview`. A tela Treinar é a exceção intencional (AI-5 trata só do rótulo) |

### Débitos conscientemente aceitos (registrados na sprint)

- Uma restauração de backup parcial sem `exercises` tem as evidências de exercício removidas como órfãs.
- O mês do diagnóstico histórico é lido em UTC também para exercícios.
- A queda recente exige mais de 8 evidências do mesmo tipo.
- O teste C1 depende da ordem das leituras.
- Itens no backlog: C2, ESLint, índice para a deduplicação e coordenação entre abas.

## 7. Avaliação por item

### E1 — Exclusão de partida e evidências órfãs: **conforme**

- `deleteGame` (`gamesRepo.ts`) apaga, na mesma transação, tentativas, evidências de exercício (`ref.exerciseId anyOf`), exercícios, evidências de partida, marcações, análise e a partida. Uma falha desfaz tudo.
- `removeOrphanExerciseEvidence`:
  - usa uma transação sobre `exercises` e `skillEvents`;
  - é limitada a `source: 'exercise'` com `exerciseId`;
  - é idempotente;
  - preserva as evidências de partida e de abertura (testes e mutações I1 e I2).
- **Concorrência [R]:**
  - `recordAttempt` contra `deleteGame` intercalados, 20 rodadas nas duas ordens: estado final sempre `{exercícios 0, tentativas 0, evidências 0}`;
  - limpeza de órfãs contra `recordAttempt`: a evidência da tentativa nunca é apagada (`removed: 0`).
- **Backup:** um backup exportado pelo app contém todas as tabelas, então a limpeza não remove nada legítimo. O caso parcial está aceito.
- Uma evidência órfã de partida (`gameId` inexistente) não é limpa pelo D-5, que se limita a exercícios. Nenhum fluxo do app cria esse caso, porque `deleteGame` apaga as evidências por `ref.gameId`.

### E2 — Diagnóstico histórico e evidência recente: **parcialmente conforme (AI-1, AI-6)**

| Cenário | Resultado [R] | Avaliação |
|---|---|---|
| 1. Só partidas antigas | `no_recent`, sem taxa recente nem tendência, histórico 41% com 60 evidências | ✔ |
| 2. Só partidas recentes | `consistent`, taxa recente 50%, estável, histórico igual à média | ✔ |
| 3. Antigas + recentes (2 lances) | `insufficient`, mas "recente 75% · subindo", calculado com lances antigos | ✗ AI-1 |
| 4. Sem evidências | `insufficient`, sem números | ✔ |
| 5. Origens diferentes (antigas + 12 exercícios recentes) | Taxa recente e tendência só de exercícios | ✔ |
| 6. Recentes insuficientes (3 exercícios) | `initial`, tendência `unknown` | ✔ |
| 7. Competência mudou (8 erros há 1 ano, 8 acertos hoje) | `consistent`, subindo, histórico 50% contra recente 82% | ✔ nesse caso. Com 1 evidência recente, a janela por quantidade falha (AI-1) |

- **Consumidores conferidos:**
  - a barra lateral não exibe estados;
  - o dashboard agrupa por estado, com o grupo "Sem evidência recente" e sem número;
  - a Evolução mostra a linha do histórico (AI-6);
  - as recomendações só pedem revisão para `needs_review` e citam `no_recent` como pedido de medição;
  - `targetDifficulty` e a sessão guiada não mudaram.
- **Amostra mínima e pesos:** os limiares de peso efetivo (2, 6 e 10), o 1/k e o teto por partida continuam iguais. "Precisa revisar" continua alcançável para quedas reais do mesmo tipo e para limite superior abaixo de 50%.

### E3 — Integridade das tentativas e concorrência: **conforme**

- `recordAttempt` relê o exercício na transação. Se ele não existe, nada é gravado e o retorno é `removed`. O reagendamento parte do `srs` gravado.
- **Troca de lado contra tentativa, intercaladas** [R], 20 rodadas:
  - tentativa primeiro: exercício mantido, com 1 tentativa e 1 evidência. Ele passa a ser "tentado", e por isso o D3 o preserva;
  - troca primeiro: exercício removido, 0 tentativas e 0 evidências.
  - Em nenhuma ordem o exercício é recriado, há tentativa órfã ou há duplicação.
- A guarda `addExercise(ex, guard)` impede gravar o lado antigo (teste C1 e mutação I7).
- **Repetição de chamadas:** a janela de prática de 10 minutos e a trava `revealedRun` impedem tentativas duplicadas.
- **Recarregar durante a operação:** a transação é atômica.

### E4 — Contadores e revisões vencidas: **conforme na barra lateral e na Evolução, com AI-2 e AI-5**

- Regra única (`isDueReview`) em todas as contagens de revisão.
- A barra lateral acompanha o tempo e as escritas (`useMinute` + `useLiveQuery`).
- **Mudança de dia:** o contador depende só de `dueAt`, e o tique de minuto cobre a virada.
- **Depois de concluir um exercício:** `recordAttempt` escreve em `exercises`, e as consultas reativas recalculam.
- O dashboard não acompanha o tempo sozinho (AI-2).

## 8. Opcionais

| Item | Avaliação |
|---|---|
| **Fuso horário** | `evidenceDayKey` lê evidência de partida no dia UTC e as demais no dia local. As chaves `AAAA-MM-DD` são ordenadas como texto (`.sort()`), o que equivale à ordem cronológica. O valor gravado (`at`) não muda. Correto no Brasil e em fusos positivos (data de calendário). O teste tem a limitação AI-4 |
| **Índices** | `where('source').equals('game')` e `where('gameId').equals(id)` usam índices declarados na v1 (`skillEvents: … source …`, `exercises: … gameId …`). O filtro restante (`sideToMove`) preserva o resultado. Não há migração. As consultas não pioram em nenhum cenário |
| **Partida da Ópera** | 15.Bxd7+ (meia-jogada 29), FEN da posição real da partida (`replayGame` do `OPERA_GAME`). Análise da profundidade 11 congelada, com a classificação `blunder` calculada pelo próprio `reviewMove`. Árvore real na profundidade 16, MultiPV 3, tolerância 5. Detecta regressão em `acceptsPlayedMove` (I10), mas **não** no descarte da derivação (I9, AI-3). Determinismo: a asserção depende de Bxd7+ ser aceito na 16, e ele é o melhor lance com folga de cerca de 400 cp. Passa isolado e dentro da suíte |

## 9. Compatibilidade e preservação dos dados

- **Esquema:** `SCHEMA_VERSIONS` continua `[1, 2]`. `database.ts` não mudou. `HistoricalDiagnosis` e `no_recent` são tipos calculados, que não são gravados.
- **Dados existentes:**
  - evidências de exercícios inexistentes são removidas na abertura (D-5, autorizada);
  - nenhuma evidência de partida ou de abertura é alterada;
  - nenhum exercício ou tentativa existente é apagado pelas mudanças, salvo pelas ações explícitas do usuário (excluir partida, trocar de lado).
- **Local-first:** sem dependências novas, rede, backend, telemetria ou mudança no Stockfish.
- **Complexidade:** proporcional ao problema. As mudanças são localizadas (estimador, repositórios e três componentes), sem novas camadas.

## 10. Veredito final

**APROVADO COM RESSALVAS.**

- **Não há P0 nem P1.**
- **Riscos de integridade:** nenhum. A concorrência foi verificada com operações realmente intercaladas, e as proteções de dados resistem às duas ordens.
- **Há um P2 reproduzido (AI-1):** a evidência recente é medida por quantidade, e não por tempo. Com uma única evidência recente, dados de semanas ou de um ano viram "taxa recente", tendência e até "Precisa revisar", com recomendação de revisão. Isso enfraquece a promessa central da decisão D-4 B.
- **Há seis P3** (AI-2 a AI-7).

### Correções necessárias

1. **AI-1 (P2), antes do merge:** janela recente por tempo (30 dias), com amostra mínima para taxa recente, tendência e queda. Testes com os três cenários reproduzidos.
2. **AI-2 (P3):** dashboard e Evolução recalculando o `now` por minuto (`useMinute`).
3. **AI-3 (P3):** teste da Ópera percorrendo `deriveFromAnalysis`, ou correção do texto do relatório.
4. **AI-4 (P3):** fixar o fuso do teste de datas para que ele também proteja na CI.
5. **AI-5 e AI-6 (P3):** rótulos ("Pendentes (N)" na tela Treinar e "Evolução recente" na Evolução).
6. **AI-7 (P3):** atualizar a situação de `SPRINT4-5-RELATORIO.md`.

## 11. Correções aplicadas depois desta auditoria

O usuário pediu a correção do AI-1 e dos P3. Elas foram feitas na mesma branch, sobre `64974b0`:

| Achado | Correção | Teste |
|---|---|---|
| **AI-1** (P2) | `estimateSkill`: a janela recente é de tempo. Entram só eventos dos últimos 30 dias, no máximo 8 e no mínimo 4 (`MIN_RECENT`). Abaixo disso, a taxa recente é `null`, a tendência é `unknown` e não há queda. A linha de base continua sendo os 8 eventos anteriores | 4 testes: os 3 cenários reproduzidos e um caso de queda real ainda detectada |
| **AI-2** (P3) | Dashboard e Evolução chamam `useMinute()` e renderizam de novo a cada minuto | E2E com relógio simulado: parado no dashboard, o card vai de 0 para 1 |
| **AI-3** (P3) | O teste da Ópera ganhou a derivação integrada (`deriveFromAnalysis` com a análise congelada e o motor real): 0 exercícios | Teste novo com o motor real |
| **AI-4** (P3) | O teste de datas fixa `TZ=America/Sao_Paulo` e confere que o fuso é negativo | Passa em `TZ=UTC` e detecta a mutação nesse fuso |
| **AI-5** (P3) | Botão da tela Treinar: "Pendentes (N)", com explicação no `title` | E2E |
| **AI-6** (P3) | Rótulo "Evolução recente:" na faixa principal da Evolução | E2E |
| **AI-7** (P3) | Situação de `SPRINT4-5-RELATORIO.md` atualizada | — |

**Mutações:** 7, todas detectadas:

- janela por quantidade;
- sem amostra mínima;
- derivação sem o descarte (teste da Ópera);
- dia local rodando em UTC;
- dashboard sem o tique de minuto;
- rótulo antigo da tela Treinar;
- sem o rótulo "Evolução recente".

**Resultados:**

| Verificação | Resultado |
|---|---|
| typecheck | ok |
| Vitest | **391** |
| Motor real | **23** |
| Playwright | **59** |

**Cobertura:** linhas 93,76 · statements 90,27 · branches 83,07 · funções 87,16.
