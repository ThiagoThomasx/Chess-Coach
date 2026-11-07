# ChessQuest — Sprint 4.0: auditoria e planejamento evolutivo

Data: 2026-11-06. Nenhuma funcionalidade, regra de negócio, esquema de banco ou dependência foi alterada nesta rodada; o único arquivo criado é este documento.

## 1. Estado do repositório (divergência com o pedido)

O pedido partia de um PR #1 já mesclado. **Isso não se confirmou**:

| Verificação (após `git fetch --prune`) | Resultado |
|---|---|
| PR #1 | `OPEN`, sem merge (`mergedAt` e `mergeCommit` vazios), `mergeStateStatus: CLEAN` |
| `origin/main` | `9c964de` — não contém nenhum dos 13 commits do PR (0 commits à frente do PR) |
| Head do PR | `055f6e1` (`fix/sprint3-phase1`), igual ao local; CI [42256693085](https://github.com/ThiagoThomasx/Chess-Coach/actions/runs/42256693085) com sucesso |
| Branch padrão do repositório no GitHub | `fix/sprint3-phase1` (não `main`) — provável origem da impressão de merge |
| Alterações locais | nenhuma além de `.claude/` (não rastreada, preservada) |

Por decisão do usuário, a auditoria foi feita sobre o **head do PR, `055f6e1`** — exatamente o código que entrará na `main` com o merge. Nenhum merge, push ou alteração no GitHub foi feito.

**Ações pendentes do usuário (fora do código):** mesclar o PR #1 e, depois, voltar a branch padrão do repositório para `main`. O teste em aparelho físico (relatório da Sprint 3.1, seção 6) continua não realizado.

## 2. Integridade — commit validado `055f6e1`

Ambiente: Windows 11, Node 24.16.0. `npm ci` não foi necessário: `npm ls` confirmou as dependências do lockfile instaladas.

| Verificação | Resultado | Referência anterior |
|---|---|---|
| Arquivos Stockfish WASM em `public/engine/` | presentes e idênticos byte a byte aos do pacote `stockfish@19.0.1` | — |
| Typecheck | 0 erros | 0 |
| Vitest | **239/239**, 15 arquivos | 239/239 |
| Stockfish real (`tests/engine-integration`) | **21/21** | 21/21 |
| Build de produção | OK | OK |
| Playwright E2E (build de produção) | **28/28** | 28/28 |

Os números são idênticos à referência. Os fluxos pedidos estão cobertos pelos testes executados agora: inicialização, importação de PGN (com duplicata), navegação, análise com o motor real, explicação, geração e resolução de exercício, persistência após recarregar, navegação entre módulos, exportação de backup e recusa de backup inválido (E2E); restauração válida, restauração de backup v1 e migração v1→v2 (Vitest). O fluxo E2E principal também afirma **zero requisições a hosts externos**.

**Problemas encontrados: nenhum P0.** Nenhum teste falhou, nenhum dado se perdeu, nenhum erro de console.

## 3. Auditoria de arquitetura

### 3.1 Camadas

- **Separação clara**: `services/` contém a lógica pura (xadrez, análise, pedagogia, exercícios, agenda, perfil), `db/` concentra o acesso ao Dexie em repositórios, `features/` compõe as telas. Os serviços não importam React; o motor entra por interface (`EngineLike`, `EngineTransport`), o que permite testar com motor falso e com o Stockfish real em processo filho.
- **Tamanho**: nenhum arquivo passa de 380 linhas (o maior é `services/exercises/sequence.ts`). Total de 8.301 linhas em `src/`.
- **Estado**: `useLiveQuery` (Dexie) é a fonte de verdade das telas; não há estado global duplicado. Execuções de análise vivem em `analysisRunner` (mapa por partida, com assinatura de progresso).
- **Erros**: o motor tem códigos de erro tipados; a criação manual de exercício trata falha com mensagem ao usuário (Sprint 3.1); a análise persiste o progresso a cada posição e é retomável.

**Ponto de atenção (desempenho, P2):** o dashboard carrega todas as tabelas e recalcula a cada renderização `errorThemes` → `detectConcepts` para **todos os lances de todas as partidas analisadas**, além do perfil completo. Com dezenas de partidas é imperceptível; com centenas, pode ficar lento. Não foi medido nesta rodada.

### 3.2 Stockfish

- **Ciclo de vida**: um único Worker para o app (`engineService.getEngine`), criado sob demanda; máquina de estados `idle → initializing → ready → error/terminated`; tempo limite de 20 s para `uciok`.
- **Concorrência**: fila FIFO; no máximo uma busca por vez. Análises da mesma partida não se duplicam (`runs` por `gameId`).
- **Cancelamento**: `stop()` (resultado parcial, `complete=false`), `cancelAll()` e `stopAnalysis` com sinal de aborto. Posições impossíveis são recusadas antes de chegar ao motor.
- **Robustez**: watchdog de 30 s sem saída descarta o Worker travado e reinicia a fila (`recover`).
- **Memória**: build *lite single-thread* (~1,8 MB de WASM); `Hash` e `Threads` não são configurados (padrões do motor). O Worker nunca é encerrado durante o uso — aceitável com instância única.
- **Profundidade/tempo**: definidos pelas configurações do usuário (análise rápida, profundidade, MultiPV); árvores de solução limitadas a profundidade 16.
- **Dispositivos fracos — não verificado**: não há adaptação automática da profundidade e o tempo de análise em celular real nunca foi medido. Depende do teste físico.

### 3.3 Persistência

- **Esquema**: Dexie versão 2, 12 tabelas, índices coerentes com as consultas. A migração v1→v2 converte exercícios legados e é testada; exercícios antigos restaurados de backup são normalizados na leitura (`normalizeExercise`).
- **Observação de manutenção (P3)**: `database.ts` declara `version(2)` duas vezes (esquema completo + `upgrade`). Funciona — o Dexie devolve o mesmo objeto de versão, e o teste de migração passa —, mas confunde quem for criar a v3. Corrigir somente quando houver uma mudança de esquema real.
- **Transações**: deduplicação de exercício atômica (Sprint 3.1); eventos de competência substituídos por partida em transação; restauração de backup tudo-ou-nada; limpeza por escopo em transação.
- **Duplicação**: partidas por hash único (`&hash`); exercícios por FEN sem contadores, dentro de transação. Detalhe sem impacto em dados: o pré-filtro de `deriveFromAnalysis` compara a FEN completa, enquanto `addExercise` compara a FEN sem contadores — no pior caso uma posição é selecionada e depois recusada, gerando menos exercícios que o máximo.
- **Crescimento (P2)**: o `evalCache` não tem política de expiração (o índice `storedAt` existe, mas nada o usa), e as análises guardam suas posições além do cache. O tamanho real por partida não foi medido; a tela de Dados já mostra contagens e o uso estimado (`storageEstimate`), mas não oferece limpeza só do cache antigo.

### 3.4 Segurança e privacidade

- **Sem chamadas externas no código**: nenhuma ocorrência de `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` ou `EventSource` em `src/`; `index.html` só carrega o favicon e o script local; não há fontes remotas.
- **Motor**: os `fetch` dentro de `stockfish-19-lite-single.js` carregam o próprio `.wasm` com `credentials: "same-origin"`. As URLs de GitHub e de rede neural no arquivo são texto (créditos e mensagens), não requisições.
- **Em execução**: o E2E principal registra toda requisição para fora de `localhost` e exige lista vazia — passou nesta rodada.
- **Sem telemetria, login, backend ou cloud.** Dados de partidas ficam no IndexedDB do navegador.
- **Riscos residuais (baixos)**: o IndexedDB não é criptografado (qualquer pessoa com acesso ao perfil do navegador lê as partidas); o arquivo de backup é JSON em texto claro; a restauração valida chaves e FENs, mas aceita outros campos livres — o arquivo é escolhido pelo próprio usuário e o React escapa o texto renderizado, então não há vetor de XSS identificado.

## 4. Auditoria da experiência de aprendizagem

| Pergunta | Avaliação |
|---|---|
| 1. O usuário entende por que errou? | **Sim, para erros táticos verificados**: explicação em seções (ameaça, consequência, alternativa e sua continuação, conceito, como reconhecer), com marcação "verificada" ou "limitada". Erros posicionais continuam só com a avaliação do motor — limitação honesta e documentada. |
| 2. Clareza para iniciantes/intermediários | Boa para o intermediário. Para o iniciante, os termos técnicos (p.p. de expectativa, cp, profundidade) aparecem na mesma tela, em linha discreta; não há glossário. Lacuna média. |
| 3. Exercícios treinam a competência do erro? | **Sim**: o exercício nasce da posição do erro, com objetivo coerente com o tema (Sprint 3) e árvore de solução verificada pelo motor. |
| 4. Dificuldade acompanha a evolução? | Parcialmente. Existe `targetDifficulty` por competência e o filtro "recomendados", mas o usuário precisa escolher esse filtro; o caminho padrão ("Revisar pendentes") ordena só por data. |
| 5. Perfil adaptativo útil? | O modelo é sólido (decaimento, intervalo de confiança, estados "precisa revisar/consolidada/insuficiente", sem rating inventado). A utilidade fica limitada pela lacuna 8. |
| 6. Dashboard acionável? | Tem um "Seu próximo treino" com evidências e link. Mas veja a lacuna 8: a recomendação tende a ficar parada. |
| 7. Aberturas ensinam ideias? | Sim, de forma introdutória: 8 aberturas (linha principal e variantes) com objetivos, ideias táticas e erros comuns em texto, prática com repetição espaçada e repertório. Não há ligação com as partidas do usuário (desvios do repertório). |
| 8. O ciclo analisar → fraqueza → treino fecha? | **Não fecha — principal lacuna.** Ver abaixo. |

### Lacuna principal: o ciclo de treino não responde ao treino

1. **A recomendação é histórica e não "esquece"**: `nextTraining` conta padrões de erro em **todas** as partidas analisadas, sem janela de tempo. Uma vez que um padrão aparece duas vezes, ele permanece como prioridade 1 para sempre.
2. **Treinar não muda a recomendação**: o desempenho nos exercícios do tema (já calculado em `themePerformance`) não entra na decisão. O jogador pode acertar 20 exercícios de garfo e o painel continua mandando treinar garfo.
3. **Revisões pendentes ficam escondidas**: com qualquer padrão recorrente, a prioridade 2 (revisões vencidas da repetição espaçada) nunca aparece como "próximo treino".
4. **Não há sessão**: "Treinar este tema" abre uma lista filtrada; o jogador escolhe exercício por exercício. A meta diária existe, mas não há uma fila que combine revisões vencidas, o tema fraco e a dificuldade-alvo, nem um resumo ao final.

| Lacuna | Impacto pedagógico |
|---|---|
| Ciclo de treino que não responde ao treino (itens 1–4) | **Alto** |
| Dificuldade-alvo fora do caminho padrão | Médio |
| Termos técnicos sem apoio para iniciantes | Médio |
| Aberturas sem ligação com as partidas do usuário | Médio |
| Erros posicionais sem explicação concreta | Médio (limitação de método, não de implementação) |

## 5. Oportunidades avaliadas

| Oportunidade | Valor | Complexidade | Risco técnico | Dependências | Critério objetivo de conclusão |
|---|---|---|---|---|---|
| **A. Sessão diária guiada** (revisões + tema fraco + dificuldade-alvo) | Alto | Média | Baixo (sem esquema novo) | SRS, perfil, `themePerformance` existentes | Sessão de N exercícios com ordem determinística testada e resumo ao final |
| **A/D. Recomendação que reage ao treino** (janela recente + desempenho no tema) | Alto | Baixa–média | Baixo | `errorThemes`, `themePerformance` | Padrão some ou cai de prioridade após X acertos independentes; testes unitários |
| A. Histórico de erros recorrentes | Médio | Baixa | Baixo | já parcialmente no Progresso | — (fica implícito na sessão) |
| A. Metas de aprendizagem | Médio | Média | Médio (exige novo dado persistido) | esquema v3 | — |
| B. Comparação lance jogado × melhor lance no tabuleiro | Médio | Média | Baixo | `ChessBoard` | Setas distintas para os dois lances, testadas em E2E |
| B. Consistência entre partidas | Médio | Média | Baixo | dados existentes | — |
| C. Desvios do repertório nas partidas do usuário | Médio–alto | Média | Médio (identificação de abertura já é sensível — M4 da Sprint 3) | repertório, `matchOpening` | Lista de partidas com o lance onde o usuário saiu da linha |
| C. Árvore de variantes / planos estratégicos | Médio | Alta (conteúdo autoral) | Baixo | — | — |
| D. Comparação entre períodos | Médio | Baixa | Baixo | `dailyPerformance` | — |
| E. Política de crescimento do `evalCache` + limpeza seletiva | Médio | Baixa | Médio (apaga dados) | — | Limite documentado e teste de expiração |
| E. Desempenho do dashboard com histórico grande | Médio | Média | Baixo | medição antes | Medir com 200 partidas; meta < 200 ms de cálculo |
| E. E2E de restauração **válida** | Médio | Baixa | Nenhum | — | Exportar → limpar → restaurar → dados iguais |
| E. Glossário/ajuda para termos técnicos | Médio | Baixa | Nenhum | — | — |
| E. Outros formatos de importação | Baixo | Média | Médio | — | Sem justificativa hoje: PGN é o formato universal de exportação |

## 6. Matriz de prioridades

| Prioridade | Itens |
|---|---|
| **P0** | Nenhum defeito de código. Pendências de processo: merge do PR #1, branch padrão de volta para `main`, teste em aparelho físico. |
| **P1** | Fechar o ciclo de treino: recomendação que reage ao treino + sessão diária guiada. |
| **P2** | Desvios do repertório; seta do melhor lance × lance jogado; desempenho do dashboard com histórico grande; política do `evalCache`; E2E de restauração válida; glossário para iniciantes. |
| **P3** | Comparação entre períodos; árvore de variantes; limpeza da dupla declaração `version(2)`; atualização das Actions para Node 24; branch protection e check obrigatório; outros formatos de importação. |

**Frentes escolhidas para a próxima sprint: uma só** — o ciclo de treino (P1). As outras ficam como candidatas às sprints seguintes, nesta ordem: (2) desvios do repertório, (3) robustez de dados em uso prolongado (`evalCache` + desempenho do dashboard + E2E de restauração).

## 7. Proposta da Sprint 4.1 — "Fechar o ciclo de treino"

**Objetivo principal:** fazer o "próximo treino" refletir o que o jogador acabou de treinar, e transformar a recomendação em uma sessão curta e guiada.

**Problema:** hoje a recomendação é calculada sobre todo o histórico, ignora o desempenho nos exercícios e esconde as revisões vencidas; treinar é escolher exercícios numa lista.

**Incluído:**
1. **Recomendação com evidência recente e resposta ao treino** (`services/recommendations/recommend.ts`):
   - padrões de erro contados numa janela recente (por exemplo, as últimas N partidas analisadas, com N documentado);
   - um padrão cujo tema já tem desempenho independente suficiente nos exercícios (limiares documentados, com mínimo de tentativas) passa a "em consolidação" e perde a prioridade;
   - revisões vencidas acima de um limite entram antes do tema;
   - a mensagem diz por que aquela recomendação foi escolhida, com os números.
2. **Sessão diária guiada** (novo `services/training/session.ts`, puro e testável):
   - fila determinística de até `dailyGoal` exercícios: revisões vencidas primeiro, depois exercícios do padrão recomendado, depois dificuldade-alvo do perfil; sem repetir exercício na sessão;
   - mantida na URL ou em memória — **sem tabela nova e sem mudança de esquema**;
   - botão "Iniciar sessão" no dashboard e no Treino; "Próximo" no solucionador segue a fila; resumo ao final (resolvidos sozinho, com dica, errados; próxima revisão).
3. Atualização da seção 8 de `docs/METHODOLOGY.md` com as novas regras e limiares.

**Excluído explicitamente:** mudança de esquema ou migração; metas persistidas; novos tipos de exercício; mudanças na análise, nas explicações, nas aberturas ou no motor; gamificação (sequências, pontos); qualquer rating; IA generativa; backend.

**Arquivos prováveis:** `src/services/recommendations/recommend.ts`, `src/services/stats/stats.ts`, `src/services/training/session.ts` (novo), `src/features/dashboard/DashboardPage.tsx`, `src/features/training/TrainingPage.tsx`, `src/features/training/ExerciseSolver.tsx`, `src/features/training/useExerciseSession.ts`, `docs/METHODOLOGY.md`; testes em `tests/` e `e2e/`.

**Dependências:** nenhuma nova. Usa SRS (`scheduling/srs.ts`), perfil (`adaptation/skills.ts`), `themePerformance` e o registro de tentativas existentes. A regra de prática (repetição em menos de 10 minutos não conta como evidência) continua valendo.

**Critérios de aceitação:**
- Com um padrão recorrente e exercícios desse tema resolvidos de forma independente acima do limiar, a recomendação deixa de ser esse tema.
- Um padrão visto apenas em partidas fora da janela recente não é prioridade 1.
- Com revisões vencidas acima do limite, a recomendação é revisar, mesmo havendo padrão recorrente.
- A sessão tem no máximo `dailyGoal` itens, sem repetição, na ordem documentada, e é reproduzível para os mesmos dados.
- Concluir a sessão mostra um resumo coerente com as tentativas gravadas.
- Sem exercícios disponíveis, a sessão não começa e explica por quê.
- Nenhuma alteração em `database.ts`; backup e restauração inalterados.
- Suíte atual sem regressão (239 Vitest, 21 motor real, 28 E2E), mais os testes novos; CI verde.

**Testes necessários:** unitários para a janela recente, o critério de consolidação, a ordem de prioridade e o construtor da sessão (casos vazios, poucos exercícios, empates); E2E da sessão (iniciar no dashboard → resolver → próximo → resumo) em desktop e na emulação mobile; regressão da recomendação atual reescrita para as novas regras.

**Riscos e limitações:**
- Os limiares (janela, consolidação, limite de revisões) são heurísticos; precisam ser documentados e ficar fáceis de ajustar.
- Mudar a recomendação muda o que os E2E existentes esperam no dashboard; os testes afetados devem ser revistos explicitamente, não afrouxados.
- Com poucos exercícios gerados, a sessão pode ser curta; isso deve ser dito ao usuário, não preenchido com exercícios irrelevantes.
- O benefício pedagógico só é validável com uso real ao longo de dias.

## 8. Limitações desta auditoria

- Auditoria feita sobre o head do PR (`055f6e1`), não sobre a `main`, porque o merge não ocorreu.
- Nenhum teste em aparelho físico; desempenho em dispositivos fracos e tamanho real do banco em uso prolongado não foram medidos.
- A avaliação pedagógica é feita por leitura do código, dos testes e das auditorias das Sprints 3 e 3.1 — não houve teste com jogadores reais.
- O CI da `main` atual (`9c964de`) não foi consultado, por não representar o código auditado.

## 9. Arquivos analisados

`package.json`, `.github/workflows/ci.yml`, `playwright.config.ts`, `index.html`, `public/engine/*`; `src/services/engine/{UciEngine,engineService,workerTransport}.ts`, `src/hooks/useEngine.ts`; `src/services/analysis/{analysisRunner,gameAnalyzer}.ts`; `src/db/{database,analysisRepo,trainingRepo,openingsRepo}.ts`; `src/services/backup/backup.ts`; `src/services/scheduling/srs.ts`; `src/services/recommendations/recommend.ts`; `src/services/adaptation/skills.ts`; `src/services/stats/stats.ts`; `src/services/openings/{library,practice}.ts`; `src/features/dashboard/DashboardPage.tsx`; `src/features/training/{TrainingPage,ExerciseSolver,useExerciseSession}.ts(x)`; `src/features/analysis/ExplanationPanel.tsx`; `e2e/*.spec.ts`; `tests/persistence.test.ts`; `docs/{METHODOLOGY,AUDITORIA-SPRINT3,SPRINT3-RELATORIO,SPRINT3-1-RELATORIO}.md`.
