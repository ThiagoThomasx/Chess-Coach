# Sprint 4.8 — Uma análise, uma dona

| Campo | Valor |
|---|---|
| Branch | `feat/sprint4-8-single-owner`, criada de `main` em `4de7e4e` |
| Data | 2026-11-13 a 2026-11-15 |
| Origem | Auditoria estratégica pré-4.8 (entregue na conversa, sem arquivo) e escopo aprovado pelo usuário |
| Estado | **Sem commit.** Todo o trabalho está no working tree da branch; HEAD = `main` = `4de7e4e` |

Legenda: **[R]** reproduzido · **[C]** por inspeção de código · **[E]** resultado de execução · **[U]** informado pelo usuário.

## 1. Resumo executivo

**Objetivo:** nenhuma análise é duplicada, travada ou mostrada com um controle que não funciona, com qualquer número de abas; o histórico do jogador fica protegido contra perda silenciosa; e o ciclo análise ↔ exercício preserva o lance selecionado. Sem funcionalidade pedagógica nova, sem mudança de schema e sem dependência nova.

**Resultados:**
- T-1 (concorrência entre abas) resolvido com Web Locks do navegador, com E2E de duas abas reais e fallback idêntico ao anterior sem a API.
- O lance selecionado fica na URL; voltar de um exercício reabre o mesmo lance.
- N-1 (proteção de dados): armazenamento persistente pedido uma vez, data da última exportação de backup gravada só depois do download pedido, lembrete de 14 dias.
- FA-5 e as esperas fixas do E2E resolvidos; `measure:pedagogy` preparado para decidir o PD-4.
- Quatro revisões/auditorias independentes; todos os achados MEDIUM corrigidos com teste de regressão.
- Validação final [E]: Vitest **573** + 1 ignorado, motor real **24/24**, Playwright **95/95**, typecheck e build ok, cobertura de linhas 95,47%.
- Teste físico (procedimento 9) [U]: Samsung Galaxy S26, Android, **6 de 6 cenários aprovados**.

## 2. Escopo implementado

### T-1 — Propriedade exclusiva da análise (Web Locks)

- **Problema [R] (Sprint 4.7, reavaliado na auditoria pré-4.8):** ao abrir uma 2ª aba, `recoverInterruptedAnalyses` marcava como `paused`, por ~1,3 s, uma análise viva da 1ª aba, e "Retomar" nessa janela duplicava a execução. A auditoria encontrou ainda [C]: na 2ª aba, "Interromper" não fazia nada (`stopAnalysis` procura só nas execuções da própria aba); se a 1ª aba fechava, a 2ª ficava presa em "Analisando…" até recarregar.
- **Correção:**
  - `src/services/analysis/analysisLock.ts`: lock por partida (`chessquest.analysis.<gameId>`), `withAnalysisLock` (`ifAvailable`), `analysisOwner`, `heldAnalysisLocks`, `onAnalysisLockReleased` (vigia com `AbortSignal`) e `hasAnalysisLocks`;
  - `startAnalysis` roda a execução inteira, **derivação incluída**, segurando o lock; ocupado → `AnalysisElsewhereError` ("Esta partida já está sendo analisada em outra aba."), sem gravar nada;
  - `recoverInterruptedAnalyses(gameIds?)` só pausa registros `running` cujo lock está livre e que não mudaram desde a leitura (releitura na transação, por `updatedAt`);
  - tela: `useAnalysisOwner` + `controlView` (`AnalysisControls.tsx`) mostram "Analisando em outra aba…" sem botões; quando a outra aba termina ou fecha, a vigia recupera o registro e a tela oferece "Retomar" sem recarregar.
- **MEDIUM 2 da auditoria pré-encerramento [R]:** `reconcileDerivations` (abertura do app) só considerava a própria aba e refazia a derivação que outra aba ainda fazia. Agora pula os jogos com lock ocupado; sem a API, comportamento anterior.

### useAnalysisOwner — testes e correção do estado inicial

- 15 testes unitários (`tests/use-analysis-owner.test.ts`, jsdom + `tests/support/fakeLocks.ts`, um gerenciador de locks determinístico, porque o jsdom não tem `navigator.locks`).
- **Correção [R]:** antes da primeira resposta, o hook guardava `{ owner: 'unknown', status: undefined }`; numa partida sem análise (status `undefined`) tomava isso por uma consulta já feita e respondia "desconhecido" em vez de "verificando". O estado guardado agora começa vazio e só é reaproveitado se existir e for do status atual. Dois testes de regressão, vermelhos antes da correção. Sem efeito visível (sem análise não há `running`), mas a regra ficou correta.

### MEDIUM 1 — Controles presos depois de sair e voltar (`useActiveRun`)

- **Problema [R]:** `useState(isRunning(game.id))` só voltava a `false` dentro da instância que iniciou a análise. Ao sair da tela durante a análise e voltar, a nova instância ficava em "Analisando… / Interromper" depois do fim, até recarregar. Defeito **anterior à 4.8** (mesmo código na `main`), tornado mais frequente pelo retorno via `?ply`.
- **Correção:** `src/features/analysis/useActiveRun.ts` acompanha a execução existente (`currentRun(gameId)` no runner) e volta a `false` quando ela termina, com sucesso, pausa ou erro.

### Lance selecionado na URL

- `AnalysisPage.tsx` grava o lance em `?ply=` com `replace` (passar pelos lances não enche o histórico); `review=1` é lido na abertura (regra AC-2 preservada) e removido da URL. Funções puras `plyFromParams` e `paramsWithPly` em `navigation.ts`.
- Numa variante, a URL guarda o lance de origem; ao recarregar, abre a linha principal nesse lance.

### FA-5 — Inicialização testável

- As etapas de abertura saíram de `App.tsx` para `src/app/startup.ts` (`appStartupSteps`, `runStartupSteps`): mesma ordem, cada etapa isolada (uma falha não impede as seguintes).

### N-1 — Proteção de dados

- `src/services/backup/dataProtection.ts`:
  - `requestPersistentStorageOnce`: depois da primeira importação, pede `navigator.storage.persist()` uma única vez (`persistRequestedAt`); nunca lança erro;
  - `readBackupStatus` (só índices de tempo), `shouldRemindBackup` e `backupReminderText`: lembrete no painel com dados novos e 14 dias ou mais sem exportação (sem exportação, desde a primeira partida importada).
- `backup.ts`: `exportBackup` só lê; `exportBackupFile` gera o arquivo, pede o download e **só então** grava `lastBackupAt` (limitada ao momento atual); `restoreBackup` grava a data de exportação do arquivo dentro da própria transação.
- `DataPanel.tsx`: "Última exportação de backup", nota explicando que o navegador não informa se o arquivo foi salvo, e mensagem de falha que diz que a data não mudou.
- Dois campos opcionais em `Settings` (`lastBackupAt`, `persistRequestedAt`); sem mudança de schema.

### measure:pedagogy

- Por objetivo do exercício: parcela de raízes "no limite" (todas as linhas da busca aceitas, então pode haver mais lances aceitáveis) e perda das alternativas aceitas em buckets (≤1, 1–3, 3–5, >5 p.p.). Funções em `tests/support/pedagogyMetrics.ts`, com testes.
- Nos dois fixtures [E] (profundidade 14): 2 exercícios de defesa, 100% ambíguos, **100% no limite** das 3 linhas; perdas das alternativas `{"1–3": 3, "≤1": 1}`. Isso mostra que o "3 aceitos" da 4.7 refletia o MultiPV, não a tolerância. **Não sustenta conclusão sobre o PD-4.**

### Esperas fixas no E2E

- As cinco esperas `waitForTimeout` (`mvp.spec.ts`, `audit-sprint4-6.spec.ts`) foram trocadas por esperas por evidência na página (peça da resposta no tabuleiro, botão de marcação, registro gravado). Não resta `waitForTimeout` em `e2e/`.

## 3. Decisões técnicas

| Decisão | Motivo |
|---|---|
| **Web Locks** (`navigator.locks`) por partida, com `ifAvailable` ao iniciar | Nativo do navegador: o lock é liberado sozinho quando a execução termina ou a aba fecha, então "`running` gravado com lock livre" significa execução órfã. Sem dependência, sem servidor, sem heartbeat no banco (`BroadcastChannel` ou heartbeat seriam mais complexos sem ganho) |
| **Sem suporte à API** | `hasAnalysisLocks()` falso: nenhum lock, dono "desconhecido", todo `running` conta como interrompido na abertura. É exatamente o comportamento anterior à 4.8 (testado com o gerenciador nulo) |
| **"Última exportação de backup"** | A data significa "última exportação iniciada com sucesso", não "arquivo salvo": o navegador não informa se o arquivo foi gravado no dispositivo. É gravada depois de gerar o arquivo e pedir o download; numa restauração, é a data de exportação do arquivo (limitada ao momento atual, para um relógio adiantado não calar o lembrete) |
| **Respostas atrasadas no hook** | A resposta da consulta é guardada junto com o status para o qual foi feita; uma resposta de outro status nunca é mostrada ("verificando" até a nova chegar). Uma consulta cancelada (troca de partida, desmontagem) é ignorada, e a vigia do lock é cancelada por `AbortSignal` |
| **PX-2 e PD-4** | Não implementados: dependem de PGNs reais do jogador. A 4.8 só preparou a medição (PD-4); a decisão fica para depois da coleta |
| **Exceção dos 80% e escopo pedagógico** | Inalterados (decisões da 4.7 mantidas) |

## 4. Revisões e auditorias independentes

Todas por revisores separados, somente leitura. Nenhum achado CRITICAL ou HIGH em nenhuma delas.

| Etapa | Achado | Sev. | Situação |
|---|---|---|---|
| Revisão da implementação inicial | Na 2ª aba, "Interromper" aparecia por um instante antes de o dono ser conhecido | MEDIUM | **Corrigido**: estado "verificando", sem botões para um `running` |
| | Janela residual: a vigia segura o lock por um instante depois da liberação | MEDIUM→LOW | **Aceito** (ver §7) |
| | Data de backup no futuro calaria o lembrete; data gravada antes do download | MEDIUM | **Corrigidos**: limite ao momento atual; nova semântica de exportação (etapa N-1) |
| Revisão dos testes do hook | Verificação negativa fraca (um tick) no teste de cancelamento | MEDIUM | **Corrigido**: janela nomeada `QUIET_MS` e contagem de consultas |
| | Nenhum teste provava que só a partida vigiada é recuperada | MEDIUM | **Corrigido**: teste novo com duas partidas |
| | Intermitência encontrada na verificação de estabilidade (3/20): um teste deixava uma recuperação viva que consultava o gerenciador do teste seguinte | — | **Corrigido**: estado do fake coerente com a resposta; 40/40 depois |
| | Estado inicial do hook com status `undefined` | LOW | **Corrigido** (ver §2) |
| Auditoria pré-encerramento | MEDIUM 1: controles presos depois de sair e voltar | MEDIUM | **Corrigido** (`useActiveRun`) |
| | MEDIUM 2: `reconcileDerivations` ignorava o lock de outra aba | MEDIUM | **Corrigido** |
| Auditoria pós-correções | `ARCHITECTURE.md`, decisão 7, ainda diz "persistência após cada posição" (desatualizado desde a 4.6) | LOW | Aberto (não introduzido pela 4.8) |
| | `changeUserColor` deriva sem consultar o lock de outra aba | LOW | Aberto (anterior à 4.8; autocorrigível) |

**Evidências dos testes de regressão [E]:**
- testes escritos antes das correções e vermelhos primeiro: lock e recuperação, N-1 (6 de 11 testes de exportação), estado inicial do hook (2), MEDIUM 2 (1); o MEDIUM 1 foi reproduzido por E2E no navegador real (status preso em "Analisando…") antes da correção;
- partes em que o código veio antes do teste (registrado na época): extração das etapas de abertura e métricas da medição.

**Mutações (temporárias, código restaurado e conferido depois de cada uma) [E]:**

| Alvo | Mutação | Resultado |
|---|---|---|
| Recuperação na abertura | Ignorar o lock ao pausar órfãs | E2E `two-tabs` falha |
| URL | Desligar a gravação do `?ply` | 3 E2E de `analysis-url` falham |
| `useAnalysisOwner` | 10 mutações (sem "verificando", resposta de outro status, sem cancelamento, sem cancelar a vigia, sem recuperação, sem nova verificação, consulta com a análise ativa, recuperar todas as partidas, vigiar sem dono, estado inicial antigo) | **10/10 detectadas** |
| `useActiveRun` | Não acompanhar a execução existente | 2 de 4 testes falham |

**Estabilidade:** testes do hook 30/30 e 40/40 em execuções com ordem aleatória; E2E de duas abas, URL, proteção de dados e os alterados por esperas fixas repetidos 5× sem falha; `analysis-remount.spec.ts` não foi repetido isoladamente (passou na própria verificação e nas rodadas completas).

## 5. Validação automatizada

### Rodada final (única e sequencial) [E]

2026-11-14, das 15:19:38Z às 15:24:25Z, HEAD `4de7e4e`, scripts do `package.json`. Nenhum arquivo de código, teste ou documentação foi alterado depois do início desta rodada.

| Verificação | Script | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | ok |
| Vitest | `npm test` | **573 aprovados, 0 falhos, 1 ignorado** (39 arquivos + 1 ignorado) |
| Stockfish real | `npm run test:engine` | **24/24** |
| Cobertura (`src/services`, `src/db`) | `npm run coverage` | linhas **95,47%** (2259/2366) · statements **92,22%** (2741/2972) · branches **84,72%** (2086/2462) · funções **90,10%** (601/667) |
| Build | `npm run build` | ok |
| Playwright | `npm run test:e2e` | **95/95**, sem retentativa |

O teste ignorado continua sendo a medição pedagógica, que só roda com `CORPUS_PGN`. Arquivos do motor conferidos em 2026-11-15: idênticos aos de `node_modules/stockfish/bin`.

### Execuções descartadas [E]

Duas rodadas completas anteriores foram executadas ao mesmo tempo, por erro de coordenação; o `npm run build` de uma reescreveu `dist/` enquanto o servidor de preview da outra o servia. Uma terminou com Playwright 93 aprovados e 2 falhos (`progress-trend.spec.ts:78`, `sequence.spec.ts:80`); a outra não iniciou o E2E (porta 4176 ocupada). As duas foram descartadas. Os dois testes passaram 10/10 em 5 repetições sem concorrência e na rodada final.

### Evolução (histórico, não são os resultados finais)

- Vitest: 497 (baseline) → 541 (implementação) → 552 (semântica N-1) → 564/565 (testes do hook) → 567 (estado inicial) → **573**;
- Playwright: 86 → 93 → 94 → **95**;
- motor real: 24 → 24.

A cobertura oficial mede só `src/services` e `src/db`: os hooks da tela (`useAnalysisOwner`, `useActiveRun`) ficam fora do número; a garantia deles vem dos testes unitários, das mutações e dos E2E.

## 6. Teste físico (procedimento 9 da baseline)

| Campo | Valor |
|---|---|
| Procedimento | 9: celular físico numa origem separada (configuração `chessquest-phone`, porta 4180), sem usar os dados de `localhost:5173` |
| Servidor | build de produção atual (`vite preview --host --port 4180`), conferido antes do teste: os textos e o lock da 4.8 estavam em `dist/` e, no navegador do computador, a página abriu sem erros no console; endereço na rede local `http://192.168.0.16:4180`; desligado depois do teste |
| Dispositivo [U] | Samsung Galaxy S26 |
| Sistema [U] | Android |
| Navegador e versão | **Não informados** |
| Resultado [U] | **6 de 6 cenários aprovados**, nenhuma falha nem observação adicional |

| Cenário [U] | Resultado |
|---|---|
| Importação de PGN e solicitação de armazenamento persistente | PASSOU |
| Sair e voltar durante a análise, com atualização sem recarregar | PASSOU |
| Retorno do exercício ao mesmo lance da análise | PASSOU |
| Duas abas: bloqueio da segunda e retomada após fechar a primeira | PASSOU |
| Exportação, arquivo JSON válido e restauração | PASSOU |
| Layout em orientação vertical e horizontal, sem rolagem horizontal | PASSOU |

Limites: o teste cobre um aparelho e um navegador (não identificado). O arquivo JSON foi considerado válido pelo usuário nesse aparelho; o app em si continua registrando só que o download foi pedido. A resposta do navegador ao pedido de persistência (concedido ou não) não foi informada. Tablet (débito 3, 768 px) e Safari/iOS não foram testados fisicamente.

## 7. Débitos remanescentes

| Item | Situação | Justificativa |
|---|---|---|
| T-1 | **Resolvido** | Web Locks, E2E de duas abas, teste físico |
| FA-5 | **Resolvido** | `startup.ts` com testes; a parte do solucionador já fora resolvida na 4.6 |
| Navegação de volta do exercício | **Resolvido** | `?ply` na URL, E2E e teste físico |
| Esperas fixas no E2E | **Resolvido** | Nenhum `waitForTimeout` em `e2e/`. Os `setTimeout` dos testes unitários provocam corridas de propósito; `QUIET_MS` (50 ms) é usado só em verificações negativas do hook e está documentado |
| Janela residual do Web Lock | **Aberto (aceito, LOW)** | Por um instante depois da liberação, iniciar pode ser recusado ("em outra aba") e o dono aparecer como "outra aba"; com 3 abas ou mais a recuperação pode esperar a última vigia. Sem perda de dados; tentar de novo funciona |
| PX-2 | **Investigativo** | Depende de rodar `measure:pedagogy` num PGN real do jogador e anotar uma amostra dos erros "limitados" |
| PD-4 | **Investigativo** | A ferramenta já mede limite e perda das alternativas; falta a coleta real. Os fixtures não sustentam conclusão |
| PD-5 | **Adiado** | Limitação de desenho: só faz sentido com geração de posições novas |
| PD-6 | **Aberto (cosmético)** | Jargão "p.p." ainda em 10 textos, dois deles no feedback principal |
| N-1 | **Resolvido** | Com ressalvas LOW abaixo |
| Download do backup (revogação imediata do endereço) | **Aberto (LOW)** | Funciona no Chrome/Firefox atuais e passou no teste físico; navegadores antigos (Safari/Firefox) podem falhar |
| Precisão do lembrete de backup | **Aberto (LOW)** | Repertório, aberturas personalizadas e exclusões não contam como dado novo; restauração parcial grava a data. Conservador, sem perda |
| Mensagem se gravar a data falhar depois do download | **Aberto (LOW)** | Diz "não foi possível exportar" embora o download tenha sido pedido |
| `afterRead` na assinatura pública de `recoverInterruptedAnalyses` | **Aberto (LOW)** | Ponto de teste exposto; estilo |
| E2E da data do backup | **Aberto (LOW)** | Compara a data do Node com a do navegador; falharia exatamente na virada da meia-noite |
| `changeUserColor` sem consultar o lock de outra aba | **Aberto (LOW)** | Anterior à 4.8; `markDerived` e a deduplicação corrigem |
| `ARCHITECTURE.md`, decisão 7 | **Aberto (LOW, documental)** | Diz "persistência após cada posição"; desde a 4.6 é no máximo a cada 2 s |
| Disco cheio | **Aceito** | Registro preso em `running` com lock livre é pausado na próxima abertura (agora também pela vigia da outra aba) |
| PX-6, T-2, T-3, FA-2 | **Adiados** | Fora do escopo; sem mudança |
| AC-10, AC-11, L4, L5 | **Descartados como débitos ativos** | Aceitos e documentados |
| Débitos 2, 3, 4 e 7 | **Adiados** | Como na baseline (3 depende de decidir se tablet é alvo; 7 depende de dependência nova) |

## 8. Arquivos alterados

**Produção, modificados**

| Arquivo | Responsabilidade na 4.8 |
|---|---|
| `src/app/App.tsx` | Chama `runStartupSteps(appStartupSteps())` |
| `src/db/analysisRepo.ts` | `recoverInterruptedAnalyses(gameIds?)` respeita o lock e relê na transação |
| `src/services/analysis/analysisRunner.ts` | Execução inteira sob o lock, `AnalysisElsewhereError`, `currentRun`, `reconcileDerivations` respeita o lock |
| `src/features/analysis/AnalysisControls.tsx` | Usa `useActiveRun`, `useAnalysisOwner` e `controlView`; estado "em outra aba" |
| `src/features/analysis/AnalysisPage.tsx` | Lance selecionado ↔ `?ply` (replace); `review=1` removido depois de lido |
| `src/features/analysis/navigation.ts` | `plyFromParams`, `paramsWithPly` |
| `src/features/dashboard/DashboardPage.tsx` | Lembrete de backup |
| `src/features/games/ImportPanel.tsx` | Pedido de armazenamento persistente depois da primeira importação |
| `src/features/settings/DataPanel.tsx` | Exportação com `exportBackupFile`, "Última exportação de backup", mensagens de sucesso e falha |
| `src/services/backup/backup.ts` | `exportBackup` só lê; `exportBackupFile`, `backupFileName`; data gravada na restauração |
| `src/types/domain.ts` | `lastBackupAt?`, `persistRequestedAt?` em `Settings` |

**Produção, novos:** `src/app/startup.ts`, `src/services/analysis/analysisLock.ts`, `src/features/analysis/useAnalysisOwner.ts`, `src/features/analysis/useActiveRun.ts`, `src/services/backup/dataProtection.ts`.

**Testes unitários novos (76 testes):** `tests/analysis-lock.test.ts` (21), `tests/use-analysis-owner.test.ts` (15), `tests/data-protection.test.ts` (12), `tests/backup-export.test.ts` (11), `tests/analysis-url.test.ts` (6), `tests/startup.test.ts` (4), `tests/use-active-run.test.ts` (4), `tests/pedagogy-metrics.test.ts` (3); apoio: `tests/support/fakeLocks.ts`, `tests/support/pedagogyMetrics.ts`.

**E2E:** novos (9 testes) `e2e/two-tabs.spec.ts` (2), `e2e/analysis-url.spec.ts` (3), `e2e/data-protection.spec.ts` (3), `e2e/analysis-remount.spec.ts` (1); modificados `e2e/mvp.spec.ts` e `e2e/audit-sprint4-6.spec.ts` (esperas fixas), `e2e/exercise-origin.spec.ts` (verifica que a volta reabre o lance, em vez de clicar nele de novo).

**Ferramenta:** `tests/measure/pedagogy-corpus.test.ts`.

**Documentação:** `README.md` (backup, lembrete, persistência, várias abas), `docs/ARCHITECTURE.md` (decisão 14 e fluxo da tela e da abertura), este relatório. `docs/BASELINE-MAIN.md` não foi alterada: descreve a `main` e é atualizada depois do merge; o procedimento 9 não tem campo de registro de execução.

Sem mudança em `package.json`, dependências, configurações ou schema. Nenhuma chamada de rede nova.

## 9. Conclusão

A Sprint 4.8 está **tecnicamente concluída**: escopo aprovado implementado, todos os achados MEDIUM das revisões corrigidos com teste, rodada final de validação completa verde e teste físico aprovado em 6 de 6 cenários.

**Limitações:** a janela residual do Web Lock; o comportamento sem a API é o anterior à 4.8; a data da última exportação não prova que o arquivo foi salvo; o teste físico cobre um aparelho Android e um navegador não identificado; os LOWs da §7.

**Fora do escopo:** decisões pedagógicas PX-2 e PD-4 (dependem de coleta com PGNs reais), PD-5, PD-6, PX-6, T-2, T-3, FA-2 e os débitos herdados 2, 3, 4 e 7.

**Próxima etapa:** integração (commit, PR, CI e merge), mediante autorização do usuário; depois do merge, atualizar `docs/BASELINE-MAIN.md` com os números desta sprint.
