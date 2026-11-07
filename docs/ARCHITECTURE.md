# Decisões de arquitetura

| # | Decisão | Motivo |
|---|---|---|
| 1 | **Vite 8 + React 19 + TypeScript 7 (strict, `noUncheckedIndexedAccess`)** | Stack pedida; versões estáveis atuais e compatíveis entre si. |
| 2 | **Stockfish 19 lite single-threaded (WASM)** do pacote npm `stockfish`, copiado para `public/engine/` por `scripts/copy-engine.mjs` | ~1,8 MB; não exige cabeçalhos COOP/COEP (o multi-thread exige), funciona em qualquer host estático e offline. A versão completa tem ~100 MB. |
| 3 | **`UciEngine` independente de transporte** (`EngineTransport`) | O mesmo driver roda com Web Worker no navegador, com um transporte falso nos testes unitários e com um processo Node nos testes de integração com o motor real. React não fala UCI. |
| 4 | **Fila FIFO, um job por vez** no `UciEngine`; `stop()` devolve resultado parcial marcado `complete:false`; `cancelAll()` rejeita com `code: 'cancelled'` | Evita dezenas de análises simultâneas e nunca confunde análise interrompida com definitiva. |
| 5 | **Avaliações armazenadas no ponto de vista das brancas**; comparação sempre no ponto de vista de quem moveu | Elimina erros de sinal entre posições. |
| 6 | **Uma busca por posição** (n+1 buscas por partida), reaproveitando a linha do lance jogado quando ele está no MultiPV | Metade do custo de analisar "antes e depois" separadamente, e comparações na mesma profundidade quando possível. |
| 7 | **Persistência após cada posição** + status `paused` para análises interrompidas (inclusive aba fechada) | Retomada sem perda; partidas nunca dependem do sucesso da análise. |
| 8 | **Dexie (IndexedDB) com repositórios** em `src/db/`, histórico de esquema explícito (`SCHEMA_VERSIONS`, uma entrada por versão) | Acesso a dados encapsulado; `dexie-react-hooks` fornece consultas reativas na interface. |
| 9 | **Perfil de competências derivado de eventos** (`skillEvents`), não armazenado | Sem dados redundantes; recalculável, auditável e rastreável. Eventos de partidas são substituídos ao reanalisar (idempotente). |
| 10 | **Classificação ≠ explicação ≠ seleção de exercícios ≠ solução** em módulos separados (`analysis/classify`, `pedagogy/`, `exercises/generate`, `exercises/validate`) | Regras testáveis isoladamente e templates fora da interface. |
| 11 | **HashRouter** e rotas com `lazy()` | Funciona servido de qualquer pasta estática sem reescrita de URL; bundle inicial menor. |
| 12 | **Sem fontes externas**: pilhas de fontes do sistema (serifada para títulos, sans para UI, mono para notação) | Funciona offline e sem CDNs. |
| 13 | **Testes do motor real via processo filho** (`tests/support/sf-bridge.cjs`) | A detecção de Node do build WASM falha dentro do Vitest; um processo filho roda o mesmo arquivo do motor sem alterações. |

## Fluxo de dados da análise

```
GamesPage ── importPgn ──▶ db.games
AnalysisPage ── startAnalysis ──▶ analyzeGame (puro)
                                   ├─ terminalAnalysis | dbEvalCache | UciEngine.analyze (Worker)
                                   ├─ buildReviews → reviewMove → classifyMove
                                   └─ onProgress → db.analyses (a cada posição)
             concluída ──▶ deriveFromAnalysis (também ao definir a cor: changeUserColor)
                                   ├─ eventsFromGame → db.skillEvents
                                   └─ selectExercisePositions → buildExercise → db.exercises
ExerciseSolver ── validateStep / judgeWithEngine ──▶ recordAttempt (attempts + srs + skillEvents, 1 transação)
Dashboard/Evolução ── useLiveQuery ──▶ estimateProfile, stats, nextTraining
```

## Extensões previstas

- **Jogar contra o computador**: novo recurso usando `UciEngine.analyze({ movetimeMs })` + `UCI_LimitStrength`; nenhuma mudança no driver.
- **Novas versões do esquema** (corrigido na Sprint 4.3): **acrescentar** uma entrada ao fim de `SCHEMA_VERSIONS` em `db/database.ts`, com só as tabelas que mudam e, se preciso, um `upgrade`. `SCHEMA_VERSION` acompanha a última entrada sozinho (o backup recusa versões futuras). Nunca editar nem remover uma entrada existente, e nunca mover a lista completa de tabelas para a versão nova: um banco em versão anterior passaria por uma versão sem as tabelas e perderia as linhas. Toda mudança precisa de teste de upgrade a partir de bancos v1 e v2 com dados (modelo em `tests/persistence.test.ts`, bloco "schema migration").
