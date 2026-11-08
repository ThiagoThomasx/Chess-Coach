# Sprint 4.4 — Evidências que dizem a verdade sobre o jogador

- **Branch:** `feat/sprint4-4-truthful-evidence`, criada a partir de `main` em `e63c59b` (merge do PR #5; CI pós-merge: run `42384359803`, sucesso).
- **Data:** 2026-11-07.
- **Situação:** integrada na `main` pelo PR #6 (merge commit `9e1243d`). As correções da auditoria pós-merge entraram pelo PR #7 (merge commit `edf4de8`). Ver `SPRINT4-4-AUDITORIA-POS-MERGE.md`.
- **Origem:** `SPRINT4-4-PLANEJAMENTO.md`, aprovado pelo usuário com as decisões recomendadas D1–D4.

## 1. Objetivo

Fazer o perfil e o histórico de treino dizerem a verdade sobre o jogador:

- quando o erro aconteceu;
- se o acerto foi do jogador ou da dica;
- se cada número mostrado significa o que o rótulo diz.

Não houve mudança de esquema, dependência nova, chamada de rede nem alteração no Stockfish.

## 2. Itens

### E0 — Pré-condições

- PR #5 integrado com merge commit `e63c59b`, com CI pós-merge verde. `main` local atualizada e branch criada a partir dela.
- O cabeçalho desatualizado do `SPRINT4-3-RELATORIO.md` foi corrigido.

### E1 — Evidências de partida datadas pela partida (D1-a: recalcular ao abrir; D1-b: data de importação)

**Problema.** As evidências de partida recebiam a data da análise (`a.updatedAt`). Importar e analisar hoje partidas antigas tornava os erros delas "recentes". Reanalisar renovava a data, e o gráfico de evolução seguia a ordem de análise.

**Correção:**

- Novo módulo `src/services/games/gameDate.ts`:
  - `gameTime`, movido de `stats.ts` sem mudança de regra e reexportado por `stats.ts`;
  - `gameEvidenceTime(game, fallback)`: a data do PGN quando confiável; senão, a data de importação; `fallback` só para registros sem data de importação.
- `deriveFromAnalysis` usa `gameEvidenceTime`.
- `redateGameEvidence()` (`src/db/analysisRepo.ts`):
  - roda a cada abertura do app, entre `recoverInterruptedAnalyses` e `reconcileDerivations`;
  - numa única transação, regrava **só o campo `at`** dos eventos `source: 'game'` cuja data difere da esperada;
  - não cria nem apaga nada e não usa o motor;
  - é idempotente: na segunda execução não há o que mudar;
  - eventos de partidas inexistentes ficam intocados.
- A tela de Evolução renomeou "Partidas analisadas ao longo do tempo" para "Análises feitas por dia" e explica que é o dia da análise. Esse gráfico continua, de propósito, usando a data da análise.

### E2 — A dica que mostra o lance conta como solução revelada (D2)

**Problema.** A dica 3 diz "O lance é X". Jogar o lance depois dela gravava um acerto "com ajuda", com crédito 0,25 e retorno em pelo menos 1 dia.

**Correção:**

- `attemptResult(correct, revealed, hintsShown)` em `validate.ts`: a partir da dica 3, a tentativa é gravada com `correct: false, revealed: true`. Isso dá crédito 0, caixa 0 e retorno em 10 minutos.
- As dicas 1 e 2 continuam valendo como "com ajuda".
- Avisos:
  - **antes:** com 2 dicas usadas, o botão passa a dizer "Mostrar o lance (conta como revelada)", com explicação no `title`;
  - **ao mostrar:** o texto da dica avisa;
  - **ao resolver:** o retorno diz que a tentativa contou como solução revelada.
- Tentativas antigas não são reescritas.

### E3 — Contador "Treinar" da barra lateral

O contador agora usa `isDueReview`, a mesma regra do dashboard. Exercícios novos, nunca tentados, não aparecem mais como "revisões pendentes".

### E4 — Mensagens verdadeiras na troca de cor (P3-1 e P3-4)

- Se a derivação falha depois de salvar a cor, o toast relê a partida e diz "Cor salva. Os exercícios não puderam ser gerados agora; o app tentará de novo na próxima abertura." (`colorChangeFailureMessage`). O erro vai para o console local.
- **Defeito encontrado pelo E2E novo:** o aviso "serão gerados quando a análise terminar" não aparecia no início da análise. O status gravado só vira `running` depois da primeira posição. A tela agora consulta também `isRunning(gameId)`.
- Novos E2E cobrem:
  - a nota de partidas sem cor na Evolução;
  - "Cor removida";
  - o aviso durante a análise.

### O1 — Revalidação do erro na profundidade da árvore (D4)

**Investigação com o Stockfish real.** Uma sonda temporária, removida depois, analisou quatro partidas clássicas na profundidade 11 e montou as árvores na 16. Ela gerou 16 exercícios. Em **1 deles a árvore aceitou o lance jogado**: 15.Bxd7+ da Partida da Ópera, que é um lance correto de Morphy, classificado como "erro grave" na profundidade 11. A hipótese se confirmou.

**Correção.** `acceptsPlayedMove(ex, uci)` em `generate.ts`. Quando a árvore aceita o lance jogado:

- a geração automática (`deriveFromAnalysis`) descarta o exercício;
- a criação manual (`ExplanationPanel`) avisa e não grava.

Sem motor, a árvore não é montada e a verificação não acontece. Isso está documentado na METHODOLOGY.

### O2 — Exercícios do lado antigo (D3)

Trocar a cor entre brancas e pretas remove os exercícios da partida do lado antigo que **nunca foram tentados**. A remoção roda na mesma transação que salva a cor (`saveColorMarkingPending` → `removeUnattemptedExercises`).

- Os exercícios já tentados ficam, com as tentativas e as evidências.
- Remover a cor ou defini-la pela primeira vez não remove nada.
- O toast informa quantos foram removidos.

## 3. Restrições respeitadas

- **Esquema:** `SCHEMA_VERSIONS` continua `[1, 2]`, sem campo ou índice novo.
- **Dados:** a única reescrita de dados existentes é o `at` das evidências de partida (E1). A única remoção é a dos exercícios nunca tentados numa troca de lado (D3, aprovada).
- **Intocados:** `package.json`, lockfile, CI, `public/engine`, `scripts` e `src/services/engine`.
- **Rede:** nenhuma chamada nova.
- **Ambiente local:** `.claude/` foi preservada.

## 4. Prova de que os testes detectam as falhas

Cada correção foi desfeita temporariamente:

| Mutação | Detectada por |
|---|---|
| Evidência datada pela análise | 4 testes de `evidence-dates` |
| `redateGameEvidence` sem gravar | Redata e idempotência |
| Sem data → data da análise (em vez da importação) | "Sem data confiável usa a importação" |
| Dica 3 conta como acerto | Dica 3 = revelada |
| Mensagem diz "não salva" com a cor salva | P3-1 (2 testes) |
| Sem revalidação O1 | Teste O1 (motor roteirizado) |
| D3 desligado | D3 (2 testes) |
| D3 apagando exercícios tentados | "Tentado é mantido" |
| D3 sem filtrar a partida | "Outras partidas mantidas" |
| Contador antigo na barra lateral | E2E do contador |
| App sem chamar `redateGameEvidence` | E2E de confiabilidade (etapa de redatação após recarregar) |
| Aviso de análise em andamento só pelo status gravado | E2E novo, que falhou antes da correção |

## 5. Resultados

| Verificação | Sprint 4.3 | Sprint 4.4 |
|---|---|---|
| typecheck | ok | ok |
| Vitest | 348 (22 arquivos) | **366** (23 arquivos) |
| Stockfish real isolado | 21 | 21 |
| Cobertura (`src/services`, `src/db`) | linhas 93,26 · statements 89,51 · branches 82,03 · funções 85,50 | linhas **93,61** · statements **90,05** · branches **82,71** · funções **86,59** |
| Build | ok | ok |
| Playwright (porta 4176) | 49 | **51** |

## 6. Revisão de código

Um agente revisor independente **aprovou** a mudança, sem achados críticos ou altos. Ele confirmou:

- o escopo das transações do Dexie (o `setUserColor` aninhado usa um subconjunto das tabelas);
- a idempotência de `redateGameEvidence`;
- a ausência de conflito com a fila por partida;
- que os testes de E1 e D3 falham sem as correções.

| Achado | Gravidade | Situação |
|---|---|---|
| Troca de lado com análise em andamento ou ausente removia exercícios sem que o toast dissesse | Média | **Corrigido.** A remoção só acontece com análise concluída, quando o toast informa a contagem. Teste novo, confirmado por mutação |
| A remoção D3 também apaga exercícios **criados manualmente**, se nunca tentados | Média | **Mantido.** É o que D3 define. Distinguir os dois exigiria um campo novo, ou seja, mudança de esquema. A criação manual pode ser refeita na tela de análise. Registrado na METHODOLOGY |
| Mensagem "Cor removida" para uma partida já excluída | Baixa | **Corrigido** |
| Se a derivação falha depois da troca, o toast de erro não cita os exercícios removidos | Baixa | **Mantido.** A cor e a remoção foram gravadas, e a mensagem diz que a cor foi salva |
| Uma tentativa num exercício removido em outra aba o recria (`recordAttempt` faz `put`) | Baixa | **Mantido.** Raro e não destrutivo |
| Uma derivação em andamento pode gravar um exercício do lado antigo logo depois da limpeza | Baixa | **Mantido.** A corrida já existia antes; o exercício sai na próxima troca |
| A dica 3 vale para o exercício inteiro, não por nó | Baixa | **Intencional** (conservador), com aviso no botão |
| A ligação de `attemptResult` no hook só é coberta por E2E | Baixa | **Mantido.** O E2E `sequence.spec` confere a tentativa gravada como revelada |
| Teste de derivação parcial passou a comparar FEN em vez de id | Baixa | **Intencional.** O exercício nunca tentado é removido na troca e recriado para a mesma posição |

Depois das correções, o Vitest subiu para **366**.

## 7. Pendências e backlog

- **Continuam no backlog** (ver planejamento §5):
  - P3-2 e P3-3;
  - reconciliação após restaurar backup;
  - débitos 2, 3, 4 e 7;
  - acerto 10 minutos depois de revelar;
  - calibração da dificuldade.
- **Teste em celular físico:** não necessário. As mudanças de interface são textos e um contador, sem alteração de layout.
