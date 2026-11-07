# Sprint 4.3 — Ciclo partida → exercício → perfil sem falhas silenciosas

- **Branch:** `feat/sprint4-3-reliable-training-loop`, criada a partir de `main` em `4445f72` (CI pós-merge do PR #4: run `42342167980`, sucesso).
- **Data:** 2026-11-07.
- **Situação:** integrada na `main` pelo PR #5 (merge commit `e63c59b`, 2026-11-07). Commits: `1031e60` (sprint) e `7870a0a` (correções da auditoria, §6). CI pós-merge verde (run `42384359803`). Ver `SPRINT4-3-AUDITORIA-POS-MERGE.md`.
- **Origem:** auditoria de entrada da Sprint 4.3, com escopo aprovado pelo usuário.

## 1. Objetivo

Tornar confiável o ciclo central do produto (partida → exercício → perfil):

- nenhuma etapa falha sem aviso;
- a primeira mudança de esquema não pode apagar dados;
- uma tela com dado inválido não deixa o app em branco.

Sem mudança de esquema e sem tocar no Stockfish.

## 2. Itens

### 2.1 Guarda de versionamento do Dexie (débito 5 da baseline — P0 condicional)

**Problema.** O esquema completo estava declarado em `version(SCHEMA_VERSION)` e a migração em `version(2).stores({})`, sem `version(1)`. O `ARCHITECTURE.md` mandava "incrementar `SCHEMA_VERSION`". Seguir essa instrução levaria bancos v1 e v2 a abrir com `games` e `exercises` vazios (simulação registrada na baseline, §8).

**Correção** em `src/db/database.ts`:

- O histórico ficou explícito em `SCHEMA_VERSIONS`: a v1 tem a lista completa de tabelas (idêntica à do MVP, `ef447c1`); a v2 não muda tabelas e converte os exercícios antigos.
- `defineSchema()` declara o histórico. `SCHEMA_VERSION` passa a ser derivado da última entrada e não consegue mais divergir das declarações.
- Para mudar o esquema, **acrescenta-se** uma entrada. O `ARCHITECTURE.md` foi corrigido.

Bancos reais não sofrem nenhuma mudança: a versão continua 2 e as tabelas e índices são os mesmos.

Testes (`tests/persistence.test.ts`, bloco "schema migration"):

| Teste | O que garante |
|---|---|
| Declarações explícitas | As versões são `[1, 2]`, a última é `SCHEMA_VERSION` e a v1 declara todas as `TABLE_NAMES` |
| v1 com tabelas populadas → v2 | games, exercises, attempts e bookmarks preservados; exercício convertido em árvore |
| v2 criado pelas declarações antigas | Abre sem alterar as linhas (é o estado dos bancos reais hoje) |
| v3 simulado a partir de v1 e de v2 | Acrescentar uma versão não apaga nada |

### 2.2 Cor do jogador definida depois da análise (bug A — P1)

**Problema.**

- Sem a cor, a análise concluída não gerava exercícios nem evidências.
- Definir a cor depois não fazia nada, porque `setUserColor` só gravava a partida.
- O toast dizia "Exercícios e perfil atualizados", e o aviso prometia atualização "automática" que não acontecia.

**Correção** (`src/services/analysis/analysisRunner.ts`):

- `changeUserColor` grava a cor e, se a análise já estiver concluída, gera na hora os exercícios e as evidências daquele lado, **sem reanalisar**.
- **Remover a cor** apaga as evidências daquela partida, porque não se sabe mais quais lances eram do jogador.
- **Trocar de lado** substitui as evidências. Os exercícios já criados **não são apagados** (para não destruir histórico de tentativas). Fica registrado como decisão pendente do usuário (§6).
- `startAnalysis` devolve `{ analysis, derivation }`. Os toasts dizem a verdade:
  - "Defina sua cor…" quando a cor falta;
  - "Perfil atualizado; nenhum exercício novo." quando nada foi criado;
  - "Perfil atualizado e N exercício(s) novo(s)." nos demais casos.
- Uma cor definida durante a análise é a que vale quando ela termina. A tela de partidas avisa: "Os exercícios serão gerados quando a análise terminar".

**Concorrência** (achados M1 e M2 da revisão):

- As derivações de uma mesma partida rodam em fila, na ordem das chamadas.
- Antes de gravar cada exercício, a cor é conferida de novo, porque montar a árvore de solução demora.
- Se a cor mudou durante a derivação, a derivação é refeita com a cor nova (até 3 passadas).
- `setUserColor` agora roda numa transação.
- Uma partida apagada durante a análise não ganha evidências nem exercícios.

Testes: `tests/user-color.test.ts` (11 casos) e o E2E `e2e/reliability.spec.ts` (importar sem nome → analisar → toast pede a cor → escolher "Brancas" → exercícios e evidências gravados).

### 2.3 Estatísticas sem a cor (bug B — P1)

`errorDistribution` contava os lances dos dois lados quando a cor faltava, misturando os do adversário. Agora essas partidas ficam de fora, e a Evolução mostra quantas foram excluídas e por quê. Testes em `tests/navigation-stats.test.ts`.

### 2.4 Error boundary (P1)

Novo `src/components/feedback/RouteErrorBoundary.tsx`, montado em volta do conteúdo das rotas no `AppShell`.

- Um erro de renderização mostra "Não foi possível exibir esta tela", com "Voltar ao dashboard" e "Tentar de novo".
- A navegação continua disponível.
- Trocar de rota limpa o erro.
- O erro vai para o console local (sem telemetria).

Teste: E2E com um exercício de FEN inválida.

### 2.5 Itens pequenos (P2)

- **Contador "Revisões pendentes"** (débito 1): usa a contagem completa de posições marcadas. O E2E de regressão existente ganhou a verificação "7".
- **Playwright isolado** (débito 6):
  - porta dedicada **4176**;
  - `reuseExistingServer: false`;
  - build novo em toda execução local.
  Um `vite preview` esquecido agora faz a execução falhar em vez de testar código antigo. A CI não muda.
- **Documentação:**
  - `ARCHITECTURE.md`: instrução de versionamento e fluxo de dados;
  - `README.md`: PGN colado, selos, sessão guiada, cor do jogador, porta do E2E e plano da sessão fora do backup.

## 3. Restrições respeitadas

- **Esquema:** continua v2, com as mesmas tabelas e índices; nenhuma migração nova.
- **Stockfish:** `public/engine`, `scripts` e `src/services/engine` sem alteração.
- **Projeto:** `package.json`, lockfile e CI sem alteração.
- **Rede:** nenhuma chamada nova.
- **Backup:** formato inalterado.
- **Dados existentes:** nenhum exercício é apagado pelas mudanças novas. A única remoção nova são as evidências de partida (`skillEvents` com `source: 'game'`) de uma partida cuja cor foi removida. Elas são recalculáveis.
- **Ambiente local:** a pasta `.claude/` foi preservada, e o processo antigo na porta 4173 não foi encerrado.

## 4. Resultados

| Verificação | Baseline | Sprint 4.3 |
|---|---|---|
| typecheck | ok | ok |
| Vitest | 322 (21 arquivos) | **339** (22 arquivos) |
| Stockfish real (isolado) | 21 | 21 |
| Cobertura (`src/services`, `src/db`) | linhas 90,97 · statements 87,14 · branches 80,15 · funções 82,87 | linhas **93,26** · statements **89,51** · branches **82,03** · funções **85,50** |
| Build | ok | ok (feito pelo Playwright local) |
| Playwright | 47 | **49** (+2 em `reliability.spec.ts`), porta 4176 |

## 5. Revisão de código

Um agente revisor independente aprovou a mudança, sem achados críticos ou altos. Confirmou a semântica do Dexie: um banco v2 existente abre sem diferença de esquema, e acrescentar uma v3 não remove tabelas.

| Achado | Gravidade | Situação |
|---|---|---|
| Cor trocada durante a derivação era perdida | Média | Corrigido (fila + reconferência) e coberto por teste |
| Trocas rápidas rodavam derivações em paralelo | Média | Corrigido (fila por partida) e coberto por teste |
| `setUserColor` sem transação | Média | Corrigido |
| Partida apagada no meio da análise ainda era derivada | Baixa | Corrigido e coberto por teste |
| Sem aviso ao definir a cor com análise em andamento | Baixa | Corrigido |
| "Voltar ao dashboard" não limpava o erro quando a tela que falhou é o próprio dashboard | Baixa | Corrigido |
| O teste do "v2 antigo" monta o banco à mão | Residual | A lista de tabelas foi conferida contra `ef447c1` e `4445f72`, e é idêntica |

## 6. Correções da auditoria do PR #5

A auditoria independente do PR #5 (veredito "aprovado com ressalvas", sem P0/P1) apontou três P2. O usuário pediu que fossem corrigidos antes do merge.

### 6.1 P2-1: troca de cor interrompida

**Problema.** A cor era gravada antes da derivação, que leva segundos (o motor monta as árvores de solução). Se a aba fechasse no meio, a cor ficava salva com exercícios parciais e evidências desatualizadas, e nada refazia o trabalho.

**Correção:**

- `GameAnalysis.derivation` (`'pending' | 'done'`): campo novo, **não indexado**, sem mudança de esquema; vai no backup junto com a análise.
- Fica `'pending'` **na mesma transação** que salva a cor (`saveColorMarkingPending`) ou que grava a análise concluída (`startAnalysis`).
- Fica `'done'` só quando exercícios e evidências foram gerados para a cor ainda salva (`markDerived`, que confere a cor na mesma transação).
- Ao abrir o app, depois de `recoverInterruptedAnalyses`, `reconcileDerivations` refaz as derivações `'pending'`. O motor só é iniciado se houver alguma.
- Análises anteriores à Sprint 4.3 (sem o campo) e as `'done'` não são tocadas: dados de treino apagados de propósito em Configurações não são recriados.
- **A derivação passou a poder ser repetida sem efeito colateral.** As posições escolhidas excluem só os exercícios de *outras* partidas, e os exercícios que a partida já tem são pulados antes de chamar o motor.
  - Retomar uma derivação parcial completa o conjunto sem ultrapassar `maxExercisesPerGame`.
  - Também deixou de acontecer, ao voltar para a cor anterior (brancas → pretas → brancas), a escolha de posições novas além do limite.
- **Revisão de código** das correções: aprovada, sem achados críticos ou altos. Corrigi o achado médio e um baixo:
  - uma partida cuja derivação falha não bloqueia mais as outras: ela continua `'pending'`, o erro vai para o console e ela é tentada de novo na próxima abertura;
  - a marca é relida dentro da fila da partida, então duas reconciliações simultâneas (efeito repetido, outra aba) não refazem o trabalho do motor.

  Ficaram registrados, sem mudança:
  - a reconciliação roda só ao abrir o app (depois de restaurar um backup com marcas `'pending'`, vale na próxima abertura);
  - um exercício montado sem árvore porque o motor falhou recebe `'done'` assim mesmo (comportamento anterior);
  - trocar de cor ida e volta pode deixar exercícios dos dois lados acima do limite por partida (anterior; ligado à decisão pendente sobre os exercícios do lado antigo).

### 6.2 P2-2 e P2-3: testes que não provavam o que diziam

- **P2-2.** Novo teste: com eventos de exercício, de abertura e de outra partida no banco, remover a cor apaga só os eventos `source: 'game'` daquela partida.
- **P2-3.** Novo teste com o motor retido num portão:
  - enquanto a derivação das brancas está parada no motor, a troca para pretas fica na fila e não termina;
  - ao liberar, as duas terminam na ordem `w`, `b`;
  - o estado final é só das pretas e `derivation` fica `'done'`.

### 6.3 Prova de que os testes detectam as falhas

Cada correção foi desfeita temporariamente para confirmar que algum teste falha:

| Mutação | Teste que falhou |
|---|---|
| Fila por partida removida | P2-3 (ordem `w`, `b`) |
| Remoção sem filtrar `source: 'game'` | P2-2 |
| Escolha excluindo também os exercícios da própria partida (comportamento antigo) | Derivação parcial sem ultrapassar o limite |
| Troca de cor sem marcar `'pending'` | Marca `'pending'` durante a derivação |
| Reconciliação ignorando a marca | Retomada na inicialização; análises `'done'` e antigas intocadas |
| `App` sem chamar `reconcileDerivations` | E2E `reliability.spec.ts` (retomada após recarregar) |
| Reconciliação sem `try/catch` por partida | Partida com falha não bloqueia as outras |
| Reconciliação sem reler a marca na fila | Partida já concluída por outra execução não é refeita |

### 6.4 Resultados

| Verificação | Antes | Depois |
|---|---|---|
| typecheck | ok | ok |
| Vitest | 339 | **348** (+9 em `user-color.test.ts`) |
| Playwright | 49 | **49** (o E2E da cor ganhou a etapa de retomada após recarregar) |

Os P3 da auditoria (mensagem de erro quando a derivação falha depois de a cor ser salva, boundary para falha de carregamento de tela, limite de passadas, toasts sem E2E) **não foram alterados**; continuam registrados para decisão.

## 7. Decisões pendentes e backlog

- **Decisão do usuário:** ao trocar a cor de uma partida, apagar os exercícios do lado antigo (e as tentativas deles)? Hoje eles são mantidos.
- **Visto e não corrigido (fora do escopo):** o contador "Treinar" da barra lateral (`AppShell.tsx`) conta exercícios novos nunca tentados como "revisões pendentes", enquanto o dashboard conta só revisões vencidas (`isDueReview`).
- **Continuam no backlog** (sem mudança): débitos 2 (limites gravados na análise), 3 (layout em 768 px), 4 (mate pelo `measureAfter`) e 7 (ESLint).
- **Teste em celular físico:** não necessário para esta sprint, que não teve mudança de layout. O boundary e os toasts usam componentes existentes.
