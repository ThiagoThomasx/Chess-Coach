# Sprint 4.3 — Ciclo partida → exercício → perfil sem falhas silenciosas

- **Branch:** `feat/sprint4-3-reliable-training-loop`, criada a partir de `main` em `4445f72` (CI pós-merge do PR #4: run `42342167980`, sucesso).
- **Data:** 2026-11-07.
- **Situação:** implementado e testado localmente. **Nada foi commitado, enviado ou aberto como PR**: isso aguarda a autorização do usuário.
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

## 6. Decisões pendentes e backlog

- **Decisão do usuário:** ao trocar a cor de uma partida, apagar os exercícios do lado antigo (e as tentativas deles)? Hoje eles são mantidos.
- **Visto e não corrigido (fora do escopo):** o contador "Treinar" da barra lateral (`AppShell.tsx`) conta exercícios novos nunca tentados como "revisões pendentes", enquanto o dashboard conta só revisões vencidas (`isDueReview`).
- **Continuam no backlog** (sem mudança): débitos 2 (limites gravados na análise), 3 (layout em 768 px), 4 (mate pelo `measureAfter`) e 7 (ESLint).
- **Teste em celular físico:** não necessário para esta sprint, que não teve mudança de layout. O boundary e os toasts usam componentes existentes.
