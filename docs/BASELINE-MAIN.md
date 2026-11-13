# Baseline da `main` — pós-integração da Sprint 4.6

| Campo | Valor |
|---|---|
| Commit de referência | `83d29fc49438f26c64f8f33d4686c2efb3e6815b` (`origin/main`, merge do PR #9) |
| Data | 2026-11-13, validação pós-merge da Sprint 4.6. A versão anterior descrevia `302f7a9`, merge do PR #8 |
| CI do commit | run `43451596199`, check `verify`: sucesso. No PR, o run `43450351053` também passou |
| Auditorias desta base | `SPRINT4-6-AUDITORIA-CONSOLIDADA.md` e `SPRINT4-6-PREPARACAO-INTEGRACAO.md`, com os relatórios de etapa `SPRINT4-6-PA1-B3-RELATORIO.md` e `SPRINT4-6-B2-RELATORIO.md`. Anteriores: `POST-SPRINT4-5-AUDITORIA.md`, `SPRINT4-5-AUDITORIA-INDEPENDENTE.md`, `SPRINT4-5-AUDITORIA-FINAL-PRE-MERGE.md`, `SPRINT4-3-AUDITORIA-POS-MERGE.md` e `SPRINT4-4-AUDITORIA-POS-MERGE.md` |

Legenda: **[F]** fato verificado no repositório/GitHub · **[E]** resultado de execução · **[I]** inferência.

## 1. Estado do repositório

- **[F]** Branch padrão: `main`. Nenhum PR aberto depois do merge do PR #9.
- **[F]** Integração por merge commit, em ordem:

| PR | Branch | Merge commit | Integrado (UTC) | CI no push |
|---|---|---|---|---|
| #1 | `fix/sprint3-phase1` | `eb03c6d` | 2026-11-07 04:30 | sucesso |
| #2 | `feat/sprint4-1-adaptive-training` | `b2f2cf3` | 2026-11-07 04:39 | sucesso |
| #3 | `feat/sprint4-2-clarity-badges-pgn-paste` | `d49f797` | 2026-11-07 04:45 | sucesso |
| #4 | `docs/baseline-main` | `4445f72` | 2026-11-07 05:18 | sucesso |
| #5 | `feat/sprint4-3-reliable-training-loop` | `e63c59b` | 2026-11-07 15:01 | sucesso |
| #6 | `feat/sprint4-4-truthful-evidence` | `9e1243d` | 2026-11-07 16:45 | sucesso |
| #7 | `fix/sprint4-4-audit-p2` | `edf4de8` | 2026-11-07 17:33 | sucesso |
| #8 | `feat/sprint4-5-consistent-profile` | `302f7a9` | 2026-11-08 03:48 | sucesso |
| #9 | `feat/sprint4-6-understand-mistakes` | `83d29fc` | 2026-11-13 15:20 | sucesso |

- **[F]** A árvore de cada merge de PR é idêntica à cabeça da branch integrada (sem resolução de conflito oculta).
- **[F]** As branches de origem estão contidas em `origin/main` e foram mantidas.
- **[F]** O PR #9 entrou com três commits, preservados pelo merge commit:
  - `5aa73dd` docs (baseline e auditoria pós-4.5);
  - `2f4dea0` feat (Sprint 4.6);
  - `2edc35c` test (correção de um E2E intermitente).

  A árvore de `83d29fc` é idêntica à de `2edc35c`.

## 2. Arquitetura

- **Local-first [F]:** sem backend, login, telemetria ou serviços remotos. Não há `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` nem URLs externas em `src/` ou `index.html`; o E2E `mvp.spec.ts` falha se houver requisição externa.
- **Motor [F]:** Stockfish 19 lite single-thread (WASM) em Web Worker (`src/services/engine/workerTransport.ts`), servido de `public/engine/` (copiado por `scripts/copy-engine.mjs` no `postinstall`).
- **Persistência [F]:** IndexedDB via Dexie, banco `chessquest`, esquema **v2** (inalterado desde `9c964de`; a Sprint 4.6 não mudou o schema), com histórico explícito em `SCHEMA_VERSIONS` (`[1, 2]`, Sprint 4.3). O plano da sessão guiada fica no `localStorage` (`chessquest.session.v1`), expira no fim do dia e não entra no backup.
- **Análise em andamento [F] (Sprint 4.6, PA-1 e auditoria):**
  - o progresso é gravado no máximo a cada 2 s (`progressSaver`), e o estado final é sempre gravado;
  - toda gravação confere, na mesma transação, se a partida existe (`saveAnalysisIfGameExists`);
  - uma falha de gravação termina a análise como `error`;
  - a tela combina o registro gravado com os eventos do runner (`useLiveAnalysis`);
  - as listas leem só o índice `status` ou só as análises concluídas.
- **Rotas [F]** (`src/app/App.tsx`, HashRouter + `lazy()`): `/`, `/games`, `/analysis/:gameId`, `/train`, `/train/session`, `/train/:exerciseId`, `/openings`, `/progress`, `/settings`, `*`.

## 3. Funcionalidades integradas

| Funcionalidade | Entrada | Cobertura E2E |
|---|---|---|
| Importação de PGN por arquivo e por texto colado, com deduplicação | `/games` | `clarity.spec`, `mvp.spec` |
| Análise com Stockfish, classificação e explicações | `/analysis/:gameId` | `mvp.spec`, `clarity.spec` |
| Selos de qualidade dos lances (análise e exercício) | análise / exercício | `clarity.spec` |
| Exercícios de lance único e de sequência, solver | `/train`, `/train/:id` | `mvp.spec`, `sequence.spec` |
| Perfil adaptativo, recomendações, revisões espaçadas | `/`, `/progress` | `mvp.spec`, `session.spec` |
| Sessão guiada com retomada | `/train/session` | `session.spec` |
| Aberturas e repertório | `/openings` | `mvp.spec`, `mobile.spec` |
| Dashboard e estatísticas | `/` | `clarity.spec` |
| Refutação explicada no exercício: consequência, linha e reprodução no tabuleiro (Sprint 4.6, B1) | `/train/:id` | `sequence.spec`, `audit-sprint4-6.spec` |
| "Minhas partidas estão melhorando?": erros graves por partida (Sprint 4.6, B3) | `/progress` | `progress-trend.spec` |
| Lance da análise ↔ exercício derivado: selo "Ex.", "Abrir exercício", origem do erro com link de volta (Sprint 4.6, B2) | análise / exercício | `exercise-origin.spec`, `audit-sprint4-6.spec` |
| Datas do PGN em UTC e instantes no calendário local; contadores que acompanham o relógio (Sprint 4.6, FA-3/FA-4) | Evolução, Treinar, sessão | `consistency.spec` |
| Configurações, backup e restauração | `/settings` | `mvp.spec` |

## 4. Versões relevantes (instaladas por `npm ci`)

Node 24.16.0 · npm 11.13.0 · stockfish 19.0.1 · dexie 4.4.7 · react 19.3.1 · react-router-dom 7.18.5 · chess.js 1.4.0 · vite 8.3.5 (exige Node `^20.19.0 || >=22.12.0`) · vitest 5.1.0 · typescript 7.0.2 · @playwright/test 1.64.1.

Arquivos do motor (SHA-256, idênticos aos de `node_modules/stockfish/bin`):

- `stockfish-19-lite-single.js` — `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a`
- `stockfish-19-lite-single.wasm` — `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de`

## 5. Resultado dos testes [E]

Executados na `main` local em `83d29fc` (sincronizada com `origin/main`), com `npm ci` (0 vulnerabilidades), em 2026-11-13. A CI do push no mesmo SHA também passou.

| Verificação | Comando | Resultado |
|---|---|---|
| Arquivos do motor | SHA-256 contra `node_modules/stockfish/bin` | idênticos |
| Typecheck | `npm run typecheck` | ok |
| Vitest | `npm test` | **476/476** (30 arquivos) |
| Stockfish real isolado | `npm run test:engine` | **24/24** (também passa na suíte completa) |
| Cobertura (`src/services`, `src/db`) | `npm run coverage` | linhas 94,70% · statements 91,56% · branches 84,21% · funções 89,49% |
| Build | `npm run build` | ok |
| Playwright | `npm run test:e2e` (porta dedicada 4176) | **84/84** (11 arquivos) |

Evolução:
- Vitest: 322 → 370 → 401 → 476;
- Playwright: 47 → 53 → 59 → 84;
- motor real: 21 → 23 → 24.

## 6. Persistência

- **[F]** Gravações em transação: importação com deduplicação por `&hash` (`gamesRepo.importPgn`), `recordAttempt` (tentativa + revisão + evidência), exclusões em cascata, restauração de backup (tudo ou nada), troca de cor com marca de derivação (`saveColorMarkingPending`), redatação de evidências.
- **[F]** Histórico de esquema explícito (`SCHEMA_VERSIONS = [1, 2]`); a única migração (v1→v2) converte exercícios antigos em árvore de solução, com testes de upgrade v1→v2→v3 em `tests/persistence.test.ts`.
- **[F]** Na abertura do app: análises interrompidas viram `paused`, evidências de partida são datadas pela partida, evidências de exercícios inexistentes são removidas e derivações `'pending'` são refeitas.
- **[F]** A exclusão de uma partida durante a análise interrompe a execução, e a análise não é recriada (Sprint 4.6, AC-1).
- **[F]** Backup: valida formato, versão, chaves e FENs antes de gravar; recusa versões futuras; um backup parcial substitui apenas as tabelas que contém.

## 7. Débitos conhecidos

| # | Item | Situação em `83d29fc` |
|---|---|---|
| 1 | Contador "Revisões pendentes" limitado a 5 posições marcadas | **Resolvido** (Sprint 4.3) |
| 2 | Exercício usa limites de classificação atuais; análises usaram os da época | Aberto (postergar: muda o formato dos dados) |
| 3 | Em 768 px as ações do exercício ficam abaixo da dobra | Aberto (corrigir se tablet for alvo) |
| 4 | Mate equivalente pelo caminho `measureAfter` recebe "Excelente" | Aberto (manter/postergar) |
| 5 | Versionamento Dexie podia apagar tabelas | **Resolvido** (Sprint 4.3, `SCHEMA_VERSIONS`) |
| 6 | E2E local reaproveitava servidor na 4173 | **Resolvido** (Sprint 4.3: porta 4176, `reuseExistingServer: false`) |
| 7 | Sem ESLint | Aberto (dependência nova: só com decisão do usuário) |

**Resolvidos na Sprint 4.6:**
- PA-1 (P2);
- FA-3, FA-4 e FA-5 na parte do solucionador;
- PX-1 (B1), PX-3 (B2), PX-4 e PX-5 (B3);
- achados AC-1 a AC-8 da auditoria consolidada.

**Continuam abertos** (`POST-SPRINT4-5-AUDITORIA.md` §4–5 e `SPRINT4-6-AUDITORIA-CONSOLIDADA.md` §11–12):

| Item | Situação |
|---|---|
| FA-2: série de comparação do perfil escolhida em todo o histórico | Aberto (P3, postergado) |
| FA-6: concorrência entre abas testada só em ordem sequencial | Aberto (dívida de teste). Duas abas analisando a mesma partida: a última gravação prevalece |
| FA-5: teste da inicialização em etapas | Aberto |
| PX-2: erro sem motivo tático verificado mostra só a avaliação | Aberto |
| PX-6: três contagens de "pendente" com regras diferentes | Aberto |
| AC-10: instante real exatamente às 00:00:00.000 UTC lido como data PGN | Aceito; corrigir exige mudança de schema |
| AC-11: indicador B3 sem teste estatístico; não mede força enxadrística | Aceito e documentado (METHODOLOGY) |
| Falha de gravação persistente (disco cheio): o estado `error` pode não ser gravado | Aceito; a análise volta como `paused` na próxima abertura |
| Esperas fixas em alguns testes (500 ms em duas asserções negativas do E2E da auditoria; 30 ms em `analysis-progress.test.ts`) | Aberto (LOW) |
| Voltar de um exercício para a análise reabre a partida na posição inicial (o lance selecionado não fica na URL) | Comportamento anterior; mudar seria decisão de produto |

Não há P0 nem P1.

## 8. Ressalvas da baseline

1. **[F]** Os itens 2, 3, 4 e 7 continuam abertos e estão no backlog.
2. **[F]** Os achados da auditoria de planejamento da Sprint 4.5 foram tratados e integrados no PR #8 (`SPRINT4-5-RELATORIO.md`), junto com as correções AI-1 a AI-7, FA-1 e FA-7.
3. **[F]** A Sprint 4.6 foi aprovada com ressalvas na auditoria consolidada: sem achado CRITICAL, HIGH ou MEDIUM pendente. As ressalvas são os itens abertos acima. Na validação final antes do PR, um E2E da B2 se mostrou intermitente por defeito do próprio teste; foi corrigido no commit `2edc35c`.

## 9. Limitações conhecidas

As do README continuam válidas: motor *lite*; SEE só na casa da troca; promoção sempre para dama; ramificação limitada da árvore de solução; fase da partida por heurística; mesmo PGN com cabeçalhos diferentes não é duplicata; sem partidas contra o motor. Acrescenta-se: o plano da sessão guiada não faz parte do backup.

## 10. Procedimento de validação para futuras sprints

1. Partir de `origin/main` atualizada (`git switch main && git pull --ff-only`) e anotar o SHA.
2. O E2E usa a porta dedicada 4176 e não reaproveita servidor; os dados reais ficam em `localhost:5173` e não devem ser usados em testes.
3. `npm ci` — sem atualizar dependências por conveniência.
4. Conferir os arquivos do motor (`public/engine/*.js|.wasm` não vazios e idênticos aos de `node_modules/stockfish/bin`).
5. `npm run typecheck`, `npm test`, `npm run test:engine` (isolado e dentro da suíte, por causa do estado de hash do motor), `npm run coverage`, `npm run build`, `npm run test:e2e`.
6. Comparar com esta baseline: 476 Vitest, 24 com motor real, 84 Playwright, cobertura ≥ 80% em todas as métricas. Toda redução precisa de justificativa.
7. Mudança de schema: nunca editar um bloco `version()` existente; adicionar teste de upgrade a partir da versão anterior com dados reais de fixture; nunca rodar em banco real.
8. Verificar ausência de chamadas de rede novas (`fetch`, XHR, WebSocket, `sendBeacon`, URLs).
9. Teste em celular físico numa origem separada (configuração `chessquest-phone`, porta 4180), sem usar os dados reais de `localhost:5173`.
10. CI verde no commit final do PR e integração por merge commit.
