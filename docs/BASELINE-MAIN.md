# Baseline da `main` — pós-integração da Sprint 4.5

| Campo | Valor |
|---|---|
| Commit de referência | `302f7a9f4c9d202fec99e2fa455e884693a8970b` (`origin/main`, merge do PR #8) |
| Data | 2026-11-08. Atualizada na auditoria pós-Sprint 4.5, porque a versão anterior descrevia `edf4de8` (antes do PR #8) com 370/21/53 testes |
| CI do commit | run `42444231825`, check `verify`: sucesso |
| Auditorias desta base | `SPRINT4-5-AUDITORIA-INDEPENDENTE.md`, `SPRINT4-5-AUDITORIA-FINAL-PRE-MERGE.md` e `POST-SPRINT4-5-AUDITORIA.md` (anteriores: `SPRINT4-3-AUDITORIA-POS-MERGE.md`, `SPRINT4-4-AUDITORIA-POS-MERGE.md`) |

Legenda: **[F]** fato verificado no repositório/GitHub · **[E]** resultado de execução · **[I]** inferência.

## 1. Estado do repositório

- **[F]** Branch padrão: `main`. Nenhum PR aberto.
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

- **[F]** A árvore de cada merge de PR é idêntica à cabeça da branch integrada (sem resolução de conflito oculta).
- **[F]** As branches de origem estão contidas em `origin/main` e foram mantidas.

## 2. Arquitetura

- **Local-first [F]:** sem backend, login, telemetria ou serviços remotos. Não há `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` nem URLs externas em `src/` ou `index.html`; o E2E `mvp.spec.ts` falha se houver requisição externa.
- **Motor [F]:** Stockfish 19 lite single-thread (WASM) em Web Worker (`src/services/engine/workerTransport.ts`), servido de `public/engine/` (copiado por `scripts/copy-engine.mjs` no `postinstall`).
- **Persistência [F]:** IndexedDB via Dexie, banco `chessquest`, esquema **v2** (inalterado desde `9c964de`), com histórico explícito em `SCHEMA_VERSIONS` (`[1, 2]`, Sprint 4.3). O plano da sessão guiada fica no `localStorage` (`chessquest.session.v1`), expira no fim do dia e não entra no backup.
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
| Configurações, backup e restauração | `/settings` | `mvp.spec` |

## 4. Versões relevantes (instaladas por `npm ci`)

Node 24.16.0 · npm 11.13.0 · stockfish 19.0.1 · dexie 4.4.7 · react 19.3.1 · react-router-dom 7.18.5 · chess.js 1.4.0 · vite 8.3.5 (exige Node `^20.19.0 || >=22.12.0`) · vitest 5.1.0 · typescript 7.0.2 · @playwright/test 1.64.1.

Arquivos do motor (SHA-256, idênticos aos de `node_modules/stockfish/bin`):

- `stockfish-19-lite-single.js` — `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a`
- `stockfish-19-lite-single.wasm` — `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de`

## 5. Resultado dos testes [E]

Executados na `main` em `302f7a9`, com `npm ci` (auditoria pós-Sprint 4.5). A CI do push no mesmo SHA deu o mesmo resultado.

| Verificação | Comando | Resultado |
|---|---|---|
| Arquivos do motor | SHA-256 contra `node_modules/stockfish/bin` | idênticos |
| Typecheck | `npm run typecheck` | ok |
| Vitest | `npx vitest run` (equivale a `npm test`) | **401/401** (24 arquivos) |
| Stockfish real isolado | `npx vitest run tests/engine-integration.test.ts` | **23/23** (também passa na suíte completa) |
| Cobertura (`src/services`, `src/db`) | `npm run coverage` | linhas 93,77% · statements 90,30% · branches 83,09% · funções 87,22% |
| Build | `npm run build` | ok |
| Playwright | `npx playwright test` (porta dedicada 4176) | **59/59** |

Evolução: 322 → 370 → 401 no Vitest, 47 → 53 → 59 no Playwright, motor real 21 → 23.

## 6. Persistência

- **[F]** Gravações em transação: importação com deduplicação por `&hash` (`gamesRepo.importPgn`), `recordAttempt` (tentativa + revisão + evidência), exclusões em cascata, restauração de backup (tudo ou nada), troca de cor com marca de derivação (`saveColorMarkingPending`), redatação de evidências.
- **[F]** Histórico de esquema explícito (`SCHEMA_VERSIONS = [1, 2]`); a única migração (v1→v2) converte exercícios antigos em árvore de solução, com testes de upgrade v1→v2→v3 em `tests/persistence.test.ts`.
- **[F]** Na abertura do app: análises interrompidas viram `paused`, evidências de partida são datadas pela partida e derivações `'pending'` são refeitas.
- **[F]** Backup: valida formato, versão, chaves e FENs antes de gravar; recusa versões futuras; um backup parcial substitui apenas as tabelas que contém.

## 7. Débitos conhecidos

| # | Item | Situação em `302f7a9` |
|---|---|---|
| 1 | Contador "Revisões pendentes" limitado a 5 posições marcadas | **Resolvido** (Sprint 4.3) |
| 2 | Exercício usa limites de classificação atuais; análises usaram os da época | Aberto (postergar: muda o formato dos dados) |
| 3 | Em 768 px as ações ficam abaixo da dobra | Aberto (corrigir se tablet for alvo) |
| 4 | Mate equivalente pelo caminho `measureAfter` recebe "Excelente" | Aberto (manter/postergar) |
| 5 | Versionamento Dexie podia apagar tabelas | **Resolvido** (Sprint 4.3, `SCHEMA_VERSIONS`) |
| 6 | E2E local reaproveitava servidor na 4173 | **Resolvido** (Sprint 4.3: porta 4176, `reuseExistingServer: false`) |
| 7 | Sem ESLint | Aberto (dependência nova: só com decisão do usuário) |

Débitos e achados posteriores, com priorização, estão em `POST-SPRINT4-5-AUDITORIA.md` §5–6. Resumo: FA-2 a FA-6 (P3) continuam abertos; há um P2 novo de desempenho (PA-1); não há P0 nem P1.

## 8. Ressalvas da baseline

1. **[F]** Os itens 2, 3, 4 e 7 continuam abertos e estão no backlog.
2. **[F]** Os achados da auditoria de planejamento da Sprint 4.5 foram tratados e integrados no PR #8 (`SPRINT4-5-RELATORIO.md`), junto com as correções AI-1 a AI-7, FA-1 e FA-7.

## 9. Limitações conhecidas

As do README continuam válidas: motor *lite*; SEE só na casa da troca; promoção sempre para dama; ramificação limitada da árvore de solução; fase da partida por heurística; mesmo PGN com cabeçalhos diferentes não é duplicata; sem partidas contra o motor. Acrescenta-se: o plano da sessão guiada não faz parte do backup.

## 10. Procedimento de validação para futuras sprints

1. Partir de `origin/main` atualizada (`git switch main && git pull --ff-only`) e anotar o SHA.
2. O E2E usa a porta dedicada 4176 e não reaproveita servidor; os dados reais ficam em `localhost:5173` e não devem ser usados em testes.
3. `npm ci` — sem atualizar dependências por conveniência.
4. Conferir os arquivos do motor (`public/engine/*.js|.wasm` não vazios e idênticos aos de `node_modules/stockfish/bin`).
5. `npm run typecheck`, `npm test`, `npm run test:engine` (isolado e dentro da suíte, por causa do estado de hash do motor), `npm run coverage`, `npm run build`, `npm run test:e2e`.
6. Comparar com esta baseline: 401 Vitest, 23 com motor real, 59 Playwright, cobertura ≥ 80% em todas as métricas. Toda redução precisa de justificativa.
7. Mudança de schema: nunca editar um bloco `version()` existente; adicionar teste de upgrade a partir da versão anterior com dados reais de fixture; nunca rodar em banco real.
8. Verificar ausência de chamadas de rede novas (`fetch`, XHR, WebSocket, `sendBeacon`, URLs).
9. Teste em celular físico numa origem separada (configuração `chessquest-phone`, porta 4180), sem usar os dados reais de `localhost:5173`.
10. CI verde no commit final do PR e integração por merge commit.
