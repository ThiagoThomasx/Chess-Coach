# Sprint 4.5 — Perfil e contadores consistentes entre ações combinadas

- **Branch:** `feat/sprint4-5-consistent-profile`, criada a partir de `main` em `edf4de8` (merge do PR #7; CI pós-merge run `42396932386`, sucesso).
- **Data:** 2026-11-07.
- **Situação:** implementado e testado localmente. **Nada foi commitado, enviado ou aberto como PR.**
- **Origem:** `SPRINT4-5-PLANEJAMENTO-AUDITORIA.md`, com as decisões do usuário:
  - **D-4:** alternativa B;
  - **D-5:** limpar as evidências órfãs.

## 1. Objetivo

Fazer o perfil e os contadores continuarem verdadeiros quando ações individualmente corretas se combinam: excluir, trocar de lado, treinar em outra aba, deixar o app aberto e importar histórico antigo.

Não houve mudança de esquema, dependência nova, chamada de rede nem alteração no motor.

## 2. Itens

### E1 — Excluir uma partida remove as evidências dos exercícios dela (N1 + D-5)

- `deleteGame` (`src/db/gamesRepo.ts`) apaga, na mesma transação, os `skillEvents` com `ref.exerciseId` dos exercícios da partida. É o mesmo que `deleteExercise` já fazia.
- `removeOrphanExerciseEvidence()` (`src/db/trainingRepo.ts`), com autorização do usuário (D-5):
  - roda a cada abertura do app;
  - remove só eventos `source: 'exercise'` cujo exercício não existe mais;
  - não toca em evidências de partida e de abertura;
  - roda numa transação única sobre `exercises` e `skillEvents`;
  - é idempotente.

### E2 — Diagnóstico histórico e evolução recente (D-4 B + N2)

Em `src/services/adaptation/skills.ts`:

- **Diagnóstico histórico** (`SkillEstimate.history`): a estimativa Beta com **todas** as evidências, sem decaimento por idade (o 1/k por repetição continua), com o período coberto.
- **Estado "Sem evidência recente"** (`no_recent`): quando a última evidência tem mais de 30 dias e o peso bruto é ≥ 2. Substitui o antigo "Precisa revisar" por antiguidade. "Precisa revisar" fica reservado para queda recente ou para limite superior abaixo de 50%.
- **Tendência e queda recente** comparam **um só tipo de evidência** (`comparableSeries`): exercícios e treinos de abertura quando existem, senão lances de partidas.
  - Por sugestão da revisão, essas comparações também aplicam o desconto 1/k por repetição.
- **Interface:**
  - na Evolução, `SkillProfile` mostra a linha "Diagnóstico histórico: X% (…) · N evidência(s) de mm/aaaa a mm/aaaa";
  - o dashboard (`SkillStates`) ganhou o grupo "Sem evidência recente";
  - as recomendações citam essas competências como pedido de medição, e não de revisão.

### E3 — Tentativas e derivações conferem o estado gravado (P3-3 + C1)

- **`recordAttempt`:**
  - relê o exercício dentro da transação;
  - se ele foi removido (troca de lado, outra aba, exclusão), nada é gravado e o solucionador avisa;
  - o reagendamento parte do `srs` gravado, e não da cópia em memória, o que evita sobrescrever uma revisão feita em outra aba.
- **`addExercise(ex, guard)`** confere a cor da partida na mesma transação da gravação. `deriveFromAnalysis` passa a guarda. Uma troca de lado no intervalo entre a conferência e a gravação deixou de deixar um exercício do lado antigo.

### E4 — Contadores coerentes (C3 + N3)

- O contador "Treinar" da barra lateral é recalculado a cada minuto (`src/hooks/useMinute.ts`). Uma revisão que vence com o app aberto aparece sem recarregar.
- A Evolução conta "Revisões pendentes" com `isDueReview`, a mesma regra do dashboard e da barra lateral.

### E5 — Documentação

- `BASELINE-MAIN.md` atualizada para `edf4de8`: PRs #4–#7, 370 / 21 / 53, situação dos débitos.
- Corrigidas as situações desatualizadas de `SPRINT4-4-RELATORIO.md` e `SPRINT4-4-AUDITORIA-POS-MERGE.md` §8.1.
- `METHODOLOGY.md` e `ARCHITECTURE.md` atualizados.

### Opcionais incluídos

- **P3-1, fuso no gráfico:** `evidenceDayKey` (`stats.ts`) lê evidências de partida no dia UTC, porque guardam uma data de calendário. As demais usam o dia local. Não muda dados.
- **P3-4, índices:** `redateGameEvidence` usa `where('source')`, e a remoção D3 usa `where('gameId')`. A deduplicação do `addExercise` continua sem índice, porque exigiria migração.
- **P3-2, Partida da Ópera com o motor real** (`tests/engine-integration.test.ts`):
  - a análise da profundidade 11 de 15.Bxd7+ fica congelada como fixture, idêntica em dois processos novos do motor;
  - o Stockfish real monta a árvore na profundidade 16;
  - o teste afirma que a árvore aceita o lance (o exercício é descartado) e que ela não desmente uma análise tão profunda quanto ela própria (A5-1);
  - passa isolado e dentro da suíte.

**Fora:** C2 (aviso de derivação sempre pendente), ESLint, índice para a deduplicação e coordenação entre abas.

## 3. Restrições respeitadas

- **Esquema:** `SCHEMA_VERSIONS` continua `[1, 2]`, sem campo ou índice novo. `ConfidenceLevel` e `HistoricalDiagnosis` são tipos calculados, que não são gravados.
- **Dados:** a única remoção nova é a das evidências de exercícios que não existem mais (D-5, autorizada) e a das evidências de exercícios na exclusão da partida.
- **Intocados:** `package.json`, lockfile, CI, `public/engine` e `src/services/engine`.
- **Rede:** nenhuma chamada nova.
- **Ambiente local:** a pasta `.claude/` foi preservada.

## 4. Prova de que os testes detectam as falhas

| Mutação | Detectada por |
|---|---|
| `deleteGame` sem apagar evidências de exercício | Teste N1 |
| Limpeza sem conferir a existência do exercício | Teste D-5 |
| Antiguidade volta a dar "Precisa revisar" | 2 testes D-4 |
| Diagnóstico histórico com decaimento | 2 testes D-4 |
| Tendência mistura tipos de evidência | Teste N2 |
| `recordAttempt` sem conferir existência | Teste P3-3 |
| `recordAttempt` reagendando pela cópia | Teste "agenda pelo gravado" |
| `addExercise` sem guarda de cor | Teste C1 (corrida forçada entre a conferência e a gravação) |
| "Sem evidência recente" mostrado como número | Teste D-4 |
| Dia da partida em hora local | Teste P3-1 (detecta em fuso negativo, como o Brasil; numa máquina em UTC não há diferença a detectar) |
| Contador sem o tique de minuto | E2E C3 (relógio simulado) |
| Evolução contando exercícios novos | E2E N3 |
| Queda recente sem o desconto 1/k | Teste da revisão |
| "Sem evidência recente" omitido quando há evidências insuficientes | Teste da revisão |

**O E2E N3 inicialmente não detectava a mutação.** Uma escrita direta no IndexedDB não passa pelo cache de consultas do Dexie, e o primeiro desenho da tela mostrava um valor transitório que satisfazia a asserção. O teste passou a recarregar a própria tela antes de conferir, e com isso detecta a mutação.

## 5. Revisão de código

Um agente revisor independente aprovou a mudança, sem achados críticos ou altos. Ele confirmou:

- o escopo das transações;
- a segurança da limpeza contra `recordAttempt` em outra aba;
- que os testes falham sem as correções.

| Achado | Gravidade | Situação |
|---|---|---|
| A falha de uma etapa da abertura impedia as seguintes (a reconciliação não rodava) | Média | **Corrigido:** cada etapa tem seu próprio tratamento de erro |
| "Sem evidência recente" não aparecia na recomendação quando havia competências com evidências insuficientes | Média | **Corrigido**, com teste |
| A limpeza D-5 remove evidências de exercício restauradas de um backup parcial sem a tabela `exercises` | Média | **Mantido.** Backups exportados pelo app contêm todas as tabelas. Num arquivo editado sem `exercises`, essas evidências apontam para exercícios que não existem no banco, que é o caso que a D-5 autorizou limpar. Registrado na METHODOLOGY |
| A queda recente ignorava o desconto 1/k | Baixa | **Corrigido**, com teste |
| Aviso do solucionador sem região anunciada a leitores de tela | Baixa | **Corrigido:** `role="status"` e `aria-live="polite"` no retorno do exercício |
| A queda recente só é detectável com mais de 8 evidências do mesmo tipo | Baixa | **Intencional** (consequência do N2) |
| O mês do diagnóstico histórico é lido em UTC também para exercícios | Baixa | **Mantido:** só afeta o rótulo de mês, perto da virada do mês à noite |
| O teste C1 depende da ordem das leituras da partida | Baixa | **Mantido:** é a forma de forçar a corrida de modo determinístico; está documentado no próprio teste |

**Verificação visual** (origem isolada `audit.localhost:5174`, 375 px, sem rolagem horizontal). Encontrei um defeito que os testes não pegavam: uma competência "Sem evidência recente" ainda mostrava "recente 50%" e "estável", calculados de dados de um ano atrás. Corrigi: sem evidência recente, não há taxa recente nem tendência. Os testes unitário e E2E ganharam essa asserção. Na mesma verificação, a limpeza D-5 removeu as evidências semeadas de exercícios inexistentes e manteve as 60 de partidas.

## 6. Resultados

| Verificação | Antes (`edf4de8`) | Sprint 4.5 |
|---|---|---|
| typecheck | ok | ok |
| Vitest | 370 (23 arquivos) | **385** (24 arquivos) |
| Stockfish real | 21 | **22** (Partida da Ópera) |
| Cobertura (`src/services`, `src/db`) | linhas 93,62 · statements 90,06 · branches 82,73 · funções 86,59 | linhas **93,74** · statements **90,25** · branches **83,05** · funções **87,14** |
| Build | ok | ok |
| Playwright (porta 4176) | 53 | **58** (+5 em `consistency.spec.ts`) |

## 7. Pendências

- **Backlog:**
  - C2 (selo "Exercícios pendentes");
  - ESLint (decisão do usuário);
  - índice para a deduplicação de exercícios;
  - coordenação entre abas;
  - débitos 2, 3 e 4 da baseline;
  - janela de prática depois de revelar.
- **Teste em celular físico:** recomendado, mas não feito. A verificação em 375 px no navegador não mostrou problema de layout.
