# Sprint 4.7 — Diagnóstico honesto

| Campo | Valor |
|---|---|
| Branch | `feat/sprint4-7-honest-diagnosis`, criada de `main` em `5701b4b` |
| Data | 2026-11-13 |
| Origem | Auditoria pós-Sprint 4.6 (entregue na conversa, sem arquivo) e escopo aprovado pelo usuário |
| Estado | **Sem commit.** Todo o trabalho está no working tree da branch |

Legenda: **[R]** reproduzido · **[C]** por inspeção de código · **[E]** resultado de execução.

## 1. Objetivo

O perfil, os exercícios e as recomendações não afirmam conclusões que os dados não sustentam. Não houve funcionalidade nova, mudança de schema ou dependência nova.

## 2. Entregas

### PD-1 — "Cálculo" não é mais medido só por fracassos

- **Problema [R]:** um erro de partida vira evidência de fracasso na competência do conceito, mas só algumas competências têm uma regra de sucesso em partidas. "Cálculo de variantes" não tem nenhuma. Catorze erros de cálculo em partidas, o único tipo de evidência que as partidas geravam para ela, levavam a "Precisa revisar" (nível 0,11), qualquer que fosse o nível do jogador.
- **Correção:**
  - `GAME_SUCCESS_SKILLS` lista as competências que a partida mede nos dois sentidos;
  - `eventsFromGame` só registra fracassos nelas;
  - `isMeasurableEvidence` ignora, na estimativa e no gráfico de evolução, as evidências gravadas antes desta versão.
- **O que continua igual:**
  - o cálculo continua medido pelos exercícios;
  - os erros continuam aparecendo como padrões recorrentes, que são uma contagem, não uma taxa.
- **Arquivos:** `src/services/adaptation/skills.ts`, `src/features/progress/ProgressCharts.tsx`.

### PD-2 — Conversão coerente com o próprio objetivo; o B3 não conta vantagem decisiva mantida

- **Problema [R]:**
  - de +12 para +5, a expectativa vai de 97,5% para 86,3%, uma perda de 11,2 p.p.;
  - o lance é classificado como "Erro";
  - o exercício de conversão pedia "Mantenha a vantagem decisiva" e recusava esse lance com "reduz a vantagem", embora 86% esteja na faixa "vantagem decisiva".
- **Correção:**
  - `DECISIVE_WIN_PERCENT = 80`, constante única para a faixa;
  - em metas de conversão, `keepWinOf` aceita todo lance que mantém a expectativa ≥ 80%. Vale na árvore de solução, na validação ao vivo e no nó calculado na hora;
  - `playedMeetsGoal` impede que uma conversão seja criada a partir de um lance que já cumpria o objetivo. A regra fica em `noErrorToTrain`, usada **igualmente** pela derivação automática (`analysisRunner.ts`) e pelo botão "Criar exercício desta posição" (`ExplanationPanel.tsx`), com mensagem própria;
  - na validação ao vivo, um lance que mantém o piso não paga a revalidação mais profunda da faixa de incerteza;
  - **decisão do usuário:** o indicador "Minhas partidas estão melhorando?" não conta como erro sério um lance depois do qual a expectativa continua ≥ 80%. Para não confundir com a classe "Erro grave", o indicador passou a dizer **"erros sérios por partida"** (antes "erros graves").
- **Escopo exato da exceção dos 80% (decisão definitiva):**

  | Noção | Regra | Muda na 4.7? |
  |---|---|---|
  | Erro técnico | Classificação do motor (análise, selos, distribuição, explicações, perfil de competências, padrões recorrentes) | **Não.** +12 → +5 continua "Erro" e continua contando no perfil e nos padrões |
  | Erro sério | Erro ou erro grave do usuário, exceto com expectativa ≥ 80% depois do lance | **Sim**, e só no indicador "Minhas partidas estão melhorando?" |
  | Elegível para treino | Critérios de seleção + `noErrorToTrain`: o lance jogado não pode ser aceito pela árvore mais profunda nem cumprir o objetivo do exercício | **Sim**, só para objetivos de **conversão**. Uma torre deixada desprotegida a +12 continua gerando exercício de defesa |

  A tabela também está em `docs/METHODOLOGY.md`, seção "Três noções de erro".
- **Arquivos:** `classify.ts`, `refutation.ts`, `sequence.ts`, `generate.ts`, `analysisRunner.ts`, `stats.ts`, `GameTrend.tsx`, `ExplanationPanel.tsx`, `e2e/progress-trend.spec.ts` (texto "erros sérios").

### PD-3 — "Treinar este tema" respeita o lado do motivo

- **Problema [C]:** a recomendação "Ataque duplo do adversário" abria `/train?theme=fork`, que lista também os exercícios "encontre o garfo".
- **Correção:**
  - `trainThemeHref` acrescenta `&side=own|opponent` aos motivos que existem dos dois lados;
  - a tela Treinar filtra por `matchesThemeFilter` e mostra o lado ativo;
  - escolher um tema no filtro remove o lado.
- **Arquivos:** `recommend.ts`, `themeEvidence.ts`, `TrainingPage.tsx`.

### Medição pedagógica (ferramenta)

- **O que é:** `npm run measure:pedagogy`, com `CORPUS_PGN`, `CORPUS_PLAYER`, `CORPUS_DEPTH`, `CORPUS_MAX` e `CORPUS_OUT` opcional. Analisa um arquivo PGN local com o motor real e informa:
  - a distribuição das classificações;
  - a parcela de erros com explicação verificada ou limitada;
  - os tipos e temas dos erros;
  - os exercícios criados ou descartados, por motivo;
  - os tipos de objetivo, a parcela de exercícios ambíguos e a média de lances aceitos na raiz.
- **Privacidade e suíte:** nada sai da máquina, e o JSON opcional não tem lances nem nomes. Fica fora da suíte padrão (`describe.skipIf`).
- **Validação nos dois fixtures [E]:** profundidade 14, os dois lados de cada partida.
  - 2 erros, 1 com explicação verificada e 1 limitada;
  - 2 exercícios, ambos de defesa, 100% ambíguos, com 3 lances aceitos na raiz, o que é exatamente o MultiPV.
- **Limitações:**
  - dois exemplos não sustentam conclusão: são partidas conhecidas e não representam um amador. **A decisão sobre PX-2 e PD-4 depende de rodar a ferramenta num PGN real do jogador**;
  - usa as configurações padrão (`DEFAULT_SETTINGS`), não as que o jogador salvou no app, e não consulta o banco do app;
  - `CORPUS_PLAYER` compara o nome exato dos cabeçalhos `[White]`/`[Black]` (sem diferenciar maiúsculas). Sem ele, os dois lados de cada partida entram, e isso mistura os erros do adversário;
  - a deduplicação de posições entre partidas e com exercícios já existentes não é reproduzida: conta os candidatos de cada partida isoladamente;
  - os resultados do motor variam um pouco com o estado de hash e a profundidade; o custo é de dezenas de segundos por partida na profundidade 16 (limite padrão de 40 partidas);
  - é um teste Vitest ignorado na suíte padrão (aparece como 1 ignorado); não é empacotado no app.
- **Arquivos:** `tests/measure/pedagogy-corpus.test.ts`, `tests/support/nodeEngine.ts` (transporte do motor extraído de `engine-integration.test.ts`, sem mudança de comportamento), `package.json`.

### Verificação com duas abas (T-1) [R]

- **Como:** um spec Playwright temporário, já apagado:
  1. a aba 1 analisa a Partida da Ópera na profundidade 16;
  2. depois da primeira gravação, uma 2ª aba é aberta.
- **Resultado:**
  - `recoverInterruptedAnalyses` da 2ª aba muda o registro para `paused` por cerca de 1,3 s (13 leituras a cada 100 ms);
  - a próxima gravação da aba 1 devolve `running`, e a análise termina `complete`;
  - não houve perda.
- **Risco:** se o usuário clicar em "Retomar" na 2ª aba nessa janela, duas execuções rodam a mesma partida (FA-6).
- **Decisão definitiva:** **não corrigir nesta sprint** e preservar o comportamento atual. A proteção contra análises simultâneas (por exemplo, Web Locks por partida, nativo do navegador) é candidata a uma próxima sprint. O risco fica registrado aqui; a baseline da `main` só é atualizada depois do merge.

## 3. Testes

| Arquivo | Novos | Cobre |
|---|---|---|
| `tests/skills.test.ts` | 5 | PD-1: captura perdedora sem evento de cálculo; toda competência com evento de partida tem caminho de sucesso; evidências antigas ignoradas, sem recomendação; exercícios ainda medem cálculo. PD-3: link com lado, filtro e exercícios antigos sem `motifSide` |
| `tests/sequence.test.ts` | 5 | PD-2: +12 → +5 aceito na conversão; +12 → +1 recusado; outros objetivos mantêm a tolerância; a árvore aceita as linhas decisivas; um lance decisivo na faixa de incerteza não pede a revalidação (L3) |
| `tests/training.test.ts` | 3 | PD-2: `playedMeetsGoal` só para conversão; `noErrorToTrain`, regra única da derivação e da criação manual (M1) |
| `tests/game-trend.test.ts` | 1 | PD-2: 86% depois do lance sai da contagem; 79% fica |
| `e2e/honest-diagnosis.spec.ts` | 1 | PD-3 na tela: lado do adversário, lado próprio e filtro manual |
| `tests/conversion-derivation.test.ts` | 2 | PD-2, derivação automática com motor determinístico: +12 → +5 é "Erro" mas não gera conversão; +12 → +1 gera (revisão do PR, M2) |
| `tests/sequence.test.ts` (fechamento) | 3 | Conversão de 2 lances: o nó calculado depois da resposta aceita os lances decisivos; `buildSolutionTree` aplica o piso só na conversão; fronteira de 80% (revisão do PR, M3 e L4) |
| `tests/game-trend.test.ts`, `tests/training.test.ts` (fechamento) | 2 | Fronteira exata de 80% no indicador e na elegibilidade (L4) |
| `e2e/honest-diagnosis.spec.ts` (fechamento) | 1 | Criação manual: recusa a conversão de um lance que manteve a vantagem decisiva e cria a de um que a perdeu (revisão do PR, M1) |

Os testes unitários foram escritos antes da correção e falharam primeiro (vermelho → verde). Nenhum teste existente foi removido ou enfraquecido.

**Prova de que os testes do fechamento pegam a regressão (mutação temporária, código restaurado e conferido com `git diff`):** desligar a regra na criação manual, na derivação automática, no nó calculado na hora ou na árvore, ou trocar `>=` por `>` no indicador e na elegibilidade, faz pelo menos um teste novo falhar. A única mutação não detectada é `>=` → `>` no piso da árvore: com pontuações em centipawns a expectativa nunca dá exatamente 80,000…%, então ela não muda o comportamento.

## 4. Resultados [E]

| Verificação | Resultado |
|---|---|
| Typecheck | ok |
| Vitest | **497/497** + 1 ignorado (a medição, sem `CORPUS_PGN`); 476 → 497 |
| Stockfish real isolado | **24/24** |
| Cobertura (services + db) | linhas 95,22% · statements 91,96% · branches 84,62% · funções 89,76% |
| Build | ok |
| Playwright | **86/86** (84 → 86), porta 4176 |

## 5. Efeitos visíveis para o usuário

- "Cálculo de variantes" pode sair de "Precisa revisar" e ir para "Evidências insuficientes" quando só partidas a mediam.
- O indicador de erros sérios por partida pode diminuir para quem tem conversões imprecisas em posições ganhas.
- Exercícios de conversão já gravados passam a aceitar lances decisivos. Nada é regravado: a regra vale na validação.

## 6. Débitos mantidos

| Item | Situação |
|---|---|
| T-1 / FA-6: 2ª aba marca por ~1,3 s uma análise viva como `paused`; "Retomar" nessa janela duplica a execução | Reproduzido; mantido por decisão. Candidato à próxima sprint |
| PX-2: erro sem motivo tático verificado mostra só a avaliação | Depende da medição num PGN real |
| PD-4: exercícios de defesa aceitam qualquer lance dentro da tolerância (nos fixtures, 100% ambíguos) | Hipótese; depende da medição |
| PD-5: domínio de tema mede lembrança das mesmas posições | Limitação de desenho, documentada |
| PD-6: jargão "p.p." nas mensagens de incerteza e no detalhe da recusa | Aberto (cosmético) |
| T-2: custo do painel com histórico grande (recalcula conceitos a cada minuto) | Hipótese; medir antes de mudar |
| T-3: classe `book` nunca atribuída | Aberto (código morto) |
| FA-2, FA-5, PX-6, AC-10, AC-11, disco cheio | Como na baseline |
| Esperas fixas em testes | Como na baseline, **mais** três `waitForTimeout(700)` em `e2e/mvp.spec.ts` que a baseline não lista |
| Voltar do exercício para a análise reabre o lance 0 | Como na baseline |
| Débitos 2 (limites da época), 3 (768 px), 4 (mate equivalente "Excelente"), 7 (ESLint) | Como na baseline |
| L4: o ramo de posição terminal ignora o piso de conversão | Sem efeito prático; mantido |

**Decidido e fora de escopo:** estender a exceção dos 80% ao perfil e aos padrões recorrentes (achado M2). A decisão do usuário restringe a exceção ao indicador.

## 7. Revisão independente

Revisor separado, somente leitura, sobre o diff completo. Veredito: **aprovado**, sem CRITICAL nem HIGH.

| # | Sev. | Achado | Situação |
|---|---|---|---|
| M1 | MEDIUM | A criação manual de exercício (`ExplanationPanel`) não aplicava `playedMeetsGoal` | **Corrigido**: `noErrorToTrain` é a regra única dos dois caminhos, com mensagem própria; teste novo |
| M2 | MEDIUM | A exceção dos 80% vale só para o B3; a evidência de fase do perfil e os padrões recorrentes ainda contam o lance | **Mantido por decisão definitiva do usuário** e documentado (METHODOLOGY, "Três noções de erro") |
| L3 | LOW | Um lance decisivo na faixa de incerteza pagava uma revalidação mais profunda | **Corrigido**, com teste |
| L4 | LOW | O ramo de posição terminal ignora o piso | Sem efeito prático: mate vale 100% e empate 50%. Mantido |
| L5 | LOW | Conversões antigas criadas desses lances não são apagadas | **Documentado**: passam a aceitar o lance decisivo na validação |
| L6 | LOW | A raiz de uma conversão pode listar mais lances aceitos, o que aparece nas dicas e na solução | Aceito: são lances corretos |
| L7 | LOW | Outros leitores de `SkillEvent` brutos ainda veriam os eventos antigos de cálculo | Verificado: não há outro em `src/` |

### Revisão final (fechamento)

Segundo revisor separado, somente leitura, sobre a branch inteira contra a `main`, depois das correções acima. Veredito: **aprovado**, sem CRITICAL, HIGH ou MEDIUM.

- Todas as alterações pertencem ao escopo: nenhum CSS, nenhuma dependência e nenhuma chamada de rede nova; `package.json` só ganhou o script `measure:pedagogy`.
- PD-1, PD-2 e PD-3 aplicados de forma consistente; criação manual e automática compartilham `noErrorToTrain`; a revalidação respeita o piso.
- Compatibilidade com dados antigos verificada: exercícios sem `goal` ou `motifSide`, revisões sem `winAfter`, eventos de cálculo já gravados e backups. Não há mudança de schema.

| # | Sev. | Achado | Situação |
|---|---|---|---|
| F1 | LOW | `classify.ts` ainda tinha o literal `80` no ramo de mate perdido | **Corrigido**: usa `DECISIVE_WIN_PERCENT`, sem mudança de comportamento |
| F2 | LOW | Ramo terminal ignora o piso (= L4) | Mantido |
| F3 | LOW | T-1 registrado só neste relatório | Mantido assim por decisão do usuário: a baseline é atualizada depois do merge |

Na mesma etapa, a revisão do diff encontrou e corrigiu uma ambiguidade de texto: o indicador se chamava "Erros graves por partida", mesmo nome da classe "Erro grave", mas conta "Erro" e "Erro grave" e exclui lances com vantagem decisiva mantida. Agora diz "erros sérios" e explica a diferença na própria tela. A mensagem da criação manual também deixa claro que o lance continua sendo um erro pelo motor, mas não gera exercício.

### Revisão do PR #10 e fechamento das lacunas

- **CI do commit `3e43621`:** job `verify` todo verde.
  - typecheck ok;
  - Vitest 490 + 1 ignorado, com os 24 testes do motor real;
  - build ok;
  - Playwright 85.
- **Terceiro revisor separado:** veredito "aprovado com ressalvas", sem CRITICAL nem HIGH. As ressalvas eram três lacunas de teste (MEDIUM), todas fechadas com um commit só de testes:

| # | Sev. | Lacuna | Situação |
|---|---|---|---|
| M1 | MEDIUM | A chamada de `noErrorToTrain` na criação manual não tinha teste | **Fechada**: E2E com o motor real |
| M2 | MEDIUM | O desvio em `deriveFromAnalysis` só era exercitado pela medição, que não roda no CI | **Fechada**: `tests/conversion-derivation.test.ts` |
| M3 | MEDIUM | O segundo lance da conversão e a ligação do piso em `buildSolutionTree` não eram testados | **Fechada**: dois testes em `tests/sequence.test.ts` |
| L4 | LOW | Fronteira exata de 80% | **Fechada** no indicador e na elegibilidade |
| L5 | LOW | A nota "Só: …" do filtro herda o tamanho do rótulo (`.field > span` vence `.xs`) | Mantida (cosmético; fora do commit só de testes) |
| L6–L8 | LOW | Texto longo do indicador e da mensagem; teste de competências parcialmente tautológico | Mantidos e registrados |
