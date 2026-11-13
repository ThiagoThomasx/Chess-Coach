# Baseline da `main` — pós-integração da Sprint 4.7

| Campo | Valor |
|---|---|
| Commit de referência | `025e3da253f7d071549d32eb0ee072a960d45223` (`origin/main`, merge do PR #10) |
| Data | 2026-11-13, validação pós-merge da Sprint 4.7. A versão anterior descrevia `83d29fc`, merge do PR #9 |
| CI do commit | run `43476702612` (push na `main`), job `verify`: sucesso. No PR, os runs `43472043187` (`3e43621`) e `43475760043` (`d7c64aa`) também passaram |
| Relatório desta base | `SPRINT4-7-RELATORIO.md` (inclui as três revisões independentes e o fechamento das lacunas do PR #10). Anteriores: `SPRINT4-6-AUDITORIA-CONSOLIDADA.md`, `SPRINT4-6-PREPARACAO-INTEGRACAO.md`, `SPRINT4-6-PA1-B3-RELATORIO.md`, `SPRINT4-6-B2-RELATORIO.md`, `POST-SPRINT4-5-AUDITORIA.md`, `SPRINT4-5-AUDITORIA-INDEPENDENTE.md`, `SPRINT4-5-AUDITORIA-FINAL-PRE-MERGE.md`, `SPRINT4-3-AUDITORIA-POS-MERGE.md` e `SPRINT4-4-AUDITORIA-POS-MERGE.md` |

Legenda: **[F]** fato verificado no repositório/GitHub · **[E]** resultado de execução · **[I]** inferência.

## 1. Estado do repositório

- **[F]** Branch padrão: `main`. Nenhum PR aberto depois do merge do PR #10.
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
| #10 | `feat/sprint4-7-honest-diagnosis` | `025e3da` | 2026-11-13 17:50 | sucesso (run `43476702612`) |

- **[F]** A árvore de cada merge de PR é idêntica à cabeça da branch integrada (sem resolução de conflito oculta). Para o PR #10: `git diff d7c64aa 025e3da` é vazio.
- **[F]** As branches de origem estão contidas em `origin/main` e foram mantidas, inclusive `feat/sprint4-7-honest-diagnosis` (local e remota em `d7c64aa`).
- **[F]** Entre o merge do PR #9 e o PR #10, a `main` recebeu `5701b4b` (docs: baseline pós-4.6) diretamente.
- **[F]** O PR #10 entrou com dois commits, preservados pelo merge commit:
  - `3e43621` feat (Sprint 4.7: PD-1, PD-2, PD-3 e ferramenta de medição);
  - `d7c64aa` test (fechamento das lacunas de teste apontadas na revisão do PR).

## 2. Arquitetura

- **Local-first [F]:** sem backend, login, telemetria ou serviços remotos. Não há `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` nem URLs externas em `src/` ou `index.html`; o E2E `mvp.spec.ts` falha se houver requisição externa. A Sprint 4.7 não acrescentou chamadas de rede.
- **Motor [F]:** Stockfish 19 lite single-thread (WASM) em Web Worker (`src/services/engine/workerTransport.ts`), servido de `public/engine/` (copiado por `scripts/copy-engine.mjs` no `postinstall`). Nos testes em Node, o transporte do motor fica em `tests/support/nodeEngine.ts` (extraído de `engine-integration.test.ts` na Sprint 4.7, sem mudança de comportamento).
- **Persistência [F]:** IndexedDB via Dexie, banco `chessquest`, esquema **v2** (inalterado desde `9c964de`; as Sprints 4.6 e 4.7 não mudaram o schema), com histórico explícito em `SCHEMA_VERSIONS` (`[1, 2]`, Sprint 4.3). O plano da sessão guiada fica no `localStorage` (`chessquest.session.v1`), expira no fim do dia e não entra no backup.
- **Análise em andamento [F] (Sprint 4.6, PA-1 e auditoria):**
  - o progresso é gravado no máximo a cada 2 s (`progressSaver`), e o estado final é sempre gravado;
  - toda gravação confere, na mesma transação, se a partida existe (`saveAnalysisIfGameExists`);
  - uma falha de gravação termina a análise como `error`;
  - a tela combina o registro gravado com os eventos do runner (`useLiveAnalysis`);
  - as listas leem só o índice `status` ou só as análises concluídas.
- **Três noções de erro [F] (Sprint 4.7, PD-2; `docs/METHODOLOGY.md`, "Três noções de erro"):**
  - **erro técnico**: a classificação do motor, inalterada (análise, selos, perfil, padrões recorrentes);
  - **erro sério**: erro ou erro grave do usuário, exceto com expectativa ≥ 80% depois do lance; vale só no indicador "Minhas partidas estão melhorando?";
  - **elegível para treino**: `noErrorToTrain`, regra única da derivação automática e da criação manual; um lance que manteve a vantagem decisiva não gera exercício de conversão.
  - A faixa decisiva é a constante única `DECISIVE_WIN_PERCENT = 80`.
- **Rotas [F]** (`src/app/App.tsx`, HashRouter + `lazy()`): `/`, `/games`, `/analysis/:gameId`, `/train`, `/train/session`, `/train/:exerciseId`, `/openings`, `/progress`, `/settings`, `*`. A tela Treinar aceita `?theme=…&side=own|opponent` (Sprint 4.7, PD-3).

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
| "Minhas partidas estão melhorando?": erros sérios por partida (Sprint 4.6, B3; regra dos 80% e novo rótulo na Sprint 4.7) | `/progress` | `progress-trend.spec` |
| Lance da análise ↔ exercício derivado: selo "Ex.", "Abrir exercício", origem do erro com link de volta (Sprint 4.6, B2) | análise / exercício | `exercise-origin.spec`, `audit-sprint4-6.spec` |
| Datas do PGN em UTC e instantes no calendário local; contadores que acompanham o relógio (Sprint 4.6, FA-3/FA-4) | Evolução, Treinar, sessão | `consistency.spec` |
| "Cálculo de variantes" medido só por exercícios; evidências antigas de partida ignoradas (Sprint 4.7, PD-1) | `/progress`, recomendações | — (unitário: `skills.test.ts`) |
| Conversão aceita lances que mantêm a vantagem decisiva; criação manual recusa conversão de lance que já a manteve (Sprint 4.7, PD-2) | `/train/:id`, análise | `honest-diagnosis.spec` |
| "Treinar este tema" respeita o lado do motivo (`side=own|opponent`) e o filtro mostra o lado ativo (Sprint 4.7, PD-3) | `/train` | `honest-diagnosis.spec` |
| Configurações, backup e restauração | `/settings` | `mvp.spec` |

Ferramenta de desenvolvimento (não empacotada no app): `npm run measure:pedagogy` (Sprint 4.7) analisa um PGN local com o motor real e informa distribuição de classes, explicações verificadas, exercícios criados ou descartados e ambiguidade. Fica fora da suíte padrão (`describe.skipIf`, aparece como 1 teste ignorado). Limitações em `SPRINT4-7-RELATORIO.md` §2.

## 4. Versões relevantes (instaladas por `npm ci`)

Node 24.16.0 · npm 11.13.0 · stockfish 19.0.1 · dexie 4.4.7 · react 19.3.1 · react-router-dom 7.18.5 · chess.js 1.4.0 · vite 8.3.5 (exige Node `^20.19.0 || >=22.12.0`) · vitest 5.1.0 · typescript 7.0.2 · @playwright/test 1.64.1. A Sprint 4.7 não mudou dependências; `package.json` só ganhou o script `measure:pedagogy`.

Arquivos do motor (SHA-256, idênticos aos de `node_modules/stockfish/bin`, conferidos de novo em `025e3da`):

- `stockfish-19-lite-single.js` — `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a`
- `stockfish-19-lite-single.wasm` — `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de`

## 5. Resultado dos testes [E]

Executados na `main` local em `025e3da` (sincronizada com `origin/main` por fast-forward), com `npm ci` (0 vulnerabilidades), em 2026-11-13. A CI do push no mesmo SHA (run `43476702612`) obteve os mesmos números de Vitest, motor real e Playwright.

| Verificação | Comando | Local | CI do push |
|---|---|---|---|
| Arquivos do motor | SHA-256 contra `node_modules/stockfish/bin` | idênticos | ok |
| Typecheck | `npm run typecheck` | ok | ok |
| Vitest | `npm test` | **497/497** + 1 ignorado (31 arquivos + 1 ignorado) | 497 + 1 ignorado |
| Stockfish real isolado | `npm run test:engine` | **24/24** (também passa na suíte completa) | 24/24 na suíte |
| Cobertura (`src/services`, `src/db`) | `npm run coverage` | linhas 95,22% (2173/2282) · statements 91,96% (2632/2862) · branches 84,62% (2020/2387) · funções 89,76% (570/635) | não executada na CI |
| Build | `npm run build` | ok | ok |
| Playwright | `npm run test:e2e` (porta dedicada 4176) | **86/86** (12 arquivos) | 86/86, sem retentativa nem flaky |

O teste ignorado é a medição pedagógica (`tests/measure/pedagogy-corpus.test.ts`), que só roda com `CORPUS_PGN`.

Avisos da CI, sem efeito no resultado: `actions/checkout@v4`, `actions/setup-node@v4` e `actions/cache@v4` declaram Node 20 e o runner as força para Node 24 (aviso de depreciação do GitHub); `DeprecationWarning DEP0169` (`url.parse()`) emitido por uma dependência durante os testes. Nenhuma falha de infraestrutura.

Evolução:
- Vitest: 322 → 370 → 401 → 476 → 497;
- Playwright: 47 → 53 → 59 → 84 → 86;
- motor real: 21 → 23 → 24 → 24.

## 6. Persistência

- **[F]** Gravações em transação: importação com deduplicação por `&hash` (`gamesRepo.importPgn`), `recordAttempt` (tentativa + revisão + evidência), exclusões em cascata, restauração de backup (tudo ou nada), troca de cor com marca de derivação (`saveColorMarkingPending`), redatação de evidências.
- **[F]** Histórico de esquema explícito (`SCHEMA_VERSIONS = [1, 2]`); a única migração (v1→v2) converte exercícios antigos em árvore de solução, com testes de upgrade v1→v2→v3 em `tests/persistence.test.ts`.
- **[F]** Na abertura do app: análises interrompidas viram `paused`, evidências de partida são datadas pela partida, evidências de exercícios inexistentes são removidas e derivações `'pending'` são refeitas.
- **[F]** A exclusão de uma partida durante a análise interrompe a execução, e a análise não é recriada (Sprint 4.6, AC-1).
- **[F]** Backup: valida formato, versão, chaves e FENs antes de gravar; recusa versões futuras; um backup parcial substitui apenas as tabelas que contém.
- **[F]** Compatibilidade com dados antigos (Sprint 4.7): nada é regravado. Evidências de cálculo gravadas por partidas antes da 4.7 são ignoradas na leitura (`isMeasurableEvidence`); conversões antigas passam a aceitar o lance decisivo na validação; exercícios sem `goal` ou `motifSide` continuam funcionando.

## 7. Débitos conhecidos

| # | Item | Situação em `025e3da` |
|---|---|---|
| 1 | Contador "Revisões pendentes" limitado a 5 posições marcadas | **Resolvido** (Sprint 4.3) |
| 2 | Exercício usa limites de classificação atuais; análises usaram os da época | Aberto (postergar: muda o formato dos dados) |
| 3 | Em 768 px as ações do exercício ficam abaixo da dobra | Aberto (corrigir se tablet for alvo) |
| 4 | Mate equivalente pelo caminho `measureAfter` recebe "Excelente" | Aberto (manter/postergar) |
| 5 | Versionamento Dexie podia apagar tabelas | **Resolvido** (Sprint 4.3, `SCHEMA_VERSIONS`) |
| 6 | E2E local reaproveitava servidor na 4173 | **Resolvido** (Sprint 4.3: porta 4176, `reuseExistingServer: false`) |
| 7 | Sem ESLint | Aberto (dependência nova: só com decisão do usuário) |

**Entregues na Sprint 4.7** (achados da auditoria pós-4.6, não eram débitos desta tabela):
- PD-1: "Cálculo de variantes" não é mais medido só por fracassos;
- PD-2: conversão coerente com o objetivo; o indicador B3 não conta vantagem decisiva mantida;
- PD-3: "Treinar este tema" respeita o lado do motivo;
- achados das revisões do PR #10: M1–M3, L3, L4 (fronteira de 80%), F1.

Nenhum débito da baseline anterior foi resolvido, nem mesmo de passagem, na Sprint 4.7. Conferido no código de `025e3da`: as esperas fixas, a classe `book` sem uso e o jargão "p.p." continuam presentes, e não há proteção entre abas (`navigator.locks`/`BroadcastChannel`).

**Continuam abertos** (`POST-SPRINT4-5-AUDITORIA.md` §4–5, `SPRINT4-6-AUDITORIA-CONSOLIDADA.md` §11–12 e `SPRINT4-7-RELATORIO.md` §6):

| Item | Situação |
|---|---|
| T-1 (antes FA-6): concorrência entre abas. Reproduzido na Sprint 4.7: ao abrir uma 2ª aba, `recoverInterruptedAnalyses` marca como `paused`, por cerca de 1,3 s, uma análise que continua rodando na 1ª; a gravação seguinte devolve `running`, sem perda. Clicar em "Retomar" nessa janela duplica a execução da mesma partida | Aberto; mantido por decisão do usuário. Candidato à próxima sprint (por exemplo, Web Locks por partida) |
| PX-2: erro sem motivo tático verificado mostra só a avaliação, sem explicação posicional | Aberto; a decisão depende de rodar `measure:pedagogy` num PGN real do jogador |
| PD-4: exercícios de defesa aceitam qualquer lance dentro da tolerância (nos fixtures, 100% ambíguos) | Hipótese; depende da mesma medição |
| PD-5: domínio de tema mede a lembrança das mesmas posições repetidas | Limitação de desenho, documentada |
| PD-6: jargão "p.p." nas mensagens de incerteza, no detalhe da recusa e em outros textos | Aberto (cosmético) |
| T-2: custo do painel com histórico grande (recalcula conceitos a cada minuto) | Hipótese; medir antes de mudar |
| T-3: classe `book` declarada em `MoveClass`, nunca atribuída | Aberto (código morto) |
| FA-2: série de comparação do perfil escolhida em todo o histórico | Aberto (P3, postergado) |
| FA-5: teste da inicialização em etapas | Aberto |
| PX-6: três contagens de "pendente" com regras diferentes | Aberto |
| AC-10: instante real exatamente às 00:00:00.000 UTC lido como data PGN | Aceito; corrigir exige mudança de schema |
| AC-11: indicador B3 sem teste estatístico; não mede força enxadrística | Aceito e documentado (METHODOLOGY) |
| Falha de gravação persistente (disco cheio): o estado `error` pode não ser gravado | Aceito; a análise volta como `paused` na próxima abertura |
| Esperas fixas em testes: 500 ms em duas asserções negativas de `e2e/audit-sprint4-6.spec.ts`; três `waitForTimeout(700)` em `e2e/mvp.spec.ts` (linhas 108, 119 e 134, não listados na baseline anterior); 30 ms em `tests/analysis-progress.test.ts` | Aberto (LOW) |
| Voltar de um exercício para a análise reabre a partida na posição inicial (o lance selecionado não fica na URL) | Comportamento anterior; mudar seria decisão de produto |
| L4: o ramo de posição terminal ignora o piso de conversão | Sem efeito prático (mate vale 100%, empate 50%); mantido |
| L5 (revisão do PR #10): a nota "Só: …" do filtro herda o tamanho do rótulo | Cosmético; mantido |

**Decidido e fora de escopo:** estender a exceção dos 80% ao perfil de competências e aos padrões recorrentes (achado M2 da revisão da Sprint 4.7). A decisão do usuário restringe a exceção ao indicador.

Não há P0 nem P1.

## 8. Ressalvas da baseline

1. **[F]** Os itens 2, 3, 4 e 7 continuam abertos e estão no backlog.
2. **[F]** Os achados da auditoria de planejamento da Sprint 4.5 foram tratados e integrados no PR #8 (`SPRINT4-5-RELATORIO.md`), junto com as correções AI-1 a AI-7, FA-1 e FA-7.
3. **[F]** A Sprint 4.6 foi aprovada com ressalvas na auditoria consolidada, sem achado CRITICAL, HIGH ou MEDIUM pendente. Um E2E intermitente da B2 foi corrigido no commit `2edc35c`.
4. **[F]** A Sprint 4.7 teve três revisões independentes (`SPRINT4-7-RELATORIO.md` §7), todas sem CRITICAL nem HIGH. Os MEDIUM foram corrigidos (M1, M3 e as lacunas de teste do PR) ou mantidos por decisão do usuário (M2).
5. **[I]** A medição pedagógica só foi validada nos dois fixtures do repositório (partidas conhecidas, não de um amador); ela não sustenta conclusão sobre PX-2 e PD-4.
6. **[F]** A cobertura não é medida na CI; o número desta baseline vem da execução local em `025e3da`.

## 9. Limitações conhecidas

As do README continuam válidas: motor *lite*; SEE só na casa da troca; promoção sempre para dama; ramificação limitada da árvore de solução; fase da partida por heurística; mesmo PGN com cabeçalhos diferentes não é duplicata; sem partidas contra o motor. Acrescenta-se: o plano da sessão guiada não faz parte do backup; `measure:pedagogy` usa `DEFAULT_SETTINGS`, não as configurações salvas, e não consulta o banco do app.

## 10. Procedimento de validação para futuras sprints

1. Partir de `origin/main` atualizada (`git switch main && git pull --ff-only`) e anotar o SHA.
2. O E2E usa a porta dedicada 4176 e não reaproveita servidor; os dados reais ficam em `localhost:5173` e não devem ser usados em testes.
3. `npm ci` — sem atualizar dependências por conveniência.
4. Conferir os arquivos do motor (`public/engine/*.js|.wasm` não vazios e idênticos aos de `node_modules/stockfish/bin`).
5. `npm run typecheck`, `npm test`, `npm run test:engine` (isolado e dentro da suíte, por causa do estado de hash do motor), `npm run coverage`, `npm run build`, `npm run test:e2e`.
6. Comparar com esta baseline: 497 Vitest (+ 1 ignorado), 24 com motor real, 86 Playwright, cobertura ≥ 80% em todas as métricas. Toda redução precisa de justificativa.
7. Mudança de schema: nunca editar um bloco `version()` existente; adicionar teste de upgrade a partir da versão anterior com dados reais de fixture; nunca rodar em banco real.
8. Verificar ausência de chamadas de rede novas (`fetch`, XHR, WebSocket, `sendBeacon`, URLs).
9. Teste em celular físico numa origem separada (configuração `chessquest-phone`, porta 4180), sem usar os dados reais de `localhost:5173`.
10. CI verde no commit final do PR e integração por merge commit.
