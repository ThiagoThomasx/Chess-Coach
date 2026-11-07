# Baseline da `main` — pós-integração das Sprints 3, 3.1, 4.1 e 4.2

| Campo | Valor |
|---|---|
| Commit auditado | `d49f7978522a712bffe1c2f5934b24815b4d0782` (`origin/main`, merge do PR #3) |
| Data da auditoria | 2026-11-07 |
| CI do commit | run `42339841429`, check `verify`: sucesso |
| Veredito | **Aprovada com ressalvas** (§8) |

Legenda: **[F]** fato verificado no repositório/GitHub · **[E]** resultado de execução · **[I]** inferência.

## 1. Estado do repositório

- **[F]** Branch padrão: `main`. Nenhum PR aberto.
- **[F]** Integração por merge commit, em ordem:

| PR | Branch | Merge commit | Integrado (UTC) | CI no push |
|---|---|---|---|---|
| #1 | `fix/sprint3-phase1` | `eb03c6d` | 2026-11-07 04:30 | sucesso |
| #2 | `feat/sprint4-1-adaptive-training` | `b2f2cf3` | 2026-11-07 04:39 | sucesso |
| #3 | `feat/sprint4-2-clarity-badges-pgn-paste` | `d49f797` | 2026-11-07 04:45 | sucesso |

- **[F]** A árvore de cada merge de PR é idêntica à cabeça da branch integrada (sem resolução de conflito oculta).
- **[F]** As três branches de origem estão contidas em `origin/main` e foram mantidas.

## 2. Arquitetura

- **Local-first [F]:** sem backend, login, telemetria ou serviços remotos. Não há `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` nem URLs externas em `src/` ou `index.html`; o E2E `mvp.spec.ts` falha se houver requisição externa.
- **Motor [F]:** Stockfish 19 lite single-thread (WASM) em Web Worker (`src/services/engine/workerTransport.ts`), servido de `public/engine/` (copiado por `scripts/copy-engine.mjs` no `postinstall`).
- **Persistência [F]:** IndexedDB via Dexie, banco `chessquest`, esquema **v2** (inalterado desde `9c964de`). O plano da sessão guiada fica no `localStorage` (`chessquest.session.v1`), expira no fim do dia e não entra no backup.
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

Executados numa worktree isolada em `d49f797`, com `npm ci`.

| Verificação | Comando | Resultado |
|---|---|---|
| Instalação | `npm ci` | ok, 0 vulnerabilidades |
| Arquivos do motor | `test -s` + `sha256sum` + `cmp` | ok |
| Typecheck | `npm run typecheck` | ok |
| Vitest | `npx vitest run` (equivale a `npm test`) | **322/322** (21 arquivos) |
| Stockfish real isolado | `npx vitest run tests/engine-integration` (equivale a `npm run test:engine`) | **21/21** (também passa na suíte completa) |
| Cobertura (`src/services`, `src/db`) | `npm run coverage` | linhas 90,97% · statements 87,14% · branches 80,15% · funções 82,87% |
| Build | `npm run build` | ok (só o final da saída foi inspecionado; maior chunk 337,55 kB, abaixo do limite de 900 kB) |
| Playwright | `CI=true npx playwright test` com config temporária que só troca a porta para 4175 (a 4173 estava ocupada por um preview antigo) | **47/47** |

Diferença em relação à baseline anterior (`acdb610`, Sprint 4.2): nenhuma (322 / 21 / 47).

## 6. Persistência

- **[F]** Gravações em transação: importação com deduplicação por `&hash` (`gamesRepo.importPgn`), `recordAttempt` (tentativa + revisão + evidência), exclusões em cascata, restauração de backup (tudo ou nada).
- **[F]** Migração única: v1→v2 converte exercícios antigos em árvore de solução (`database.ts`), com teste em `tests/persistence.test.ts`.
- **[F]** Backup: valida formato, versão, chaves e FENs antes de gravar; recusa versões futuras; um backup parcial substitui apenas as tabelas que contém.
- **[E] Risco latente:** ver §8, item 1.

## 7. Débitos conhecidos

| # | Item | Local | Gravidade | Recomendação |
|---|---|---|---|---|
| 1 | Contador "Revisões pendentes" limitado a 5 posições marcadas | `DashboardPage.tsx:70,138` | Baixa | Corrigir (trivial; `pendingBookmarkCount` já existe) |
| 2 | Exercício usa limites de classificação atuais; análises usaram os da época | `useExerciseSession.ts:59`, `gameAnalyzer.ts:84` | Baixa | Postergar (muda o formato dos dados) |
| 3 | Em 768 px as ações ficam abaixo da dobra | `features.css:122/203/448` | Baixa a média | Corrigir se tablet for alvo |
| 4 | Mate equivalente pelo caminho `measureAfter` recebe "Excelente" | `sequence.ts:276`, `moveBadge.ts:50` | Baixa | Manter / postergar |
| 5 | Versionamento Dexie: subir `SCHEMA_VERSION` seguindo o `ARCHITECTURE.md` apaga tabelas | `src/db/database.ts`, `docs/ARCHITECTURE.md` | **Alta (latente)** | Corrigir antes de qualquer mudança de schema |
| 6 | E2E local reaproveita servidor existente na 4173 (`reuseExistingServer: !CI`) | `playwright.config.ts` | Média (processo) | Isolar porta ou desativar reaproveitamento |
| 7 | Sem ESLint | — | Baixa | Já documentado |

## 8. Ressalvas da baseline

1. **[E] Versionamento Dexie.** O schema completo é declarado em `version(SCHEMA_VERSION)` e a migração em `version(2).stores({})`. Numa simulação com banco temporário (`fake-indexeddb`), subir `SCHEMA_VERSION` para 3 fez bancos v1 e v2 abrirem com `games` e `exercises` **vazios**. Com uma declaração explícita por versão (`version(1)`, `version(2)`, `version(3)`), os dados foram preservados. O código atual (v2) não perde dados.
2. **[F] Documentação desatualizada:** o README não cita sessão guiada, PGN colado, selos, backup parcial nem os relatórios 4.x; `ARCHITECTURE.md` traz a instrução de versionamento acima; `SPRINT4-2-RELATORIO.md` §10.7 ainda descreve a integração como pendente (este documento registra a conclusão).
3. **[F] Ambiente local:** no momento da auditoria, a `main` local estava 25 commits atrás de `origin/main` e havia um `vite preview` antigo ocupando a porta 4173.

## 9. Limitações conhecidas

As do README continuam válidas: motor *lite*; SEE só na casa da troca; promoção sempre para dama; ramificação limitada da árvore de solução; fase da partida por heurística; mesmo PGN com cabeçalhos diferentes não é duplicata; sem partidas contra o motor. Acrescenta-se: o plano da sessão guiada não faz parte do backup.

## 10. Procedimento de validação para futuras sprints

1. Partir de `origin/main` atualizada (`git switch main && git pull --ff-only`) e anotar o SHA.
2. Garantir que nenhum servidor antigo ocupa 4173/5173 (ou rodar o E2E numa porta isolada).
3. `npm ci` — sem atualizar dependências por conveniência.
4. Conferir os arquivos do motor (`public/engine/*.js|.wasm` não vazios e idênticos aos de `node_modules/stockfish/bin`).
5. `npm run typecheck`, `npm test`, `npm run test:engine` (isolado e dentro da suíte, por causa do estado de hash do motor), `npm run coverage`, `npm run build`, `npm run test:e2e`.
6. Comparar com esta baseline: 322 Vitest, 21 com motor real, 47 Playwright, cobertura ≥ 80% em todas as métricas. Toda redução precisa de justificativa.
7. Mudança de schema: nunca editar um bloco `version()` existente; adicionar teste de upgrade a partir da versão anterior com dados reais de fixture; nunca rodar em banco real.
8. Verificar ausência de chamadas de rede novas (`fetch`, XHR, WebSocket, `sendBeacon`, URLs).
9. Teste em celular físico numa origem separada (configuração `chessquest-phone`, porta 4180), sem usar os dados reais de `localhost:5173`.
10. CI verde no commit final do PR e integração por merge commit.
