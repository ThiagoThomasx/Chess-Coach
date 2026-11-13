# Sprint 4.6, etapa 3 — B2: do erro da partida ao exercício, e de volta

| Campo | Valor |
|---|---|
| Branch | `feat/sprint4-6-understand-mistakes` (criada de `main` em `302f7a9`) |
| HEAD | `302f7a9`. B2, assim como B1, PA-1, B3, FA-3 e FA-4, está **sem commit** |
| Data | 2026-11-08 |
| Planejamento | `SPRINT4-6-PLANEJAMENTO.md` §5 (B2) |

## 1. Objetivo e escopo implementado

Fluxo: partida analisada → lance com erro → exercício derivado → origem do exercício → volta à análise original.

| Item | Situação |
|---|---|
| B2.1 Selo na lista de lances | Implementado: "Ex." com borda, link para `/train/:id`, nome acessível completo e legenda abaixo da lista |
| B2.2 Ação contextual | Implementado: com exercício vinculado, "Criar exercício desta posição" vira "Abrir exercício" |
| B2.3 Origem no solucionador | Implementado: seção "De onde veio este exercício" só depois de resolvido ou revelado, com link para o lance |
| B2.4 Exercícios sem partida | Sem seção de origem e sem link; o fluxo de resolução é o mesmo |

## 2. Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/services/exercises/origin.ts` (novo) | `gameRef`, `linkedExercisesByPly`, `exerciseOrigin`, `isOriginVisible`, `moveLabel`, `analysisHref`, `exerciseHref` |
| `src/features/training/ExerciseOrigin.tsx` (novo) | Seção de origem do solucionador |
| `src/db/trainingRepo.ts` | `exercisesForGame` (índice `gameId` já existente) |
| `src/features/analysis/AnalysisPage.tsx` | Consulta viva dos exercícios da partida e o mapa ply → exercício |
| `src/features/analysis/MoveList.tsx` | Selo-link por lance e legenda |
| `src/features/analysis/ExplanationPanel.tsx` | "Abrir exercício" no lugar de "Criar" quando há vínculo |
| `src/features/training/ExerciseSolver.tsx` | Renderiza a origem quando `isOriginVisible(status)` |
| `src/features/training/ExerciseDetails.tsx` | O link para a partida (sem lance) virou texto; o link agora está na seção de origem |
| `src/styles/components.css` | `.move-cell`, `.exercise-badge`, `.moves-legend`, `.origin-link` |
| `tests/exercise-origin.test.ts` (novo) | 15 testes unitários |
| `e2e/exercise-origin.spec.ts` (novo) | 12 testes E2E |
| `e2e/mvp.spec.ts` | Passo 8 adaptado (ver §5) |
| `docs/SPRINT4-6-PLANEJAMENTO.md`, `docs/METHODOLOGY.md` §5.1.1, `docs/ARCHITECTURE.md` (fluxo) | Documentação |

Sem mudança de schema Dexie, sem dependência nova, sem mudança na classificação, nas regras de acerto, no SRS, nas tentativas ou na geração de exercícios.

## 3. Decisões técnicas

1. **Vínculo existente, sem tabela nova.** O exercício já guarda `source: 'game'`, `gameId` (indexado desde o schema v1) e `ply` (o lance jogado; a posição do exercício é a anterior). A associação é por `gameId + ply`.
2. **FEN só confere, não associa.** `linkedExercisesByPly` e `exerciseOrigin` exigem que `fens[ply-1]` (contadores de lance ignorados) seja a posição do exercício. Um `ply` inconsistente não gera selo nem link, então nunca se abre o lance errado. Exercícios de outra partida na mesma posição não são ligados.
3. **Duplicação.** Continua garantida por `addExercise` (verificação e inserção na mesma transação). A UI deixa de oferecer "Criar" quando o vínculo existe. Enquanto a consulta não responde, nenhuma ação aparece, para não piscar "Criar exercício".
4. **Resumo só com dados gravados.** A seção usa o lance jogado (da partida), a classificação e a perda (da revisão da análise, **só se ela é da mesma posição**) e o melhor lance. O texto de `explainMove` não é regenerado. Quem jogou vem da cor da partida: "você jogou", "seu adversário jogou" ou "foi jogado" quando a cor não está definida. Exercícios criados manualmente podem vir de um lance do adversário.
5. **Visibilidade.** Só nos estados `solved` e `revealed`. `failed` e `uncertain` não bastam, porque a análise da partida entregaria a resposta; nesses estados o usuário pode pedir "Ver solução". "Resolver de novo" esconde a seção outra vez.
6. **Desempenho (PA-1 preservada).** A revisão é lida **uma vez** (sem `useLiveQuery`): o registro de análise carrega todas as posições, e uma análise em andamento grava progresso a cada 2 s. A partida é consulta viva (registro pequeno). A seção aparece só quando as duas respostas chegam, sem crescer depois de aparecer.
7. **Rotas existentes.** `/train/:id` e `/analysis/:gameId?ply=N`. Os ids passam por `encodeURIComponent`.
8. **Link do "Origem e histórico".** Antes, havia um link para a partida (sem lance) visível antes de resolver. Ele virou texto, e o link de volta ficou na seção de origem. Assim não há dois links com o mesmo fim nem atalho para a resposta.

## 4. Comportamentos implementados

- Lista de lances: o lance com exercício mostra "Ex." (texto com borda, alvo mínimo de 24×24 px). O nome acessível é "Ex.: abrir o exercício do lance 3. Nd4", que começa pelo texto visível (WCAG 2.5.3). A legenda diz "lance com exercício criado a partir dele (N)". O selo é alcançável por teclado, depois do botão do lance.
- Painel de explicação: com vínculo, "Abrir exercício" e "Esta posição já virou um exercício."; sem vínculo, a ação de criar de sempre. Depois de criar, a consulta viva troca a ação para "Abrir exercício". Quando a posição já existe em exercício de **outra** partida, "Resolver agora →" continua levando a ele, como antes.
- Solucionador: depois de resolver ou revelar, aparece "De onde veio este exercício", com partida, data, o lance jogado, a classificação, a perda em p.p. e o melhor lance, mais o link "Revisar o lance na partida". O link abre a partida em `?ply=N`, com o lance N selecionado e a sua revisão.
- Partida excluída ou `ply` inconsistente: a seção explica e não mostra link.
- Exercício sem `gameId` ou de abertura: nenhuma seção, nenhum link para análise. "Origem e histórico" diz "Exercício sem partida de origem" ou "Exercício de abertura".

## 5. Testes adicionados

**Unitários (`tests/exercise-origin.test.ts`, 15):**

1. Exercício de partida tem origem válida: partida, lance "3. Nd4", classificação, perda, melhor lance e `href` `/analysis/g1?ply=5`.
2. O link de retorno abre o lance cuja posição anterior é a do exercício.
3. Autor do lance pela cor: você, adversário ou desconhecido; rótulo "3… exd4".
4. Revisão de outra posição é ignorada: nenhuma classificação inventada.
5. Sem origem para exercício sem `gameId`, de abertura ou com `ply` 0.
6. Sem link com partida ausente, outra partida, `ply` desatualizado ou fora do intervalo.
7. `isOriginVisible`: só `solved` e `revealed`.
8. Numeração quando a partida começa com as pretas.
9. Rotas: ids escapados.
10. `linkedExercisesByPly` liga cada exercício só ao seu lance.
11. `linkedExercisesByPly` não liga outra partida, sem partida, abertura, `ply` desatualizado nem fora do intervalo.
12. `linkedExercisesByPly` compara posições sem contadores de lance.
13. `exercisesForGame` usa o índice e retorna só os exercícios da partida.
14. Criar de novo a mesma posição devolve o existente: um único exercício armazenado e vinculado.
15. Exercício ou partida removidos não deixam vínculo.

**E2E (`e2e/exercise-origin.spec.ts`, 12):**

1. Cenário 1: selo acessível; só no lance certo, nunca no `ply` desatualizado; abre o exercício correto por teclado.
2. Cenário 2a: com exercício existente, só "Abrir exercício" aparece e nada é criado.
3. Cenário 2b (Stockfish real): sem exercício, "Criar" → "Abrir exercício"; abre o mesmo exercício; voltar e abrir de novo mantém 1 exercício.
4. Cenário 3: nenhuma origem antes; revelar → resumo exato → link → `?ply=5`, lance 5 selecionado, FEN correto; voltar esconde a origem até o próximo fim.
5. Cenário 3b: a origem também aparece depois de resolver, e "Resolver de novo" a esconde.
6. Cenário 4: exercício sem partida e exercício de abertura. Resolver ou revelar funciona normalmente, sem origem e sem link para análise.
7. Partida excluída: aviso, nenhum link quebrado.
8. a 12. Responsividade em 375, 390, 430, 768 e 1280 px: sem scroll horizontal, selo ≥ 24×24 px.

**Teste ajustado:** `e2e/mvp.spec.ts`, passo 8. Com a cor definida, a derivação automática pode já ter criado o exercício do lance 3.Nd4. O botão "Criar" então não existe mais, por design da B2.2. O passo agora cria quando a ação de criar aparece e abre pelo "Abrir exercício" nos dois casos. Nenhuma asserção foi removida.

## 6. Resultados das suítes

Resultados depois das correções da revisão:

| Suíte | Resultado |
|---|---|
| Typecheck (`tsc -p tsconfig.app.json --noEmit`) | Aprovado |
| Vitest | **469/469** (454 anteriores + 15 novos) |
| Stockfish real (`npm run test:engine`) | **24/24** |
| Build de produção (`npm run build`, dentro do `webServer` do Playwright) | Aprovado |
| Playwright completo | **81/81** (69 anteriores + 12 novos) |
| Cobertura (services + db) | linhas **94,65%**, statements 91,52%, branches 84,21%, funções 89,26% |

Também conferi as telas em capturas: lista de lances e seção de origem em 390 px e solucionador em 1280 px.

## 7. Revisão independente

Um revisor separado (agente de revisão de código, somente leitura) analisou os diffs e os arquivos novos. Fiz também uma leitura crítica própria.

| # | Severidade | Achado | Tratamento |
|---|---|---|---|
| R1 | MEDIUM | Nome acessível do selo e do link de retorno não começava pelo texto visível (WCAG 2.5.3) | **Corrigido**: "Ex.: abrir o exercício do lance …" e "Revisar o lance na partida: …" |
| R2 | MEDIUM | A seção de origem relia a análise (com todas as posições) a cada gravação de progresso, por consulta viva (achado próprio; o revisor classificou como LOW) | **Corrigido**: leitura única |
| R3 | LOW | "Criar exercício" piscava antes de a consulta de exercícios responder | **Corrigido**: nenhuma ação até a resposta |
| R4 | LOW | Resumo crescia quando a revisão chegava depois da partida | **Corrigido**: renderiza com as duas respostas |
| R5 | LOW | Comentário "mantém o mais antigo" impreciso (a ordem é a do índice) | **Corrigido** o comentário. O caso é inalcançável por causa da deduplicação |
| R6 | LOW | O link de retorno (`?ply=N`) marca como revisada uma marcação existente nesse lance | **Débito documentado** (METHODOLOGY §5.1.1). É a semântica atual de qualquer abertura por `?ply`: abrir a posição é revisá-la. Mudar isso alteraria marcações fora do escopo. **Atualização (auditoria consolidada, AC-2): corrigido.** Só o link de "Posições marcadas" do painel conta como revisão |
| R7 | LOW | SAN longo + selo numa coluna estreita | **Débito parcial**: os E2E de 375 a 1280 px (SAN curto, "Nd4") não têm scroll horizontal, e a coluna encolhe sem estourar (`min-width: 0`). Para SAN longo ("exd8=Q+"), a folga em 375 px foi **estimada** pelas larguras (≈ 77 px de texto disponíveis contra ≈ 68 px necessários), não medida. Abaixo de 360 px não foi medido. **Atualização (auditoria consolidada): medido** na aplicação real com `fxg8=Q+` em 375 a 1280 px, sem corte nem colisão |
| R8 | LOW | Em `failed`/`uncertain` não há caminho para a partida até revelar | **Intencional** (decisão 3.5). "Ver solução" está disponível nesses estados |

Conferido sem achados:
- associação e destino dos links;
- visibilidade;
- duplicação;
- partida ou exercício removidos;
- hooks;
- aninhamento HTML (o link é irmão do botão, não filho);
- regressões em B1 (refutação), PA-1 (gravação e consultas) e B3 (indicador).

**Nenhum achado CRITICAL, HIGH ou MEDIUM pendente.**

## 8. Limitações e débitos restantes

- R6 (marcação revisada ao voltar pela origem): mantida nesta etapa, corrigida depois na auditoria consolidada (AC-2).
- O resumo não repete o texto completo da explicação da partida ("O que aconteceu", "Por que o lance não funcionou"). Regenerar `explainMove` usaria a linha de resposta das posições e não é um dado registrado do exercício. A explicação completa está a um clique, no link de retorno.
- Em sessão guiada, o link de retorno sai da sessão. O plano fica salvo localmente e a sessão é retomável, como em qualquer outra navegação.
- Exercícios de outra partida com a mesma posição não recebem selo na partida atual. A associação é pela partida de origem, e o FEN não é usado para associar.

## 9. Preservação das alterações anteriores

- Todos os arquivos de B1, PA-1, B3, FA-3 e FA-4 seguem presentes e modificados como antes:
  - `refutation.ts`, `progressSaver.ts`, `useLiveAnalysis.ts`, `GameTrend.tsx`, `gameDate.ts`;
  - seus testes e documentos.
- Nenhum comando destrutivo de git foi usado: nada de `reset`, `clean`, `checkout --`, `restore`, troca de branch ou sincronização com `main`.
- `.claude/` não foi tocado.
- Nenhum arquivo não rastreado foi removido. O único arquivo temporário criado, uma spec de capturas de tela, foi apagado logo após o uso.
- Os arquivos já modificados que a B2 tocou (`ExerciseSolver.tsx`) foram editados por trecho, preservando as mudanças da B1.

## 10. Confirmação

**Não houve commit, push, PR, merge nem deploy.** Todas as alterações estão locais, no working tree da branch `feat/sprint4-6-understand-mistakes`, com HEAD em `302f7a9`.
