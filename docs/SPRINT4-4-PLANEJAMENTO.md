# Sprint 4.4 — Planejamento

- **Data:** 2026-11-07.
- **Situação:** proposta. **Nada foi implementado.** O início depende da sua aprovação deste escopo e das decisões da §10.
- **Base de partida:** `main` em `e63c59b` (merge do PR #5, Sprint 4.3, com CI pós-merge verde). Ver `SPRINT4-3-AUDITORIA-POS-MERGE.md`.

Legenda: **[F]** fato verificado no código · **[E]** resultado de execução · **[I]** inferência.

## 1. Objetivo da sprint

**Fazer o perfil e o histórico de treino dizerem a verdade sobre o jogador.**

Depois da 4.3, o ciclo partida → exercício → perfil ficou confiável do ponto de vista técnico: nada se perde e nada falha em silêncio. A auditoria funcional encontrou outro problema, a **fidelidade das evidências**:

- quando o erro aconteceu;
- se o acerto foi do jogador ou da dica;
- se a contagem mostrada significa o que o rótulo diz.

Esta sprint corrige isso, sem mudança de schema, sem dependências novas e sem tocar no Stockfish.

## 2. Problemas que justificam a sprint

### 2.1 As evidências de partida são datadas pelo dia da análise, e não pelo da partida (P1)

- **[F]** `deriveFromAnalysis` chama `eventsFromGame(..., a.updatedAt)` (`analysisRunner.ts:119`). Todas as evidências de uma partida recebem a data em que a análise terminou.
- **[F]** O resto do app já usa a data da partida. `gameTime()` (`stats.ts`) lê a data do PGN, e as recomendações usam essa data para escolher as "10 partidas mais recentes" (`RECENT_GAMES`).
- **[I] Consequências:**
  - quem importa e analisa hoje um lote de partidas de um ano atrás recebe esses erros como **recentes**. O decaimento de 120 dias não age, e a tendência e o estado "precisa revisar" refletem a ordem de análise;
  - reanalisar uma partida antiga (por exemplo, com mais profundidade) renova a data de todas as evidências dela;
  - o gráfico "Evolução da competência" (`SkillHistoryChart`) mostra a evolução por **dia de análise**. Isso pode fabricar uma "melhora" ou "piora" que não aconteceu no tabuleiro;
  - o perfil e as recomendações usam noções diferentes de "recente".

### 2.2 A dica 3 entrega o lance, mas a tentativa conta como acerto (P1)

- **[F]** `hintForNode` nível 3 devolve "O lance é {san}" (`validate.ts:84`).
- **[F]** Jogar o lance depois dessa dica grava `correct: true, hintsUsed: 3`. Então:
  - `exerciseOutcome` dá crédito 0,25 (sucesso parcial na competência);
  - `outcomeOf` dá `'assisted'`, e o exercício fica no mesmo nível e volta em ≥ 1 dia, em vez de 10 minutos;
  - `attemptStats` conta a tentativa em "Acertos" e em "com ajuda".
- **[I]** Pedagogicamente, isso equivale a revelar a solução. Diferenciar "precisou de uma pista" de "foi informado o lance" é exatamente a distinção entre dificuldade e desconhecimento que o perfil diz fazer. Hoje as duas ficam no mesmo balde "com ajuda".

### 2.3 O contador "Treinar" da barra lateral diz "revisões pendentes", mas conta exercícios novos (P2)

- **[F]** `AppShell.tsx:20` conta `srs.dueAt <= now`. Os exercícios novos nascem com `dueAt = createdAt`, e o `aria-label` diz "N revisões pendentes".
- **[F]** O dashboard usa `isDueReview` (só os já tentados). Com 5 exercícios recém-gerados, a barra mostra 5 e o dashboard mostra 0 revisões.

### 2.4 O toast de erro ao salvar a cor é falso quando a cor foi salva (P3-1 da auditoria do PR #5)

- **[F]** Em `GamesPage.onColor`, uma falha na derivação mostra a mensagem crua ou "Não foi possível salvar a cor.". A cor já está gravada, e a derivação ficou `'pending'` para a próxima abertura.

### 2.5 Exercícios gerados pela análise rápida (P2, a confirmar com teste)

- **[F]** A análise rápida usa profundidade 11 (`settings.ts:10`), acima do mínimo para classificar (10). Os erros que ela encontra geram exercícios e evidências com o mesmo peso da análise completa (16).
- **[F]** A árvore de solução é montada com profundidade `min(analysisDepth, 16)`. `withSolutionTree` **não confere** se o lance jogado na partida passou a ser aceitável nessa profundidade maior (só `buildExercise` faz essa checagem, na profundidade da análise).
- **[I]** Um "erro" visto na profundidade 11 que é aceitável na 16 vira um exercício cujo lance da partida seria aceito. O exercício seria uma posição sem erro real, apresentada como erro do jogador. **Não reproduzi isso com o motor real.** O primeiro passo é um teste que confirme ou descarte a hipótese.

### 2.6 Observações sem ação proposta

São reais, mas não têm evidência suficiente para justificar mudança agora:

- **[F]** Depois de errar ou revelar, a próxima tentativa só conta após 10 minutos (`PRACTICE_WINDOW_MS`). Nessa hora, um acerto conta como independente, ainda que com peso 1/k pela repetição. **[I]** Isso mede parcialmente a memória de curto prazo. O peso decrescente já atenua o efeito, então fica como backlog para observar com dados reais.
- **[F]** A dificuldade (1–5) é heurística (`estimateDifficulty`) e não é calibrada pelo desempenho. Calibrar exigiria volume de tentativas que um usuário local ainda não tem.
- **[F]** Proteções contra amostra pequena já existem e estão adequadas:
  - intervalo de credibilidade e estado "Evidências insuficientes";
  - mínimo de 3 tentativas por tema no dashboard;
  - 2 ocorrências para um padrão recorrente;
  - 2 dias para o gráfico de evolução;
  - peso por partida limitado.

  A taxa "independente" agregada (`ProgressPage`) aparece mesmo com 1 tentativa. É um refinamento, não um defeito.

## 3. Escopo essencial

### E1. Evidências de partida datadas pela partida (resolve a §2.1)

- **Problema:** §2.1.
- **Evidência:** `analysisRunner.ts:119`, `stats.ts:gameTime`, `recommend.ts:RECENT_GAMES`.
- **Solução recomendada:**
  - `deriveFromAnalysis` passa a usar `gameTime(game)`. Sem data confiável no PGN, usa uma referência a decidir (D1-b).
  - As evidências de partidas já derivadas são recalculadas uma vez (D1-a).
  - Só o valor `at` dos `skillEvents` com `source: 'game'` muda. Não há campo nem índice novo.
- **Benefício:** o decaimento, a tendência, o "precisa revisar" e o gráfico de evolução passam a medir o jogo real. O perfil e as recomendações passam a ter a mesma noção de "recente".
- **Risco:** médio.
  - Muda o perfil exibido para quem analisou partidas antigas. É a correção pretendida, mas o usuário verá estados mudarem.
  - O recálculo das evidências existentes precisa ser idempotente e **não pode** recriar exercícios apagados de propósito.
- **Dependências:** PR #5 integrado; decisões D1-a e D1-b.
- **Critérios de aceite:**
  1. Uma partida com `[Date "2025.01.10"]` analisada hoje gera evidências com `at` = 10/01/2025 (UTC).
  2. Uma partida sem data (ou com data inválida ou futura, conforme `gameTime`) usa a referência escolhida em D1-b, de forma determinística.
  3. Reanalisar a mesma partida não muda o `at` das evidências dela.
  4. Depois do recálculo, nenhum exercício é criado ou apagado, e as evidências de exercício e de abertura ficam intactas.
  5. Duas partidas iguais, exceto pela data, produzem estimativas diferentes, coerentes com a meia-vida de 120 dias.
  6. `analysesOverTime` continua usando a data da análise: é a atividade de análise, e o rótulo da tela deve dizer isso.
- **Testes:**
  - unitários em `skills`/`analysisRunner` para os critérios 1–5;
  - um teste do recálculo sobre um banco `fake-indexeddb` com evidências antigas;
  - E2E: importar uma partida datada, definir a cor e conferir o `at` em `skillEvents`.

### E2. A dica que entrega o lance passa a contar como solução revelada (resolve a §2.2)

- **Problema:** §2.2.
- **Evidência:** `validate.ts:78–85`, `useExerciseSession.ts:64–68,137–144`, `skills.ts:exerciseOutcome`, `srs.ts:outcomeOf`.
- **Solução recomendada** (sujeita a D2): tratar a dica 3 como revelação.
  - A tentativa é gravada com `revealed: true`.
  - O crédito é 0, e o SRS manda o exercício de volta em 10 minutos.
  - A interface avisa, antes de mostrar a dica 3: "Esta dica mostra o lance; a tentativa contará como solução revelada".
  - As dicas 1 e 2 continuam valendo como "com ajuda".
- **Benefício:**
  - a separação entre "com ajuda" e "revelado" passa a significar alguma coisa;
  - a repetição espaçada volta a trazer logo o que o jogador não sabia;
  - "Acertos" deixa de contar respostas fornecidas.
- **Risco:** baixo.
  - Muda só tentativas novas. As antigas não são reescritas: o histórico não é reinterpretado sem pedido.
  - Pode parecer mais "duro" ao usuário, e o aviso prévio resolve isso.
- **Dependências:** D2.
- **Critérios de aceite:**
  1. Resolver depois da dica 3 grava `revealed: true` e `correct: false`, sem evento de competência positivo.
  2. O SRS fica com caixa 0 e `dueAt = agora + 10 min`.
  3. Resolver depois da dica 1 ou 2 continua `correct: true, hintsUsed: n`, com crédito `1 − 0,25n` e SRS `'assisted'`.
  4. O aviso aparece antes da dica 3 e não aparece nas dicas 1 e 2.
  5. Em exercícios de sequência, o limite de 3 dicas continua valendo para o exercício inteiro, e a dica 3 em qualquer nó conta como revelação.
- **Testes:**
  - unitários de `exerciseOutcome`/`outcomeOf` e do hook (`useExerciseSession`) com dica 3 em lance único e em sequência;
  - E2E: pedir 3 dicas, jogar o lance e conferir a tentativa gravada e o toast.

### E3. Contador "Treinar" da barra lateral coerente com o dashboard (resolve a §2.3)

- **Problema:** §2.3.
- **Evidência:** `AppShell.tsx:20,24,43` contra `DashboardPage` (`isDueReview`).
- **Solução recomendada:** a barra conta só as revisões vencidas (`isDueReview`), com o mesmo critério e a mesma função do dashboard. Opcionalmente, mostrar os exercícios novos separados, sem chamá-los de revisões.
- **Benefício:** os números do app deixam de se contradizer.
- **Risco:** muito baixo. Uma consulta com `filter` em vez de `count` indexado tem custo desprezível nos volumes locais.
- **Dependências:** nenhuma.
- **Critérios de aceite:**
  1. Com N exercícios novos e 0 tentativas, a barra não mostra contador de revisões.
  2. Com K revisões vencidas, a barra e o dashboard mostram K.
  3. O `aria-label` corresponde ao que é contado.
- **Testes:** um E2E de regressão estendendo o teste do contador existente, com exercícios novos e vencidos.

### E4. Mensagens verdadeiras na troca de cor (P3-1 e P3-4)

- **Problema:** §2.4, além dos toasts sem cobertura.
- **Solução recomendada:** quando a derivação falha depois de salvar, mostrar "Cor salva. Os exercícios não puderam ser gerados agora; o app tentará de novo na próxima abertura." Os textos de "Cor removida", "serão gerados quando a análise terminar" e a nota de partidas sem cor da Evolução ganham E2E.
- **Benefício:** o usuário não refaz uma ação que já deu certo nem perde a confiança no app.
- **Risco:** muito baixo.
- **Dependências:** nenhuma.
- **Critérios de aceite:**
  1. Com falha simulada na derivação, a cor fica gravada e a mensagem diz isso.
  2. Os três textos acima são cobertos por E2E.
- **Testes:** um unitário/integração com o motor falhando e três verificações E2E.

### E0. Pré-condições (não são implementação)

- ~~Integrar o PR #5 com merge commit e conferir a CI do push na `main`~~: **feito** (`e63c59b`, run `42384359803`). Falta atualizar a `main` local antes de criar a branch da 4.4.
- Atualizar a baseline para o novo SHA da `main`.
- Corrigir o cabeçalho desatualizado do `SPRINT4-3-RELATORIO.md`. Proposta: fazer isso no primeiro commit da 4.4.

## 4. Escopo opcional

Só entra se o essencial terminar com folga.

### O1. Revalidar o erro na profundidade da árvore (§2.5)

- **Primeiro passo (investigação):** um teste com o motor real, ou com motor roteirizado, de um erro que a profundidade 11 classifica como `mistake` e a 16 aceita.
- **Se confirmado:** `deriveFromAnalysis` descarta o exercício quando o lance jogado está entre os `accepted` da raiz da árvore.
- **Aceite:**
  - nenhum exercício novo tem o lance da partida entre os aceitos da raiz;
  - um teste cobre o descarte;
  - a contagem de "exercícios novos" do toast reflete o descarte.
- **Risco:** baixo a médio. Pode reduzir o número de exercícios gerados, e é essa a intenção.
- **Decisão relacionada:** D4.

### O2. Exercícios do lado antigo ao trocar a cor

- Só entra com a decisão D3 tomada.
- Se a escolha for "apagar":
  - os exercícios **sem tentativas** do lado antigo são removidos;
  - os que têm tentativas são mantidos, para não destruir histórico.
- **Aceite:** depois de trocar brancas → pretas, não sobra exercício sem tentativas das brancas daquela partida, e o limite por partida vale para o lado atual.

## 5. Backlog

Não recomendado para a 4.4:

| Item | Motivo |
|---|---|
| P3-2: falha no carregamento sob demanda de uma tela | Improvável em app local estático. Reavaliar com PWA ou atualizações frequentes |
| P3-3: limite de 3 passadas | Impacto só no texto do toast, e a reconciliação corrige o estado |
| Reconciliação também depois de restaurar backup | Hoje vale na próxima abertura, o que é aceitável |
| Débito 2: limites de classificação gravados na análise | Muda o formato dos dados e tem baixo impacto |
| Débito 3: layout em 768 px | Só se tablet virar alvo |
| Débito 4: mate pelo `measureAfter` recebe "Excelente" | Subavalia sem criar erro |
| Débito 7: ESLint | Útil, mas sem urgência. Exige dependência nova, então só com decisão explícita |
| Acerto 10 min depois de revelar | Observar com dados reais antes de mudar (§2.6) |
| Calibrar a dificuldade pelo desempenho | Sem volume de dados local que sustente |
| Taxa independente agregada com amostra mínima | Refinamento de apresentação |

## 6. Ordem de implementação

1. **E0** (pré-condições): merge do PR #5 autorizado, CI da `main` verde, nova branch a partir da `main` atualizada, cabeçalho do relatório corrigido.
2. **E1**: datas das evidências. Vem primeiro porque muda os dados que alimentam o perfil e o gráfico. Validar com testes e no navegador, numa origem isolada com partidas datadas, **antes** de seguir. E2 também mexe na evidência e, se viesse junto, o efeito de cada mudança ficaria indistinguível.
3. **E2**: dica 3 como revelação. Validar o SRS e o perfil depois de uma sessão manual curta.
4. **E3 e E4**: correções pequenas de interface e mensagens, independentes entre si.
5. **O1**: começa pelo teste de investigação. Só implementa se a hipótese se confirmar.
6. **O2**: só com D3 decidida.
7. Verificação final segundo `BASELINE-MAIN.md` §10, revisão de código independente e relatório `SPRINT4-4-RELATORIO.md`.

## 7. Critérios de aceite da sprint

- Todos os critérios de E1–E4 atendidos e cobertos por teste.
- Nenhuma mudança de schema: `SCHEMA_VERSIONS` continua `[1, 2]`, sem índices novos.
- Nenhuma dependência nova. `public/engine`, `scripts` e `src/services/engine` sem alteração.
- Nenhuma chamada de rede nova.
- Nenhum exercício ou tentativa existente é apagado. As únicas reescritas são o `at` das evidências de partida (E1).
- Números iguais ou maiores que os da 4.3 (348 Vitest, 21 com motor real, 49 Playwright) e cobertura ≥ 80% em `src/services` e `src/db`.
- CI verde no SHA final do PR.

## 8. Estratégia de testes

| Camada | O quê |
|---|---|
| Unitários | `eventsFromGame`/`deriveFromAnalysis` com datas (válida, ausente, inválida, futura), `exerciseOutcome`/`outcomeOf` com dica 3, contador de revisões |
| Integração (`fake-indexeddb`) | Recálculo das evidências antigas: idempotente, sem tocar em exercícios e eventos de exercício ou abertura, sem recriar exercícios apagados |
| Prova por mutação | Para E1, E2 e E3, desfazer a correção e confirmar que algum teste falha, como na 4.3 |
| Stockfish real | Suíte atual inalterada. O1 acrescenta um caso só se a hipótese for confirmada |
| E2E (porta 4176) | Partida datada → `at` correto; dica 3 → tentativa revelada; contador da barra; mensagens da troca de cor |
| Manual | Origem isolada (`http://audit.localhost:5174/`) com 2–3 partidas datadas em meses diferentes, conferindo o gráfico de evolução antes e depois de E1 |

## 9. Riscos e dependências

| Risco | Mitigação |
|---|---|
| O perfil do usuário muda visivelmente depois de E1 | É a correção pretendida. Explicar no relatório e, se você quiser, num aviso único na tela de Evolução |
| O recálculo de E1 recria exercícios apagados de propósito | O recálculo toca **só** em `skillEvents` com `source: 'game'`, sem chamar o motor nem `addExercise`, e tem teste específico |
| Partidas sem data viram "antigas demais" ou "recentes demais" | Decisão D1-b explícita e testada |
| E2 parece punitivo | Aviso antes da dica 3, e as dicas 1 e 2 continuam valendo como ajuda |
| Começar a 4.4 antes do merge do PR #5 | E0 é bloqueante |

## 10. Decisões que dependem de aprovação

### D1-a. Como tratar as evidências de partida já gravadas (E1)

| Alternativa | Consequência |
|---|---|
| **(A) Recalcular uma vez ao abrir o app (recomendada)** | Só regrava o `at` dos `skillEvents` de partida, sem o motor. É idempotente: se o `at` já bate com a data esperada, não muda nada. Pode rodar em toda abertura com custo O(partidas). Dispensa marca nova. O perfil fica coerente imediatamente |
| (B) Só para derivações novas | Nenhuma reescrita, mas o perfil mistura duas noções de data até cada partida ser derivada de novo, o que na prática pode nunca acontecer |
| (C) Remapear na leitura (usar a data da partida ao calcular o perfil) | Nenhuma escrita, mas a regra fica espalhada por todo leitor de `skillEvents` (perfil, gráfico, sessão) e o dado gravado continua "errado" |

### D1-b. Data de referência para partidas sem data válida no PGN

| Alternativa | Consequência |
|---|---|
| **Data de importação (recomendada)** | A partida foi jogada no máximo nessa data. É estável e não muda ao reanalisar |
| Data da análise (comportamento atual) | Muda a cada reanálise e repete o problema em menor escala |
| Excluir do decaimento (peso sem idade) | Exige uma regra especial no estimador |

### D2. Política da dica 3 (E2)

| Alternativa | Consequência |
|---|---|
| **Dica 3 = solução revelada (recomendada)** | Crédito 0, volta em 10 min, conta como "revelada" |
| Manter "com ajuda", mas SRS como falha | Só corrige o reagendamento. "Acertos" continua contando o lance fornecido |
| Manter como está | O perfil continua sem distinguir dificuldade de desconhecimento |

### D3. Exercícios do lado antigo ao trocar a cor (pendente desde a 4.3)

| Alternativa | Consequência |
|---|---|
| Manter (atual) | Nada se perde. A partida pode ter exercícios dos dois lados, acima do limite |
| **Apagar só os sem tentativas (recomendada, se for decidir agora)** | Remove o que nunca foi usado e preserva o histórico |
| Apagar todos com as tentativas | Mais limpo, mas destrói histórico. Exigiria confirmação na interface |

### D4. A análise rápida deve gerar exercícios? (O1)

| Alternativa | Consequência |
|---|---|
| **Sim, com revalidação na profundidade da árvore (recomendada, se O1 confirmar a hipótese)** | Mantém o fluxo rápido e elimina falsos erros |
| Não: só a análise completa gera exercícios e evidências | Mais seguro, porém mais lento. Muda o fluxo atual e o E2E |
| Manter como está | Risco de exercícios sem erro real (a confirmar) |

## 11. Tamanho estimado

**Média**, comparável à 4.3:

| Bloco | Tamanho |
|---|---|
| E1 (data das evidências) | ~40% do esforço. Maior risco, por envolver dados existentes |
| E2 (dica 3 como revelação) | ~25% |
| E3 e E4 (contador e mensagens) | ~15% |
| O1 (investigação e, se confirmado, descarte) | ~20% |

O2 só com D3 decidida. Validação, revisão e relatório estão incluídos nas porcentagens.
