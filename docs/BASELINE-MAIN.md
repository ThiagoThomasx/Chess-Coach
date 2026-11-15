# Baseline da `main` — pós-integração da Sprint 4.8

| Campo | Valor |
|---|---|
| Commit de referência | `7c0c3e24c1b406a157172e37ed0060f5ee931444` (`origin/main`, merge do PR #11) |
| Data | 2026-11-15, validação pós-merge da Sprint 4.8. A versão anterior descrevia `025e3da`, merge do PR #10 |
| CI do commit | run `43768088702` (push na `main`), job `verify`: sucesso. No PR, os runs `43722295002` (`cd52506`) e `43761582625` (`864f4b7`, cabeça do PR) também passaram |
| Relatório desta base | `SPRINT4-8-RELATORIO.md` (inclui as revisões e auditorias independentes, o teste físico e a CI do PR #11). Anteriores: `SPRINT4-7-RELATORIO.md`, `SPRINT4-6-AUDITORIA-CONSOLIDADA.md`, `SPRINT4-6-PREPARACAO-INTEGRACAO.md`, `SPRINT4-6-PA1-B3-RELATORIO.md`, `SPRINT4-6-B2-RELATORIO.md`, `POST-SPRINT4-5-AUDITORIA.md`, `SPRINT4-5-AUDITORIA-INDEPENDENTE.md`, `SPRINT4-5-AUDITORIA-FINAL-PRE-MERGE.md`, `SPRINT4-3-AUDITORIA-POS-MERGE.md` e `SPRINT4-4-AUDITORIA-POS-MERGE.md` |

Legenda: **[F]** fato verificado no repositório/GitHub · **[E]** resultado de execução · **[I]** inferência · **[U]** informado pelo usuário.

## 1. Estado do repositório

- **[F]** Branch padrão: `main`. Nenhum PR aberto depois do merge do PR #11.
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
| #11 | `feat/sprint4-8-single-owner` | `7c0c3e2` | 2026-11-15 22:13 | sucesso (run `43768088702`) |

- **[F]** A árvore de cada merge de PR é idêntica à cabeça da branch integrada (sem resolução de conflito oculta). Para o PR #11: `git diff 864f4b7 7c0c3e2` é vazio.
- **[F]** As branches de origem estão contidas em `origin/main` e foram mantidas, inclusive `feat/sprint4-8-single-owner` (local e remota em `864f4b7`).
- **[F]** Entre o merge do PR #10 e o PR #11, a `main` recebeu `4de7e4e` (docs: baseline pós-4.7) diretamente, como já ocorrera com `5701b4b` depois do PR #9.
- **[F]** O PR #11 entrou com seis commits, preservados pelo merge commit:
  - `2109c95` feat (T-1: uma análise por partida entre abas; FA-5);
  - `54c5fff` feat (lance selecionado na URL);
  - `279b74f` feat (N-1: proteção de dados);
  - `d0e48d6` test (esperas determinísticas no E2E e métricas do PD-4);
  - `cd52506` e `864f4b7` docs (relatório, README e ARCHITECTURE; correção do relatório).

## 2. Arquitetura

- **Local-first [F]:** sem backend, login, telemetria ou serviços remotos. Não há `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` nem URLs externas em `src/` ou `index.html`; o E2E `mvp.spec.ts` falha se houver requisição externa. A Sprint 4.8 não acrescentou chamadas de rede (conferido em `7c0c3e2`).
- **Motor [F]:** Stockfish 19 lite single-thread (WASM) em Web Worker (`src/services/engine/workerTransport.ts`), servido de `public/engine/` (copiado por `scripts/copy-engine.mjs` no `postinstall`). Nos testes em Node, o transporte do motor fica em `tests/support/nodeEngine.ts` (extraído de `engine-integration.test.ts` na Sprint 4.7, sem mudança de comportamento).
- **Persistência [F]:** IndexedDB via Dexie, banco `chessquest`, esquema **v2** (inalterado desde `9c964de`; as Sprints 4.6 a 4.8 não mudaram o schema; a 4.8 só acrescentou os campos opcionais `lastBackupAt` e `persistRequestedAt` às configurações), com histórico explícito em `SCHEMA_VERSIONS` (`[1, 2]`, Sprint 4.3). O plano da sessão guiada fica no `localStorage` (`chessquest.session.v1`), expira no fim do dia e não entra no backup.
- **Análise em andamento [F] (Sprint 4.6, PA-1 e auditoria):**
  - o progresso é gravado no máximo a cada 2 s (`progressSaver`), e o estado final é sempre gravado;
  - toda gravação confere, na mesma transação, se a partida existe (`saveAnalysisIfGameExists`);
  - uma falha de gravação termina a análise como `error`;
  - a tela combina o registro gravado com os eventos do runner (`useLiveAnalysis`);
  - as listas leem só o índice `status` ou só as análises concluídas.
- **Uma análise por partida entre abas [F] (Sprint 4.8, T-1; `ARCHITECTURE.md`, decisão 14):**
  - `startAnalysis` roda a execução inteira, derivação incluída, segurando o Web Lock `chessquest.analysis.<gameId>` (`src/services/analysis/analysisLock.ts`); com o lock ocupado, recusa com `AnalysisElsewhereError` sem gravar nada;
  - `recoverInterruptedAnalyses` e `reconcileDerivations` pulam as partidas com lock ocupado;
  - a tela (`useAnalysisOwner`, `useActiveRun`, `controlView`) mostra "Analisando em outra aba…", vigia o lock e oferece "Retomar" quando a outra aba termina ou fecha; os controles acompanham uma execução da própria aba depois de sair e voltar;
  - sem a API (`navigator.locks`), o comportamento é o anterior à 4.8.
- **Três noções de erro [F] (Sprint 4.7, PD-2; `docs/METHODOLOGY.md`, "Três noções de erro"):**
  - **erro técnico**: a classificação do motor, inalterada (análise, selos, perfil, padrões recorrentes);
  - **erro sério**: erro ou erro grave do usuário, exceto com expectativa ≥ 80% depois do lance; vale só no indicador "Minhas partidas estão melhorando?";
  - **elegível para treino**: `noErrorToTrain`, regra única da derivação automática e da criação manual; um lance que manteve a vantagem decisiva não gera exercício de conversão.
  - A faixa decisiva é a constante única `DECISIVE_WIN_PERCENT = 80`.
- **Rotas [F]** (`src/app/App.tsx`, HashRouter + `lazy()`): `/`, `/games`, `/analysis/:gameId` (com `?ply=` desde a Sprint 4.8), `/train`, `/train/session`, `/train/:exerciseId`, `/openings`, `/progress`, `/settings`, `*`. A tela Treinar aceita `?theme=…&side=own|opponent` (Sprint 4.7, PD-3).

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
| Uma análise por partida entre abas: "Analisando em outra aba…" e retomada quando a outra aba fecha (Sprint 4.8, T-1) | análise | `two-tabs.spec` |
| Controles da análise acompanham a execução depois de sair e voltar à tela (Sprint 4.8, auditoria pré-encerramento) | análise | `analysis-remount.spec` |
| Lance selecionado na URL (`?ply=`); voltar de um exercício reabre o mesmo lance (Sprint 4.8) | análise / exercício | `analysis-url.spec`, `exercise-origin.spec` |
| Proteção de dados: armazenamento persistente pedido uma vez depois da primeira importação, "Última exportação de backup" e lembrete de 14 dias no painel (Sprint 4.8, N-1) | `/games`, `/settings`, `/` | `data-protection.spec` |
| Configurações, backup e restauração | `/settings` | `mvp.spec`, `data-protection.spec` |

Ferramenta de desenvolvimento (não empacotada no app): `npm run measure:pedagogy` (Sprint 4.7) analisa um PGN local com o motor real e informa distribuição de classes, explicações verificadas, exercícios criados ou descartados e ambiguidade; desde a Sprint 4.8, também, por objetivo do exercício, a parcela de raízes "no limite" das linhas da busca e a perda das alternativas aceitas (preparação do PD-4). Fica fora da suíte padrão (`describe.skipIf`, aparece como 1 teste ignorado). Limitações em `SPRINT4-7-RELATORIO.md` §2 e `SPRINT4-8-RELATORIO.md` §2.

## 4. Versões relevantes (instaladas por `npm ci`)

Node 24.16.0 · npm 11.13.0 · stockfish 19.0.1 · dexie 4.4.7 · react 19.3.1 · react-router-dom 7.18.5 · chess.js 1.4.0 · vite 8.3.5 (exige Node `^20.19.0 || >=22.12.0`) · vitest 5.1.0 · typescript 7.0.2 · @playwright/test 1.64.1. A Sprint 4.8 não mudou `package.json` nem `package-lock.json` (sem dependência nova).

Arquivos do motor (SHA-256, idênticos aos de `node_modules/stockfish/bin`, conferidos de novo em `7c0c3e2`):

- `stockfish-19-lite-single.js` — `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a`
- `stockfish-19-lite-single.wasm` — `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de`

## 5. Resultado dos testes [E]

Executados na `main` local em `7c0c3e2` (sincronizada com `origin/main` por fast-forward), em 2026-11-15, das 22:29:38Z às 22:36:54Z, numa rodada única e sequencial. Localmente **não** foi executado `npm ci`: foi usado o `node_modules` já instalado, porque a sprint não mudou `package.json` nem `package-lock.json` e o `npm ls` não acusou problemas. A instalação limpa por `npm ci` foi coberta pela CI do push no mesmo SHA (run `43768088702`), que obteve os mesmos números de Vitest, motor real e Playwright.

| Verificação | Comando | Local | CI do push |
|---|---|---|---|
| Arquivos do motor | SHA-256 contra `node_modules/stockfish/bin` | idênticos | ok |
| Typecheck | `npm run typecheck` | ok | ok |
| Vitest | `npm test` | **573/573** + 1 ignorado (39 arquivos + 1 ignorado) | 573 + 1 ignorado (39 arquivos + 1 ignorado) |
| Stockfish real isolado | `npm run test:engine` | **24/24** (também passa na suíte completa) | 24/24 na suíte |
| Cobertura (`src/services`, `src/db`) | `npm run coverage` | linhas 95,47% (2259/2366) · statements 92,22% (2741/2972) · branches 84,72% (2086/2462) · funções 90,10% (601/667) | não executada na CI |
| Build | `npm run build` | ok | ok |
| Playwright | `npm run test:e2e` (porta dedicada 4176) | **95/95** (16 arquivos) | 95/95, sem retentativa nem flaky |

O teste ignorado é a medição pedagógica (`tests/measure/pedagogy-corpus.test.ts`), que só roda com `CORPUS_PGN`. A cobertura oficial mede só `src/services` e `src/db`: os hooks da tela da 4.8 (`useAnalysisOwner`, `useActiveRun`) ficam fora do número e são cobertos por testes unitários próprios e por E2E.

Avisos da CI, sem efeito no resultado (os mesmos das CIs de `4de7e4e` e do PR): `actions/checkout@v4`, `actions/setup-node@v4` e `actions/cache@v4` declaram Node 20 e o runner as força para Node 24 (aviso de depreciação do GitHub); `DeprecationWarning DEP0040` (`punycode`) e `DEP0169` (`url.parse()`) emitidos por ferramentas durante os testes. Nenhuma falha de infraestrutura.

Evolução:
- Vitest: 322 → 370 → 401 → 476 → 497 → 573;
- Playwright: 47 → 53 → 59 → 84 → 86 → 95;
- motor real: 21 → 23 → 24 → 24 → 24.

## 6. Persistência

- **[F]** Gravações em transação: importação com deduplicação por `&hash` (`gamesRepo.importPgn`), `recordAttempt` (tentativa + revisão + evidência), exclusões em cascata, restauração de backup (tudo ou nada), troca de cor com marca de derivação (`saveColorMarkingPending`), redatação de evidências.
- **[F]** Histórico de esquema explícito (`SCHEMA_VERSIONS = [1, 2]`); a única migração (v1→v2) converte exercícios antigos em árvore de solução, com testes de upgrade v1→v2→v3 em `tests/persistence.test.ts`.
- **[F]** Na abertura do app (`src/app/startup.ts`, Sprint 4.8, FA-5: etapas independentes, a falha de uma não impede as seguintes): análises interrompidas cujo lock está livre viram `paused` (o registro é relido na transação e só é pausado se não mudou), evidências de partida são datadas pela partida, evidências de exercícios inexistentes são removidas e derivações `'pending'` cujo lock está livre são refeitas.
- **[F]** A exclusão de uma partida durante a análise interrompe a execução, e a análise não é recriada (Sprint 4.6, AC-1).
- **[F]** Backup: valida formato, versão, chaves e FENs antes de gravar; recusa versões futuras; um backup parcial substitui apenas as tabelas que contém. Desde a Sprint 4.8, a exportação só lê o banco; a data da última exportação (`lastBackupAt`) é gravada depois que o arquivo foi gerado e o download foi pedido, e não prova que o arquivo foi salvo; numa restauração, vale a data de exportação do arquivo, limitada ao momento atual.
- **[F]** Compatibilidade com dados antigos (Sprint 4.7): nada é regravado. Evidências de cálculo gravadas por partidas antes da 4.7 são ignoradas na leitura (`isMeasurableEvidence`); conversões antigas passam a aceitar o lance decisivo na validação; exercícios sem `goal` ou `motifSide` continuam funcionando.

## 7. Débitos conhecidos

| # | Item | Situação em `7c0c3e2` |
|---|---|---|
| 1 | Contador "Revisões pendentes" limitado a 5 posições marcadas | **Resolvido** (Sprint 4.3) |
| 2 | Exercício usa limites de classificação atuais; análises usaram os da época | Aberto (postergar: muda o formato dos dados) |
| 3 | Em 768 px as ações do exercício ficam abaixo da dobra | Aberto (corrigir se tablet for alvo) |
| 4 | Mate equivalente pelo caminho `measureAfter` recebe "Excelente" | Aberto (manter/postergar) |
| 5 | Versionamento Dexie podia apagar tabelas | **Resolvido** (Sprint 4.3, `SCHEMA_VERSIONS`) |
| 6 | E2E local reaproveitava servidor na 4173 | **Resolvido** (Sprint 4.3: porta 4176, `reuseExistingServer: false`) |
| 7 | Sem ESLint | Aberto (dependência nova: só com decisão do usuário) |

**Resolvidos na Sprint 4.8** (`SPRINT4-8-RELATORIO.md` §7):
- T-1: concorrência entre abas, com Web Locks por partida, E2E de duas abas reais e teste físico;
- FA-5: inicialização em etapas testável (`src/app/startup.ts`);
- voltar de um exercício reabre o mesmo lance da análise (`?ply=` na URL);
- esperas fixas no E2E: não resta `waitForTimeout` em `e2e/`;
- N-1 (proteção de dados, achado da auditoria pré-4.8): armazenamento persistente pedido uma vez e lembrete de backup de 14 dias, com as ressalvas LOW abaixo;
- achados MEDIUM das revisões da 4.8: controles presos depois de sair e voltar (defeito anterior à 4.8) e `reconcileDerivations` ignorando o lock de outra aba.

Conferido no código de `7c0c3e2`: a classe `book` continua declarada e sem uso, o jargão "p.p." continua em 10 textos de `src/`, e o `setTimeout` de 30 ms de `tests/analysis-progress.test.ts` continua (provoca uma corrida de propósito, como os demais `setTimeout` dos testes unitários).

**Continuam abertos** (`POST-SPRINT4-5-AUDITORIA.md` §4–5, `SPRINT4-6-AUDITORIA-CONSOLIDADA.md` §11–12, `SPRINT4-7-RELATORIO.md` §6 e `SPRINT4-8-RELATORIO.md` §7):

| Item | Situação |
|---|---|
| Janela residual do Web Lock: por um instante depois da liberação, iniciar pode ser recusado ("em outra aba"); com 3 abas ou mais a recuperação pode esperar a última vigia | Aceito (LOW); sem perda de dados, tentar de novo funciona |
| PX-2: erro sem motivo tático verificado mostra só a avaliação, sem explicação posicional | Investigativo; a decisão depende de rodar `measure:pedagogy` num PGN real do jogador |
| PD-4: exercícios de defesa aceitam qualquer lance dentro da tolerância | Investigativo; a 4.8 preparou a medição (nos fixtures, 100% das raízes de defesa "no limite" das 3 linhas), mas falta a coleta real. Os fixtures não sustentam conclusão |
| PD-5: domínio de tema mede a lembrança das mesmas posições repetidas | Adiado; limitação de desenho, documentada |
| PD-6: jargão "p.p." nas mensagens de incerteza, no detalhe da recusa e em outros textos | Aberto (cosmético) |
| T-2: custo do painel com histórico grande (recalcula conceitos a cada minuto) | Adiado; hipótese, medir antes de mudar |
| T-3: classe `book` declarada em `MoveClass`, nunca atribuída | Adiado (código morto) |
| FA-2: série de comparação do perfil escolhida em todo o histórico | Adiado (P3) |
| PX-6: três contagens de "pendente" com regras diferentes | Adiado |
| Download do backup: o endereço do arquivo é revogado logo depois do clique | Aberto (LOW); funciona no Chrome/Firefox atuais e passou no teste físico; navegadores antigos podem falhar |
| Precisão do lembrete de backup: repertório, aberturas personalizadas e exclusões não contam como dado novo; restauração parcial grava a data | Aberto (LOW); conservador, sem perda |
| Mensagem quando gravar a data falha depois do download: diz "não foi possível exportar" | Aberto (LOW) |
| `afterRead` exposto na assinatura pública de `recoverInterruptedAnalyses` | Aberto (LOW; ponto de teste) |
| E2E da data do backup compara a data do Node com a do navegador | Aberto (LOW); falharia exatamente na virada da meia-noite |
| `changeUserColor` deriva sem consultar o lock de outra aba | Aberto (LOW); anterior à 4.8; `markDerived` e a deduplicação corrigem |
| `ARCHITECTURE.md`, decisão 7, diz "persistência após cada posição" (desde a 4.6 é no máximo a cada 2 s) | Aberto (LOW, documental) |
| AC-10: instante real exatamente às 00:00:00.000 UTC lido como data PGN | Aceito; corrigir exige mudança de schema |
| AC-11: indicador B3 sem teste estatístico; não mede força enxadrística | Aceito e documentado (METHODOLOGY) |
| Falha de gravação persistente (disco cheio): o estado `error` pode não ser gravado | Aceito; o registro preso em `running` com lock livre é pausado na próxima abertura ou pela vigia de outra aba |
| L4: o ramo de posição terminal ignora o piso de conversão | Sem efeito prático (mate vale 100%, empate 50%); mantido |
| L5 (revisão do PR #10): a nota "Só: …" do filtro herda o tamanho do rótulo | Cosmético; mantido |

**Decidido e fora de escopo:** estender a exceção dos 80% ao perfil de competências e aos padrões recorrentes (achado M2 da revisão da Sprint 4.7). A decisão do usuário restringe a exceção ao indicador.

Não há P0 nem P1.

## 8. Ressalvas da baseline

1. **[F]** Os itens 2, 3, 4 e 7 continuam abertos e estão no backlog.
2. **[F]** Os achados da auditoria de planejamento da Sprint 4.5 foram tratados e integrados no PR #8 (`SPRINT4-5-RELATORIO.md`), junto com as correções AI-1 a AI-7, FA-1 e FA-7.
3. **[F]** A Sprint 4.6 foi aprovada com ressalvas na auditoria consolidada, sem achado CRITICAL, HIGH ou MEDIUM pendente. Um E2E intermitente da B2 foi corrigido no commit `2edc35c`.
4. **[F]** A Sprint 4.7 teve três revisões independentes (`SPRINT4-7-RELATORIO.md` §7), todas sem CRITICAL nem HIGH. Os MEDIUM foram corrigidos (M1, M3 e as lacunas de teste do PR) ou mantidos por decisão do usuário (M2).
5. **[F]** A Sprint 4.8 teve quatro revisões e auditorias independentes (`SPRINT4-8-RELATORIO.md` §4), sem CRITICAL nem HIGH; todos os MEDIUM foram corrigidos com teste de regressão. Os LOW abertos estão na tabela acima.
6. **[U]** Teste físico da Sprint 4.8 (procedimento 9): Samsung Galaxy S26, Android, 6 de 6 cenários aprovados; navegador e versão não informados. Tablet (item 3) e Safari/iOS não foram testados fisicamente.
7. **[I]** A medição pedagógica só foi validada nos dois fixtures do repositório (partidas conhecidas, não de um amador); ela não sustenta conclusão sobre PX-2 e PD-4.
8. **[F]** A cobertura não é medida na CI; o número desta baseline vem da execução local em `7c0c3e2`.

## 9. Limitações conhecidas

As do README continuam válidas: motor *lite*; SEE só na casa da troca; promoção sempre para dama; ramificação limitada da árvore de solução; fase da partida por heurística; mesmo PGN com cabeçalhos diferentes não é duplicata; sem partidas contra o motor. Acrescenta-se: o plano da sessão guiada não faz parte do backup; a proteção entre abas depende de Web Locks (sem a API, vale o comportamento anterior à 4.8); a data da última exportação não prova que o arquivo foi salvo; `measure:pedagogy` usa `DEFAULT_SETTINGS`, não as configurações salvas, e não consulta o banco do app.

## 10. Procedimento de validação para futuras sprints

1. Partir de `origin/main` atualizada (`git switch main && git pull --ff-only`) e anotar o SHA.
2. O E2E usa a porta dedicada 4176 e não reaproveita servidor; os dados reais ficam em `localhost:5173` e não devem ser usados em testes.
3. `npm ci` — sem atualizar dependências por conveniência.
4. Conferir os arquivos do motor (`public/engine/*.js|.wasm` não vazios e idênticos aos de `node_modules/stockfish/bin`).
5. `npm run typecheck`, `npm test`, `npm run test:engine` (isolado e dentro da suíte, por causa do estado de hash do motor), `npm run coverage`, `npm run build`, `npm run test:e2e`.
6. Comparar com esta baseline: 573 Vitest (+ 1 ignorado), 24 com motor real, 95 Playwright, cobertura ≥ 80% em todas as métricas. Toda redução precisa de justificativa. Nunca rodar duas validações completas ao mesmo tempo: o `npm run build` de uma reescreve `dist/` enquanto o preview da outra o serve, e as duas disputam a porta 4176 (Sprint 4.8).
7. Mudança de schema: nunca editar um bloco `version()` existente; adicionar teste de upgrade a partir da versão anterior com dados reais de fixture; nunca rodar em banco real.
8. Verificar ausência de chamadas de rede novas (`fetch`, XHR, WebSocket, `sendBeacon`, URLs).
9. Teste em celular físico numa origem separada (configuração `chessquest-phone`, porta 4180), sem usar os dados reais de `localhost:5173`; registrar aparelho, sistema, navegador e versão no relatório da sprint (na 4.8, navegador e versão não foram informados).
10. CI verde no commit final do PR e integração por merge commit.
