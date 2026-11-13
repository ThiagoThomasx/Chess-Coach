# Sprint 4.6 — Auditoria consolidada

| Campo | Valor |
|---|---|
| Branch | `feat/sprint4-6-understand-mistakes` (de `main` em `302f7a9`) |
| HEAD | `302f7a9`, antes e depois. Todo o trabalho da sprint e desta auditoria está **sem commit** |
| Data | 2026-11-09 |
| Escopo | B1, PA-1, B3, FA-3, FA-4 e B2, tratados como um único sistema |

## 1. Resumo executivo

Encontrei **7 achados de severidade média** (AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-8), todos reproduzidos ou confirmados no código e todos **corrigidos** com testes ou medição. Também encontrei **5 de severidade baixa**: AC-4 corrigido, AC-9 coberto por testes novos, AC-12 já protegido, AC-10 e AC-11 aceitos e documentados. Não houve achado CRITICAL nem HIGH. As suítes completas passam: Vitest **476/476**, Stockfish real **24/24**, Playwright **84/84**, typecheck e build aprovados.

**Veredito: APROVADA COM RESSALVAS para integração.** Não há achado CRITICAL, HIGH ou MEDIUM pendente. As ressalvas são débitos LOW documentados (§11) e riscos que não dá para eliminar sem mudança de schema ou de produto (§12). Os de maior peso:

- o indicador da B3 compara médias sem teste estatístico;
- a confiabilidade da regra de data PGN depende de um instante não cair exatamente à meia-noite UTC;
- o uso do mesmo app em duas abas ao mesmo tempo continua com proteção parcial.

## 2. Estado do repositório

| | Antes | Depois |
|---|---|---|
| Branch / HEAD | `feat/sprint4-6-understand-mistakes` / `302f7a9` | Os mesmos |
| Modificados (rastreados) | 32 | 33 (+ `e2e/helpers.ts`; os demais arquivos alterados nesta auditoria já estavam na lista) |
| Não rastreados | 18 (incluindo `.claude/`) | 21 (+ este relatório, `tests/audit-sprint4-6.test.ts`, `e2e/audit-sprint4-6.spec.ts`) |
| B1, PA-1, B3, FA-3, FA-4, B2 | Presentes | Presentes (só os pontos de §7 foram alterados) |

Arquivos temporários criados e removidos: três specs de captura de tela e sondagem (`e2e/zz-tmp-*`). Também encerrei um servidor `vite preview` na porta 4176. Eu o tinha iniciado numa execução visual interrompida, e ele bloqueava a suíte.

Não toquei em `.claude/`. Não removi nenhum arquivo do usuário.

## 3. Escopo auditado

- **Ciclo pedagógico** (§4.1 do pedido): partida → análise → erro → exercício → refutação → resolução → evidência → evolução. Foi percorrido na aplicação real com o motor real (§10) e nos testes de B2 e B1.
- **Módulos B1, PA-1, B3, FA-3, FA-4 e B2**: o código e os testes de cada um.
- **Integridade dos dados**: os 10 cenários do pedido (§6).
- **Telas a 375, 390, 430, 768 e 1280 px**:
  - lista de lances com `fxg8=Q+` e selo;
  - explicação;
  - origem;
  - refutação e reprodução;
  - Evolução;
  - painel;
  - Treinar.

## 4. Metodologia

1. **Inspeção** de cada diff contra `302f7a9` e dos arquivos novos.
2. **Revisão independente**: um revisor separado, somente leitura, sem acesso às minhas conclusões além de uma lista de achados já conhecidos que ele podia confirmar ou refutar.
3. **Reprodução antes de corrigir**: todo achado corrigido tem um teste escrito antes da correção, que falhou (vermelho) e depois passou (verde). A exceção é o AC-8, verificado por medição na aplicação real.
4. **Auditoria visual na aplicação real** (build de produção, Chromium):
   - capturas de tela;
   - medições no DOM (scroll horizontal, corte de texto, colisão selo × notação, tamanho do alvo);
   - ordem do foco por teclado;
   - leitura do IndexedDB antes e depois da reprodução da refutação.
5. **Suítes completas** ao final (§9).

## 5. Achados por módulo

| # | Módulo | Severidade | Achado | Situação |
|---|---|---|---|---|
| AC-1 | PA-1 / dados | MEDIUM | Excluir uma partida durante a análise não parava a execução: o motor seguia ocupado (fila FIFO, atrasando outras análises) e a análise da partida excluída era **recriada** no IndexedDB | Corrigido |
| AC-2 | B2 / revisões | MEDIUM | Qualquer abertura por `?ply=` marcava como revisada a marcação daquele lance, inclusive pelo link de origem da B2 e pelos exemplos de padrões. Uma marcação **criada na própria tela** era marcada como revisada na hora | Corrigido |
| AC-3 | PA-1 | MEDIUM | Falha de gravação (cota, E/S) no meio da análise deixava a tela e o registro em "analisando" até recarregar (achado do revisor, M1/M2) | Corrigido |
| AC-4 | FA-4 | LOW | A sessão guiada lia "revisões vencidas" só quando o banco mudava, sem acompanhar o relógio como as outras telas | Corrigido |
| AC-5 | B3 | MEDIUM | Partidas sem data no PGN entram como as mais antigas. Se forem recentes, a direção mostrada (melhora/piora) pode estar **invertida**, sem aviso (revisor, M4) | Corrigido (aviso + direção sem cor) |
| AC-6 | B1 | MEDIUM | Depois da reverificação mais profunda, o detalhe da recusa mostrava a profundidade da primeira busca, não a da que decidiu (revisor, M3). Isso também afeta o selo de classificação | Corrigido |
| AC-7 | B1 | MEDIUM | "Perde material" era afirmado mesmo quando a linha de referência não chegava a ponto estável. O melhor lance podia perder o mesmo material, e a perda era atribuída ao lance do aluno (LOW anterior, confirmado como problema pedagógico real) | Corrigido |
| AC-8 | Evolução (preexistente, Sprint 3) | MEDIUM | O selo "Em desenvolvimento · evidências iniciais" transbordava a coluna de 9rem: scroll horizontal de 45 px a 768 px e de 32 px a 1280 px | Corrigido |
| AC-9 | B1 | LOW | Faltavam testes nas bordas das faixas (80/60/40/20%) | Testes criados; o comportamento estava certo |
| AC-10 | FA-3 | LOW | Um instante real que caísse exatamente às 00:00:00.000 UTC seria lido como data PGN (probabilidade ≈ 1 em 86 milhões) | Aceito (§11) |
| AC-11 | B3 | LOW | Janelas de 4 a 9 partidas: uma diferença ≥ 0,3 pode vir de 2 ou 3 erros. Não há teste estatístico | Aceito e documentado (§11) |
| AC-12 | B2 | LOW | Uma exclusão de partida durante a sessão pode deixar o solucionador aberto com um exercício já removido | Já protegido: `recordAttempt` relê o exercício na transação e não grava (teste existente em `tests/data-consistency.test.ts`) |

### Respostas ao ponto específico da B2 (link "Revisar o lance na partida")

1. **Era intencional?** Só em parte. O comentário original dizia "abrir pelo **painel** conta como revisão", mas a implementação valia para qualquer `?ply=`. A B2 ampliou o efeito sem querer.
2. **Navegação confundida com revisão?** Sim, e de forma reproduzível. A pior variante: o usuário chega ao lance por um link e cria uma marcação para revisar depois, e a marcação nasce já revisada. Ela some de "Posições marcadas" e do contador "Revisões pendentes" sem nunca ter sido revisada.
3. **Distorce SRS ou indicadores?** O SRS dos exercícios e as evidências do perfil não são afetados (`reviewedAt` das marcações não entra neles). Os indicadores afetados são "Revisões pendentes" e a lista do painel, e "Posições revisadas" na Evolução.
4. **Menor correção:**
   - só o link da lista "Posições marcadas" do painel leva `&review=1`;
   - a tela de análise marca como revisada apenas a marcação que **já existia ao abrir**, uma única vez;
   - os demais links (origem, padrões de erro, Evolução) não marcam mais nada.

## 6. Integridade dos dados (cenários do pedido)

| # | Cenário | Resultado |
|---|---|---|
| 1 | Excluir a partida durante a análise | **Reproduzido** (AC-1) e corrigido. Teste `tests/audit-sprint4-6.test.ts` |
| 2 | Excluir partida com exercícios derivados | Protegido: `deleteGame` remove na mesma transação exercícios, tentativas, evidências dos exercícios e da partida, marcações e análise. Testes de B2 e de persistência |
| 3 | Excluir exercício com tentativas e evidências | Protegido: `deleteExercise` é transacional. A limpeza de evidência órfã roda na abertura do app |
| 4 | Reimportar a mesma partida | Deduplicada por hash. Depois de excluída, a reimportação recebe `id` novo (`newId`): nada herda análise, exercício ou vínculo da partida antiga. O link de origem da B2 não aponta para a partida nova |
| 5 | Reanalisar uma partida existente | Evidências de partida substituídas (idempotente). Exercícios existentes nunca são removidos. O vínculo B2 é conferido pelo FEN, então uma reclassificação não liga o exercício ao lance errado |
| 6 | Restaurar backup | Validado por formato e versão (testes existentes). Com relações faltando, a origem mostra "partida não disponível" (E2E da B2) e as estatísticas ignoram análises sem partida |
| 7 | Backup sem registros relacionados | Mesmo tratamento de 6. Evidências de exercício órfãs são removidas na abertura (`removeOrphanExerciseEvidence`) |
| 8 | Dados parcialmente inconsistentes | Vínculo B2 com `ply` desatualizado → sem selo e sem link (testes unitários e E2E). Revisão de outra posição → nenhuma classificação inventada |
| 9 | Duas abas | Protegidos por transação: criação de exercício (`addExercise`), tentativa (`recordAttempt`) e troca de cor. **Risco teórico não eliminado:** a mesma partida analisada nas duas abas ao mesmo tempo grava duas execuções (a última gravação vence; os dois registros são completos). Não reproduzido como perda |
| 10 | Navegar entre análise e exercício durante a gravação de progresso | A origem lê a revisão uma vez, não ao vivo. O selo e "Abrir exercício" vêm do índice `gameId`. Nenhuma gravação nova é disparada pela navegação (o AC-2 removia a única exceção) |

**Ciclo pedagógico, verificado na aplicação real com o motor:**

- Partida analisada → selo "Ex." no lance certo → exercício → lance errado `a6`.
- Recusa: "a6 não resolve: deixa de ganhar material (cerca de uma peça). O adversário responde Nxc6."
- Linha mostrada: "4. Nxc6 dxc6 5. d3 Be6", saída da mesma busca que recusou o lance.
- A reprodução da linha não alterou as tentativas (+0) nem o SRS.
- Ao revelar, uma tentativa a mais, como esperado; depois, a origem com link para `?ply=5`.
- A classificação mostrada na origem é a gravada para essa mesma posição.

## 7. Correções realizadas

| Achado | Arquivos | Mudança |
|---|---|---|
| AC-1 | `src/db/analysisRepo.ts`, `src/services/analysis/analysisRunner.ts` | `saveAnalysisIfGameExists`: confere a partida na mesma transação da gravação. A execução para na próxima gravação se a partida sumiu. Nenhuma análise é recriada |
| AC-2 | `src/features/analysis/AnalysisPage.tsx`, `src/features/dashboard/DashboardPage.tsx` | Revisão só com `&review=1` (link de "Posições marcadas"), uma vez, para a marcação existente ao abrir |
| AC-3 | `src/services/analysis/analysisRunner.ts` | Falha antes da gravação final → estado `error` gravado (tentativa) e **anunciado**. A falha na derivação mantém o fluxo existente (`complete` + `derivation: 'pending'`, reconciliado na abertura) |
| AC-4 | `src/features/training/useTrainingLoop.ts` | `useMinute()` como dependência. `useLiveQuery` mantém o valor anterior durante a releitura, então nada pisca |
| AC-5 | `src/services/stats/stats.ts`, `src/features/progress/GameTrend.tsx` | `undatedGames` no resultado. Com partidas sem data nas janelas: aviso explícito e direção sem a cor de melhora ou piora |
| AC-6 | `src/services/exercises/sequence.ts` | `Measured.depth` carrega a profundidade da busca que decidiu |
| AC-7 | `src/services/exercises/refutation.ts` | A regra de material só é usada contra uma linha de referência em ponto estável. Caso contrário vale a regra da faixa |
| AC-8 | `src/styles/components.css` | Coluna do selo `auto` e selo com quebra até 14rem |

Não houve mudança de schema, de dependências, de classificação de lances, de regra de acerto/erro ou de SRS.

Documentos atualizados por mudança real de comportamento:

- `docs/METHODOLOGY.md`: B2 retorno e revisão (AC-2), regra de material (AC-7), B3 sem data (AC-5) e o que o indicador mede;
- `docs/ARCHITECTURE.md`: fluxo de gravação da análise (AC-1, AC-3).

## 8. Testes adicionais

| Teste | Cobre |
|---|---|
| `tests/audit-sprint4-6.test.ts` — AC-1 | Exclusão no meio da análise: nenhuma análise volta; o motor para em ≤ 1 posição |
| idem — AC-3 | Falha na 3ª gravação: o último estado anunciado e o gravado são `error` |
| idem — AC-7 | Sem referência estável, nenhuma afirmação de material |
| idem — AC-9 | Bordas 80/60/40/20% para as brancas e o espelho para as pretas |
| `tests/sequence.test.ts` — AC-6 | O veredito após a reverificação reporta a profundidade 16 |
| `tests/game-trend.test.ts` — AC-5 (2) | Contagem de partidas sem data nas janelas; partida sem data fora das janelas não conta |
| `e2e/audit-sprint4-6.spec.ts` — AC-2 (2) | Marcação criada após abrir por link fica pendente (e no contador). O link da origem não revisa; o link do painel revisa |
| `e2e/progress-trend.spec.ts` — AC-5 | Aviso de partidas sem data e direção sem cor |

O `seedAnalysedGame` da B2 foi movido para `e2e/helpers.ts`, para reuso sem duplicação. Nenhum teste existente foi removido ou enfraquecido.

**Não testado de forma automatizada:**

- **Duas abas analisando a mesma partida ao mesmo tempo.** O Playwright poderia abrir duas páginas, mas a ordem das gravações depende do tempo do motor real e o teste seria instável. Validação proposta: teste manual com duas janelas e conferência do registro final em DevTools → IndexedDB.
- **Virada de dia com a tela aberta.** `useMinute` reavalia a cada minuto, e os testes existentes cobrem a regra de vencimento. Um E2E com relógio falso exigiria `page.clock`, que não está em uso no projeto.

## 9. Resultados das suítes (finais, depois de todas as correções)

| Suíte | Resultado |
|---|---|
| Typecheck | Aprovado |
| Vitest | **476/476** (469 + 7 novos) |
| Stockfish real | **24/24** |
| Build de produção | Aprovado |
| Playwright completo | **84/84** (81 + 3 novos) |
| Cobertura (services + db) | linhas **94,66%**, statements 91,52%, branches 84,21%, funções 89,34% |

**Estabilidade:** uma execução intermediária do par `progress-trend` + `audit` falhou uma vez, logo depois de um build novo. Não consegui reproduzir: passou na execução seguinte, em **55 de 55** repetições (`--repeat-each=5`) e na suíte completa. Registro como instabilidade não explicada de baixa frequência.

## 10. Responsividade e acessibilidade (aplicação real)

Medido em 375, 390, 430, 768 e 1280 px:

| Verificação | Resultado |
|---|---|
| Scroll horizontal: análise, solucionador, origem, painel e Treinar | 0 px em todas as larguras |
| Scroll horizontal: Evolução | Era 45 px (768) e 32 px (1280); **0 depois do AC-8** |
| `fxg8=Q+` com marca e selo, inclusive em 375 px | Cabe sem corte nem colisão: selo dentro da célula, folga ≥ 8 px, alvo de 28×24 px |
| Teclado | Tab a partir do lance 9 chega ao selo "Ex.: abrir o exercício do lance 5. fxg8=Q+" |
| Feedback do solucionador | Região sempre montada com `role="status"`; recusa e linha de refutação são anunciadas |
| Nomes acessíveis | Selo e link de origem começam pelo texto visível (WCAG 2.5.3) |
| Cor | O selo é texto com borda; direção da B3 sem cor quando incerta |
| Botões redundantes | Nenhum: "Abrir exercício" substitui "Criar"; o link da partida só existe na seção de origem |

Contraste: a paleta é a mesma do restante do app e não foi alterada nesta sprint; não fiz medição numérica de contraste.

Duas aparências nas capturas não são defeitos: a barra de navegação sobre o tabuleiro (artefato da captura de página inteira com cabeçalho fixo em 375 px) e os avisos de importação sobre a lista de lances, que são temporários.

## 11. Débitos técnicos restantes (LOW)

| # | Débito | Justificativa |
|---|---|---|
| AC-10 | Data PGN reconhecida pela meia-noite UTC exata | A alternativa correta é um campo explícito no evento, o que exige mudança de schema. A probabilidade de colisão é desprezível |
| AC-11 | B3 sem teste estatístico; partidas curtas e longas pesam igual | O texto já diz "tendência, não causa", mostra as amostras e avisa em amostras pequenas e sem data. Um teste estatístico mudaria o produto |
| — | Indicador B3 não mede força enxadrística | Documentado em METHODOLOGY (o que mede e o que não mede) |
| — | Resumo da origem (B2) não repete a explicação completa | A explicação completa fica a um clique; regenerá-la usaria dados que o exercício não guarda |
| — | Selos de confiança com quebra têm o canto arredondado de pílula | Cosmético; legível |

## 12. Riscos não eliminados

- **Duas abas** analisando a mesma partida: a última gravação vence (§6.9).
- **Falha de gravação persistente** (disco cheio): o estado `error` pode não ser gravado. A tela é avisada, e o registro preso em `running` vira `paused` na próxima abertura (`recoverInterruptedAnalyses`).
- **Aba fechada entre gravações**: até ~2 s de posições não gravadas. Elas são recuperadas pelo cache de avaliações, sem perda de trabalho do motor.
- **Reanálise em outra profundidade** pode reclassificar lances e mudar o indicador B3. É o comportamento esperado, mas o usuário não é avisado.

## 13. Veredito

**APROVADA COM RESSALVAS para integração na `main`.**

- O ciclo pedagógico está coerente de ponta a ponta.
- Não há associação incorreta entre partida e exercício.
- Não há perda de progresso.
- Não há duplicação de tentativas ou de evidências.
- Datas e o contador temporal estão consistentes.
- As telas passam nas 5 larguras sem scroll horizontal.

Nenhum achado CRITICAL, HIGH ou MEDIUM está pendente. As ressalvas são os débitos LOW de §11 e os riscos de §12, documentados e justificados.

**Não houve commit, push, PR, merge nem deploy.** Todas as alterações estão no working tree da branch `feat/sprint4-6-understand-mistakes`, com HEAD em `302f7a9`.
