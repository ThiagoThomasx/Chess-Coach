# Sprint 4.6, etapa 2 — PA-1, B3, FA-3 e FA-4

| Campo | Valor |
|---|---|
| Branch | `feat/sprint4-6-understand-mistakes` (criada de `main` em `302f7a9`) |
| HEAD | `302f7a9`. Tudo nesta etapa, assim como a B1, está **sem commit** |
| Data | 2026-11-08 |
| Planejamento | `SPRINT4-6-PLANEJAMENTO.md` (Alternativa B); achados de origem em `POST-SPRINT4-5-AUDITORIA.md` |

B2 não foi implementado nesta etapa; ele veio depois (`SPRINT4-6-B2-RELATORIO.md`). Esta etapa não fez commit, push, PR nem merge. As contagens de testes abaixo são as desta etapa; as finais da sprint estão em `SPRINT4-6-PREPARACAO-INTEGRACAO.md`.

## 1. Problemas de origem

| Item | Problema |
|---|---|
| PA-1 (P2) | Cada posição analisada regravava a `GameAnalysis` inteira. Cada gravação fazia as telas abertas relerem **todas** as análises com suas `positions`: Partidas, que só precisa do status; painel; Evolução; treino. O custo crescia com posições × tamanho da biblioteca |
| B3 (PX-4/PX-5) | Não havia resposta para "minhas partidas estão melhorando?", e "Análises feitas por dia" media uso do app, não qualidade das partidas |
| FA-3 (P3) | Toda evidência de partida era lida em UTC. Uma partida sem data no PGN importada às 23h30 de Brasília aparecia no dia seguinte. O mês da linha histórica também era sempre lido em UTC, então um exercício de 31/10 às 22h aparecia como "11/2026" |
| FA-4 (P3) | "Pendentes (N)" na tela Treinar não acompanhava o relógio |

## 2. Decisões de implementação

### PA-1

1. **Gravação com intervalo mínimo, sem timers.**
   - `progressSaver` (`src/services/analysis/progressSaver.ts`) grava a primeira atualização na hora e depois no máximo uma a cada `PROGRESS_SAVE_INTERVAL_MS`, que é 2000 ms.
   - Atualizações dentro do intervalo são agrupadas. A mais recente nunca se perde, porque o runner grava o resultado final (concluída, pausada ou erro) incondicionalmente ao fim do laço, e esse resultado contém todas as posições.
   - Não há timer, então nada pode ser gravado depois do fim da execução.
   - `analyzeGame` aguarda cada `onProgress` antes da próxima posição. Por isso as gravações nunca se sobrepõem nem chegam fora de ordem.
2. **Escolha do intervalo.** Medi o Stockfish 19 lite real na profundidade 16 com MultiPV 3, os padrões do app, em 41 posições (Ópera e a partida curta das fixtures):

   | média | p10 | mediana | p90 | máx. |
   |---|---|---|---|---|
   | 1332 ms | 278 ms | 786 ms | 1843 ms | 13232 ms |

   O valor de 2 s fica perto do p90: mantém cerca de uma gravação por posição lenta e agrupa as rápidas (cache, posições finais). Uma aba fechada entre duas gravações não perde trabalho do motor, porque cada busca concluída já vai para o `evalCache` antes do `onProgress`. Na retomada, essas posições saem do cache.
3. **A tela de análise continua ao vivo.**
   - O runner continua emitindo eventos em memória a cada posição.
   - `useLiveAnalysis` (`src/features/analysis/useLiveAnalysis.ts`) combina o registro gravado com o último evento e mostra o mais novo por `updatedAt`. No empate vence o registro gravado, que pode ter a marca de derivação.
4. **Consultas leves, sem mudança de schema.**
   - `analysisStatuses()` percorre só o índice `status` (`orderBy('status').eachKey`). Nenhum registro é lido ou clonado. A lista de Partidas usa essa consulta.
   - `listCompleteAnalyses()` usa `where('status').equals('complete')`. Painel, Evolução, treino e `reconcileDerivations` passam a carregar só análises concluídas, que é o que `toAnalyzedInputs` já filtrava.
   - A tela de análise continua lendo o registro completo.

### B3

- **Cálculo.** A função pura `seriousErrorTrend` (`src/services/stats/stats.ts`) devolve as duas médias, a diferença, a direção, o tamanho das janelas e `singleErrorDecides`. A regra completa está em `METHODOLOGY.md` §8:
  - erros graves por partida = lances do usuário com `mistake` ou `blunder` ÷ partidas;
  - só partidas concluídas com cor definida;
  - ordem por `gameTime`, com as sem data no início, reaproveitando `recentGames`; `importedAt` só desempata;
  - janelas de N recentes contra as N anteriores: N = 10 a partir de 20 partidas, N = ⌊total/2⌋ entre 6 e 19 (com total ímpar, a mais antiga fica de fora);
  - limiar de 0,3 sobre a diferença arredondada a 3 casas;
  - menos de 6 partidas → "Sem partidas suficientes".
- **Interface.**
  - `GameTrend.tsx` substitui "Análises feitas por dia" e fica logo abaixo dos números do topo da Evolução.
  - Mostra as duas médias em ordem temporal (anteriores → últimas), a direção com o texto definido no pedido, o tamanho das amostras e uma explicação curta. Diz explicitamente que mostra uma tendência, não a causa dela.
- **Amostra pequena (revisão M1).**
  - Com 3 partidas por grupo, um único erro muda a média em 0,33, acima do limiar.
  - O resultado sinaliza isso (`singleErrorDecides`). A direção aparece sem a cor de melhora ou piora, acompanhada do aviso "Amostra pequena".
  - Os números (mínimo 6, limiar 0,3) seguem os do pedido.
- **Código removido.** `analysesOverTime` e `CountByDayChart` saíram, porque ficaram sem uso.

### FA-3

- **Regra.** `isUtcCalendarDate(t)` (`gameDate.ts`) identifica uma data do PGN como `gameTime` a grava: 00:00:00.000 UTC. Só essas datas são lidas em UTC. Importação, exercícios e evidência de partida sem data no PGN são instantes reais e usam o calendário local.
- **Onde se aplica:**
  - `evidenceDayKey`: dia do gráfico por competência;
  - `calendarMonthYear`: mês da linha "Diagnóstico histórico", em `SkillProfile`;
  - nome do arquivo de backup: `DataPanel` agora usa o dia local.
- **Persistência.** Nenhuma data gravada foi alterada.

### FA-4

`TrainingPage` usa o `useMinute()` existente, o mesmo relógio da barra lateral e do painel. A regra de "Pendentes" não mudou, e nada é gravado.

## 3. Arquivos alterados nesta etapa

| Tipo | Arquivos |
|---|---|
| Novos | `src/services/analysis/progressSaver.ts`, `src/features/analysis/useLiveAnalysis.ts`, `src/features/progress/GameTrend.tsx`, `tests/analysis-progress.test.ts`, `tests/pa1-measurement.test.ts`, `tests/game-trend.test.ts`, `e2e/progress-trend.spec.ts`, este relatório |
| Alterados | `src/services/analysis/analysisRunner.ts`, `src/db/analysisRepo.ts`, `src/features/analysis/AnalysisPage.tsx`, `src/features/games/GamesPage.tsx`, `src/features/dashboard/DashboardPage.tsx`, `src/features/progress/ProgressPage.tsx`, `src/features/progress/ProgressCharts.tsx`, `src/features/progress/SkillProfile.tsx`, `src/features/settings/DataPanel.tsx`, `src/features/training/TrainingPage.tsx`, `src/features/training/useTrainingLoop.ts`, `src/services/games/gameDate.ts`, `src/services/stats/stats.ts`, `src/styles/features.css`, `tests/evidence-dates.test.ts`, `e2e/consistency.spec.ts`, `docs/METHODOLOGY.md`, `docs/ARCHITECTURE.md`, `docs/SPRINT4-6-PLANEJAMENTO.md` |

Os arquivos da B1 continuam como estavam: `refutation.ts`, `sequence.ts`, `useExerciseSession.ts`, `ExerciseSolver.tsx` e `BoardLegend.tsx`. Os testes da B1 seguem verdes.

## 4. Antes e depois

| Situação | Antes | Depois |
|---|---|---|
| Análise de 80 meias-jogadas no ritmo mediano | 82 gravações (uma por posição + final) | 28 gravações |
| Reanálise servida pelo cache | 82 gravações | 2 (primeira + final) |
| Lista de Partidas durante uma análise | relia todas as análises com `positions` a cada gravação | lê só o índice de status: 0 registros |
| Painel/Evolução/treino durante uma análise | reexecutavam a cada gravação | não reexecutam: a linha em andamento não é `complete` |
| Barra de progresso na tela de análise | atualizava a cada gravação | atualiza a cada posição, pelo evento em memória |
| Evolução | "Análises feitas por dia" | "Minhas partidas estão melhorando?" |
| Evidência sem data no PGN importada às 23h30 (Brasília) | dia seguinte | mesmo dia |
| "Pendentes (N)" com a tela aberta | parado | atualiza a cada minuto |

## 5. Critérios de aceite

| Critério | Verificado por |
|---|---|
| Atualizações intermediárias agrupadas | `analysis-progress`: menos gravações que metade das posições; `progressSaver` com relógio controlado |
| Conclusão, pausa e falha gravam o estado mais recente | `analysis-progress`: pausa e falha comparam as posições gravadas com as do resultado |
| Cancelamento e retomada | `analysis-progress`: busca cancelada → pausada; a retomada completa sem refazer posições já feitas |
| Nenhuma gravação atrasada | `analysis-progress`: nenhuma gravação depois do fim, mesmo avançando o relógio 60 s |
| Status sem `positions` | `analysis-progress` e `pa1-measurement`: hook `reading` do Dexie com 0 leituras |
| Consulta completa na tela de análise | `AnalysisPage` continua com o registro completo; E2E de análise (`mvp.spec`, `clarity.spec`) verdes |
| Medição antes/depois | §6 |
| Sem mudança de schema | `database.ts` não foi tocado |
| B3: função pura, só lances do usuário, só `mistake`/`blunder`, ordem por `gameTime`, sem data no início, sem cor excluída, janelas corretas, < 6 insuficiente, limiar 0,3 (abaixo, igual, acima) | `game-trend`: 13 testes cobrindo 0, 5, 6, 8, 19 e 20 partidas, partidas sem data, partidas sem cor, só erros do adversário, nenhum erro grave, Pretas e 0,3 exato |
| B3: interface com valores, direção e amostra; gráfico antigo removido | `progress-trend.spec`: 8 E2E, incluindo 375, 390, 430 e 768 px sem rolagem horizontal |
| FA-3: partida, importação, exercício, virada de dia e de mês, fuso de São Paulo | `evidence-dates`: 3 testes novos com `TZ=America/Sao_Paulo` e datas fixas |
| FA-4: relógio simulado; exercício já vencido, que vence em 1 min, que vence em 4 min; nenhuma tentativa, evidência ou agenda alterada | `consistency.spec`: último teste |

Nenhum critério ficou sem verificação.

## 6. Medição do PA-1

**Reprodução:**

```bash
PA1_REPORT_FILE=pa1.json npx vitest run tests/pa1-measurement.test.ts
```

As asserções usam só contagens (estáveis). Os tempos vão apenas para o arquivo.

**Cenário:**

| Parâmetro | Valor |
|---|---|
| Partidas analisadas | 200 (1 em andamento, 199 concluídas) |
| Partida sintética | determinística, 80 meias-jogadas (81 posições) |
| Linhas por posição | 3, com 12 meias-jogadas cada |
| Tamanho de uma análise | ≈ 90,7 kB (JSON) |
| Motor | sintético, avançando o relógio 786 ms por posição (a mediana medida) ou 0 ms (cache) |
| Atualizações de progresso por análise | 81 |
| Banco | `fake-indexeddb` |

**Resultados:**

| Medida | Antes | Depois |
|---|---|---|
| Gravações, análise nova | 82 | 28 |
| Bytes gravados, análise nova | 3,85 MB | 1,31 MB |
| Gravações, reanálise pelo cache | 82 | 2 |
| Bytes gravados, reanálise pelo cache | 3,84 MB | 0,09 MB |
| Consulta de status: registros lidos | 200 | 0 |
| Consulta de status: bytes lidos | 18,1 MB | 0 |
| Consulta de status: tempo* | 261 ms | 23 ms |
| Consulta das telas de estatística: registros lidos | 200 | 199 (só concluídas) |
| Reexecuções da consulta de toda a tabela por 20 gravações da análise em andamento | 20 | — |
| Reexecuções da consulta de concluídas por essas mesmas 20 gravações | — | 0 |
| Reexecuções da consulta de status por essas mesmas 20 gravações (0 registros lidos em cada) | — | 20 |

\* `fake-indexeddb` no Node, uma execução: só ordem de grandeza.

**Efeito combinado numa análise nova com a lista de Partidas aberta:**
- antes: 82 gravações × 200 análises relidas ≈ 1,5 GB clonados;
- depois: 28 gravações × 0 registros.

Painel e Evolução abertos passam de 82 releituras completas para nenhuma.

**Limitações da medição:**
- Os tempos são do `fake-indexeddb`, não do IndexedDB do navegador. A comparação de tempo é indicativa; a evidência principal são as contagens.
- O tamanho da linha `pv` do motor real varia. A sintética usa 12 meias-jogadas.
- Ao trocar uma análise de `complete` para outro status, ou o contrário, a consulta de concluídas ainda reexecuta. Isso é raro (início e fim de execução).

## 7. Resultados de validação

| Suíte | Resultado | Antes desta etapa |
|---|---|---|
| Typecheck | ok | ok |
| Vitest | **454/454** (28 arquivos) | 420 |
| Stockfish real, isolado | **24/24** | 24 |
| Build | ok | ok |
| Playwright | **69/69** | 60 |
| Cobertura (`src/services`, `src/db`) | linhas 94,41% · statements 91,27% · branches 84,07% · funções 88,79% | 93,88% · 90,58% · 83,47% · 87,45% |

## 8. Revisão independente

Um revisor separado leu o diff com o checklist do pedido. O resultado foi 0 CRITICAL, 0 HIGH, 1 MEDIUM (corrigido) e 3 LOW.

| # | Sev. | Achado | Tratamento |
|---|---|---|---|
| M1 | MEDIUM | Com 6–7 partidas (3 por grupo), um único erro decide a direção e aparece como melhora ou piora | **Corrigido**: `singleErrorDecides`, direção sem a cor e aviso "Amostra pequena"; unitário e E2E novos |
| L1 | LOW | `useLiveAnalysis`: numa pausa ou erro, por um quadro a tela pode voltar ao último registro gravado (até ~2 s de posições a menos) antes de a consulta trazer o estado final | Mantido: é só visual e se corrige sozinho na mesma atualização; os dados estão certos |
| L2 | LOW | Se a análise for apagada durante a execução, a tela mostra a versão em memória até o fim | Mantido: apagar a partida já leva a "Partida não encontrada"; limpar análises durante uma execução é raro |
| L3 | LOW | Em Treinar, `now` fica fixo por até 1 minuto | Mantido: é o mesmo atraso aceito na barra lateral e no painel |

O revisor também confirmou:
- `progressSaver` não usa timer, e as gravações não se sobrepõem nem chegam fora de ordem. O estado final não pode ser sobrescrito.
- `analysisStatuses` usa uma API válida do Dexie 4 e devolve todas as linhas.
- B3 conta o lado certo e as janelas não se sobrepõem. O caso de 0,3 exato é tratado corretamente apesar do ponto flutuante.
- FA-3 é consistente entre o gráfico e a linha histórica.
- FA-4 não grava nada.

## 9. Débitos e limitações restantes

- **B1, dois LOW ainda abertos.** "Perde material" pode exagerar quando a linha de referência não chega a um ponto estável, e faltam testes de borda das faixas de consequência.
- **PA-1:**
  - telas de estatística ainda carregam `positions` das análises concluídas: separar `reviews` de `positions` exigiria mudar o schema, fora desta etapa;
  - a consulta de status ainda reexecuta a cada gravação, mas lê só o índice.
- **B3:**
  - a métrica conta erros graves, não o nível dos adversários nem o ritmo das partidas;
  - partidas sem data ficam entre as mais antigas e podem cair na janela "anterior";
  - a hora da importação só desempata.
- **FA-3.** Uma tentativa gravada exatamente às 00:00:00.000 UTC seria lida como data de PGN. A chance é de 1 em 86,4 milhões por evento, e o efeito é só de exibição.
- **FA-6 e o teste de inicialização (FA-5)** seguem adiados, como no planejamento.
