# Auditoria pós-Sprint 4.5 — estado consolidado da `main`

Auditoria de leitura e execução sobre a `main` depois do merge do PR #8. Nenhum código funcional, dado, schema ou dependência foi alterado. As únicas alterações desta execução são este documento, `SPRINT4-6-PLANEJAMENTO.md` e a atualização justificada de `BASELINE-MAIN.md`. Nenhum commit, push, PR ou merge foi feito.

Legenda: **[F]** fato verificado no código, repositório ou GitHub · **[E]** resultado de execução nesta auditoria · **[I]** inferência, com a evidência indicada.

## 1. Estado do repositório

| Item | Valor |
|---|---|
| Diretório | `C:\Users\thiag\Documents\Chess-Coach`, remoto `origin` = `https://github.com/ThiagoThomasx/Chess-Coach.git` |
| Antes da sincronização | branch `feat/sprint4-5-consistent-profile` em `5f4bf74` (igual ao remoto, sem commits locais). `main` local em `edf4de8`, 6 commits atrás de `origin/main`, sem commits próprios |
| Sincronização | `git fetch origin` → `git checkout main` → `git merge --ff-only origin/main` (fast-forward, sem reset, clean, stash ou force) |
| Depois | branch `main`, `HEAD` = `origin/main` = **`302f7a9f4c9d202fec99e2fa455e884693a8970b`**. `302f7a9` é o merge do PR #8, com pais `edf4de8` e `5f4bf74` |
| Arquivos locais | `.claude/launch.json` (configuração local de servidores de desenvolvimento, não versionada e não ignorada). Preservado e não tocado |
| Stash | nenhum |

## 2. Validação técnica [E]

Executada na `main` em `302f7a9`, depois de `npm ci` (165 pacotes; `package-lock.json` sem alteração). Node 24.16.0, npm 11.13.0.

| Verificação | Comando | Resultado |
|---|---|---|
| Arquivos do motor | `sha256sum` de `public/engine/*` contra `node_modules/stockfish/bin` | idênticos (`ccb130d7…`, `ee4f115b…`, os mesmos da baseline) |
| Typecheck | `npm run typecheck` | ok |
| Vitest | `npx vitest run` | **401/401** (24 arquivos) |
| Stockfish real isolado | `npx vitest run tests/engine-integration.test.ts` | **23/23** (também passa dentro da suíte completa) |
| Cobertura (`src/services/**`, `src/db/**`) | `npm run coverage` | linhas **93,77%** (2004/2137) · statements 90,30% · branches **83,09%** · funções 87,22% |
| Build | `npm run build` | ok |
| Playwright | `npx playwright test` (servidor próprio na porta 4176, sem reaproveitar servidor) | **59/59**, sem novas tentativas |
| Chamadas de rede | busca por `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` e URLs em `src/` e `index.html` | nenhuma |

Os números são os mesmos da CI pós-merge (run `42444231825`). Nenhum teste depende de serviço externo.

## 3. Achados de arquitetura e integridade

### 3.1 O que está sólido [F]

- **Dexie:** schema v2 inalterado, com histórico explícito em `SCHEMA_VERSIONS`. Os índices usados pelas consultas novas (`source`, `gameId`, `ref.exerciseId`) existem desde a v1, e nenhuma migração está pendente.
- **Relações e exclusões:**
  - `deleteGame` remove análise, marcadores, exercícios, tentativas e todas as evidências da partida e dos exercícios, numa única transação.
  - `deleteExercise` faz o mesmo para o exercício.
  - A limpeza de evidências órfãs na abertura é idempotente e não toca evidências de partida nem de abertura.
- **Tentativas:** `recordAttempt` relê o exercício na própria transação. Se ele foi removido, nada é gravado. O SRS é calculado sobre o estado gravado.
- **Derivação e troca de lado:**
  - `addExercise` confere a cor da partida na transação de escrita.
  - `markDerived` só conclui se a cor ainda é a usada.
  - A fila por partida serializa as derivações dentro da aba, e as transações garantem a consistência entre abas.
- **Backup:** valida antes de gravar e restaura tudo ou nada; as tabelas ausentes do arquivo ficam como estão. A ressalva do backup editado à mão sem `exercises` está documentada em `METHODOLOGY.md`.
- **Diagnóstico histórico e evolução recente:**
  - O histórico é calculado sem decaimento.
  - Taxa recente, tendência e queda usam 30 dias, mínimo de 4 eventos e um único tipo de evidência.
  - "Precisa revisar" pelo limite fraco é medido só sobre as evidências recentes (FA-1/FA-7).
  - Dashboard, Evolução e recomendações usam o mesmo `estimateProfile`.
- **Inicialização:** quatro etapas independentes (`App.tsx`), cada uma com o próprio tratamento de erro.
- **Sessão guiada:** o plano fica no `localStorage`, expira no fim do dia, tem retomada coberta por E2E e não entra no backup.
- **Stockfish:** WASM *lite* single-thread em Worker, sem rede, com testes reais.

### 3.2 Achados

| ID | Tipo | Sev. | Achado | Evidência |
|---|---|---|---|---|
| **PA-1** | Dívida técnica (desempenho) | **P2** | Durante uma análise, **cada posição** analisada regrava o objeto `GameAnalysis` inteiro (`gameAnalyzer.ts:107-111` → `onProgress` → `saveAnalysis`). Cada gravação dispara de novo os `useLiveQuery` abertos que leem **todas** as análises com suas `positions`: dashboard (`DashboardPage.tsx:22`), Partidas (`GamesPage.tsx:31`, que só precisa do status), Evolução e treino (`useTrainingLoop.ts:25`). O custo é proporcional a (posições da partida) × (tamanho de todas as análises) | [F] código. [I] impacto: com centenas de partidas analisadas, a página aberta clona dezenas de MB por lance analisado. Não medido nesta auditoria |
| **PA-2** | Dívida técnica | P3 | `addExercise` deduplica com varredura completa (`exercises.filter(fenKey…)`), e `deriveFromAnalysis` lista todos os exercícios a cada derivação | [F] `trainingRepo.ts:35`, `analysisRunner.ts:124`. Já registrado como débito ("índice contra duplicados") |
| **PA-3** | Documentação | P3 | `SPRINT4-5-RELATORIO.md` ainda diz "commit `64974b0`, PR #8 aberto", e a baseline descrevia `edf4de8` | [F]. A baseline foi atualizada nesta execução (§8); o relatório da 4.5 não, por restrição desta tarefa |

Não encontrei P0 nem P1.

## 4. Achados de produto e UX

Avaliação feita como treinador de xadrez, a partir do código das telas, dos textos e dos fluxos cobertos pelo E2E.

| ID | Tipo | Problema concreto de uso | Evidência |
|---|---|---|---|
| **PX-1** | Melhoria pedagógica (alto impacto) | Um lance errado num exercício recebe só um número: "X não resolve: a expectativa cai 23,4 p.p. em relação ao melhor lance (tolerância 5)". O usuário não vê **a resposta do adversário que pune o lance**, nem a consequência (peça perdida, mate). "p.p." e "expectativa" são jargão. A busca que gerou o veredito já calculou essa linha, mas `MoveAssessment` guarda só os placares | [F] `sequence.ts:205-209, 327` |
| **PX-2** | Melhoria pedagógica | Na análise, um erro sem motivo tático verificado mostra só a avaliação e o melhor lance (confiança "limited"), sem a linha que mostra o problema | [F] `explain.ts:338` |
| **PX-3** | UX / ciclo | Erro da partida e exercício derivado não se conectam na análise: nada indica que o lance virou exercício. "Criar exercício desta posição" só responde "Já existe um exercício para esta posição", sem link. O exercício leva à partida de origem ("Origem e histórico"), mas não mostra a explicação do erro original | [F] `ExplanationPanel.tsx:56-70`, `ExerciseDetails.tsx:38-40` |
| **PX-4** | Oportunidade de produto | Nenhuma métrica responde "minhas **partidas** estão melhorando?". A Evolução mede exercícios, competências e atividade, mas não erros graves por partida ao longo do tempo | [F] `stats.ts` (sem função desse tipo) |
| **PX-5** | Métrica de pouca utilidade | "Análises feitas por dia" (Evolução) mede uso do app, não aprendizado | [F] `ProgressPage.tsx:121-123`, `analysesOverTime` |
| **PX-6** | UX | Três contagens de "pendente", com regras diferentes: barra lateral (revisões vencidas), dashboard (revisões + posições marcadas) e tela Treinar (novos + vencidos). Os rótulos explicam, mas o usuário vê três números para "o que falta fazer" | [F] `AppShell.tsx`, `DashboardPage.tsx`, `TrainingPage.tsx` |
| **PX-7** | UX (débito 3 da baseline) | Em 768 px as ações do exercício ficam abaixo da dobra | [F] baseline, ainda aberto |

**O que funciona bem.** O "Seu próximo treino" explica o motivo e cita os lances de origem (links "Baseado em"). Os estados vazios dizem o que fazer. A sessão guiada é bem conectada às recomendações. As explicações de erros táticos verificados são boas e proporcionais.

## 5. Reavaliação de FA-2 a FA-6

| Item | Ainda existe? | Reproduzido | Impacto real | Risco técnico | Condições | Esforço | Recomendação |
|---|---|---|---|---|---|---|---|
| **FA-2**: série de comparação escolhida em todo o histórico | Sim | **Sim**: 6 exercícios bons há 300 dias + 30 lances de partida errados nos últimos 10 dias → taxa recente "—", tendência desconhecida. O estado (`needs_review`) sai correto | Baixo: falta informação, nada fica incorreto | Baixo | Jogador que fez exercícios há muito tempo e hoje só analisa partidas | Pequeno | **Postergar** (Alternativa A, ou 4.7) |
| **FA-3**: UTC aplicado a horários reais | Sim | **Sim**, com `TZ=America/Sao_Paulo`: partida sem `[Date]` importada em 07/11 às 23h30 → gráfico em `2026-11-08`; exercício em 31/10 às 22h → linha histórica "11/2026" | Baixo: dia ou mês deslocado só na exibição | Baixo | Partida sem data importada entre 21h e meia-noite; evento na virada do mês à noite | Pequeno | **Corrigir na 4.6** (trivial, toca a mesma área de B3) |
| **FA-4**: "Pendentes (N)" parado no tempo | Sim | Por inspeção: `TrainingPage.tsx` não usa `useMinute` | Baixo | Nenhum | Tela Treinar aberta quando uma revisão vence | Trivial | **Corrigir na 4.6** |
| **FA-5**: sem testes da inicialização e da região viva | Sim | Sem testes (`grep` em `tests/` e `e2e/`). A região viva do solucionador é criada junto com o texto (`ExerciseSolver.tsx:98-99`) | Médio para quem usa leitor de tela; baixo para os demais | Baixo | Sempre | Pequeno | **Corrigir na 4.6 a parte do solucionador** (B1 mexe nesse feedback); **postergar** o teste da inicialização |
| **FA-6**: concorrência entre abas só testada em ordem sequencial | Sim | Por inspeção | Baixo: a garantia vem das transações do IndexedDB, já analisadas | Baixo | — | Médio | **Postergar** (aceitar como dívida de teste) |

Nenhum dos cinco foi encerrado como resolvido: todos continuam existindo na `main`.

## 6. Novos débitos identificados

| ID | Classe | Sev. | Resumo | Encaminhamento |
|---|---|---|---|---|
| PA-1 | Dívida técnica (desempenho) | P2 | Gravação por posição + consultas que leem todas as análises | 4.6 (necessário antes de B3) |
| PA-2 | Dívida técnica | P3 | Deduplicação de exercícios por varredura | Backlog (já registrado) |
| PA-3 | Documentação | P3 | Situação desatualizada no relatório da 4.5 | Próxima alteração documental |
| PX-1 | Melhoria pedagógica | — | Refutação ausente no exercício | 4.6 (B1) |
| PX-2 | Melhoria pedagógica | — | Erro posicional sem linha explicativa | Depois de B1 (reaproveita a mesma ideia) |
| PX-3 | UX / ciclo | — | Erro ↔ exercício desconectados na análise | 4.6 (B2) |
| PX-4/PX-5 | Oportunidade de produto | — | Sem métrica de partidas melhorando; gráfico de atividade pouco útil | 4.6 (B3) |
| PX-6 | UX | P3 | Três contagens de "pendente" | Backlog |

**Limitações conhecidas do Stockfish Lite** (não são bugs): força e profundidade menores que o motor completo, linhas curtas em profundidade baixa e variação de resultado com o estado de hash. Essas limitações já moldam as tolerâncias e a margem de incerteza do solucionador.

## 7. Perspectiva de produto

- **Experiência coerente de treinador pessoal?** Em grande parte, sim. Importar → analisar → exercícios derivados → sessão guiada → perfil e recomendação forma um ciclo real, local e honesto com os dados ("nenhum número é inventado").
- **Principal gargalo para o usuário evoluir:** entender **por que** o lance falha no momento do erro, no exercício e na análise de erros não táticos. Hoje o app diz *que* errou e *quanto*.
- **Explica ou só classifica?** Explica bem os erros táticos verificados. Nos demais casos, e no exercício, fica no veredito numérico (PX-1, PX-2).
- **O ciclo está conectado?** O meio está (erros recorrentes → tema → sessão). As pontas não: o erro da partida não leva ao seu exercício (PX-3), e não há retorno sobre se as partidas melhoram (PX-4).
- **Pouco útil ou redundante:** "Análises feitas por dia" e as três contagens de pendentes.
- **Maior impacto pedagógico na próxima sprint:** mostrar a refutação do lance errado no exercício (PX-1). O dado já existe e a mudança atinge o momento em que o usuário mais aprende.

## 8. Atualização do `BASELINE-MAIN.md`

**Motivo:** divergência objetiva. A baseline descrevia `edf4de8` (antes do PR #8), com 370/21/53 testes e "nenhum PR #8". A `main` agora está em `302f7a9`, com 401/23/59. Atualizei o commit de referência, a tabela de PRs, os resultados de testes e cobertura, os débitos e a referência a esta auditoria. Nenhuma regra ou procedimento foi alterado.

## 9. Limitações desta auditoria

- **UX avaliada pelo código, pelos textos e pelos fluxos do E2E.** Não fiz uma sessão manual com dados reais nem testei em celular físico.
- **PA-1 está demonstrado no código, mas a magnitude não foi medida.** Não montei uma biblioteca sintética grande; a medição faz parte do escopo proposto.
- **FA-4 e FA-6 foram confirmados por inspeção, não reproduzidos.**
- **A correção pedagógica das explicações não foi auditada posição por posição.** Ela foi avaliada pelas regras do código e pelos testes existentes.
