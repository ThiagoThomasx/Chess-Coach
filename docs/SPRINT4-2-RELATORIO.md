# Sprint 4.2 — Clareza das telas, selos de qualidade dos lances e PGN colado

- **Branch:** `feat/sprint4-2-clarity-badges-pgn-paste`, criada a partir de `38bd527` (head de `feat/sprint4-1-adaptive-training`, PR #2, que não foi alterado).
- **Data:** 2026-11-07.
- **Situação:** implementado e testado localmente. **Nada foi commitado, enviado ou aberto como PR**: isso aguarda a autorização do usuário.
- **Origem:** retorno do usuário depois de testar a Sprint 4.1 (três pedidos, abaixo).

## 1. Pedidos

1. **Selos de qualidade no tabuleiro.** Mostrar, na peça movida, se o lance foi bom, ruim, o melhor etc.
2. **Telas mais claras.** Na tela de exercício e nas demais: deixar óbvio de quem é a vez, qual é o objetivo, qual peça se moveu por último e o que fazer em seguida. Reduzir a mistura de informações.
3. **Colar PGN.** A importação precisa aceitar texto colado, além do upload de arquivo.

## 2. Selos de qualidade dos lances

### 2.1 Categorias

São usadas **só** as categorias que a análise já calcula (`docs/METHODOLOGY.md` §3). Nenhuma categoria nova foi criada, então nenhuma decisão de produto foi necessária.

| Classe | Símbolo | Cor (token) |
|---|---|---|
| Melhor lance | ★ | `--best` |
| Excelente | ! | `--good` |
| Bom | ✓ | `--good` |
| Imprecisão | ?! | `--warn` |
| Erro | ? | `--mistake` |
| Erro grave | ?? | `--bad` |
| Inconclusivo / Teoria | sem selo | — |

- Os símbolos são a notação de anotação usual do xadrez, que o app já usava em `CLASS_SYMBOL` desde a Sprint 1. Os nomes são os da metodologia. Não foi copiada nenhuma arte ou nome de outro site.
- **Inconclusivo** (busca interrompida ou profundidade abaixo do mínimo) não recebe selo: o motor não sustenta um veredito.
- O selo traz símbolo **e** rótulo acessível (`aria-label="Lance: Erro grave"`), nunca só cor.

### 2.2 Onde aparece

- **Análise da partida:** no canto da casa de destino do lance exibido, com a classificação gravada em `MoveReview.classification`. Em variante, não há selo, porque a variante não foi analisada.
- **Exercício:** no canto da casa de destino do lance do jogador, logo após o veredito.

### 2.3 Como o exercício classifica o lance do jogador

A validação do exercício já media o lance do jogador contra o melhor lance. Agora o veredito também devolve essas pontuações (`MoveVerdict.assessment`: referência, lance jogado, profundidade), e `solverMoveClass` aplica **a mesma função** da análise (`classifyMove`), com os limites configurados pelo usuário. Assim valem também as regras de mate (por exemplo, um mate mais lento fica no máximo em "bom").

| Origem das pontuações | Referência | Lance jogado |
|---|---|---|
| Lance da árvore de solução | 1º lance aceito do nó | pontuação gravada do lance |
| Lance verificado pelo motor | mesma busca (`searchmoves`) ou referência gravada | busca do motor |
| Lance que encerra a partida | referência do nó | mate, afogamento ou empate |

Salvaguardas:
- **Veredito "não resolve" nunca recebe selo positivo.** Um lance rejeitado só mostra selo se for imprecisão ou pior. Exemplo: um mate mais lento que estoura o limite do exercício é rejeitado, mas não aparece como "Bom".
- **Sem confiança, sem selo:** veredito "incerto" (perto da tolerância), lance não verificável e profundidade abaixo do mínimo não recebem selo.
- Se a resposta do adversário captura na casa marcada, o selo sai, para não marcar a peça errada.

Arquivos: `src/services/analysis/moveBadge.ts` (puro), `src/services/exercises/sequence.ts` (pontuações no veredito), `src/components/board/ChessBoard.tsx` (desenho via `squareRenderer`), `src/styles/components.css` (`.move-badge`).

## 3. Clareza das telas

### 3.1 Exercício (`ExerciseSolver.tsx`)

O painel denso foi dividido por prioridade:

| Antes | Depois |
|---|---|
| Objetivo como subtítulo cinza no cabeçalho | **Cartão de tarefa** no topo (acima do tabuleiro no celular, ao lado no desktop): "Sua vez · Pretas jogam", o objetivo em destaque e a próxima ação em uma frase. A cor da borda muda com o estado (sua vez, verificando, resolvido, não resolvido, solução mostrada, sem veredito). |
| "Pretas jogam" em letra miúda sob o tabuleiro | Bolinha da cor que joga no cartão; **legenda sob o tabuleiro**: qual lance está destacado ("Último lance do adversário: Nd4", "Seu lance", "Lance da solução"), o selo do lance e de que lado o tabuleiro está ("Tabuleiro do lado das Pretas"). |
| Tabuleiro sem destaque no início | O lance do adversário que levou à posição é destacado desde o início, **somente** quando a partida de origem confirma a posição (`lastMoveBefore` compara a FEN). |
| Dica, Ver solução, Resolver de novo e Próximo pendente sempre visíveis (alguns desativados) | **Uma ação principal por vez.** Jogando: "Pedir dica" e "Ver solução" (secundária). Errou: "Ver solução" é a principal. Acertou: "Resolver de novo" ou "Próximo pendente". Botões que não servem no momento não aparecem. |
| Nota de tolerância, texto sobre dicas, origem e histórico sempre abertos | Num painel **recolhido** "Origem e histórico", cujo resumo mostra o número de tentativas e o resultado da última. |

Componentes novos: `TaskPrompt`, `BoardLegend`, `ExerciseDetails`, `ReferenceSolution`; o `ExerciseSolver.tsx` ficou menor. A sessão guiada usa o mesmo solucionador e herda tudo isso.

### 3.2 Análise

- **Faixa "lance atual"** sob o tabuleiro: "3. Nd4 · ?? Erro grave · seta verde: melhor era Nxe5". Explica o que o tabuleiro mostra e o que a seta verde significa. Na posição inicial e em variantes, a faixa diz isso.
- A **explicação** foi movida para logo depois da lista de lances (antes ficava depois do gráfico). Quem clica num lance lê a explicação em seguida; o gráfico ficou abaixo.

### 3.3 Dashboard

O cartão "Seu próximo treino" já era a ação principal. Os três painéis menos urgentes (temas fortes, aberturas estudadas, posições marcadas) foram para um bloco recolhido "Mais detalhes". O resumo do bloco informa quantas posições marcadas estão pendentes, e elas continuam somadas em "Revisões pendentes".

Mantidos: identidade visual (tokens existentes), alvos de toque de 44 px (os resumos recolhíveis têm 44 px de altura) e layouts de 360 a 430 px.

## 4. PGN colado

- `ImportPanel` ganhou uma caixa de texto "Ou cole o PGN aqui" e o botão "Importar texto".
- `importPastedPgn` (`src/db/gamesRepo.ts`) chama o **mesmo** `importPgn`, ou seja, mesmo `parsePgnText`, mesma deduplicação por hash, mesmo limite de 20 MB e mesmo relatório (registrado como "Texto colado"). Texto vazio é recusado antes de tocar no banco.
- Depois de uma importação com sucesso, a caixa é limpa. Se nada foi importado, o texto fica para correção. Acima do limite, o botão fica desativado e o aviso aparece.

## 5. Restrições

Nenhum backend, API externa, telemetria, login, IA generativa ou rating. Stockfish não foi alterado. **Nenhuma mudança de esquema** (Dexie continua na v2): o selo é calculado na hora, não é gravado. Backup e restauração não mudam.

## 6. Testes

TDD nas partes com lógica (testes escritos antes e vistos falhando):

| Arquivo | Cobre |
|---|---|
| `tests/move-badge.test.ts` | mapeamento das classes, casa de destino (inclusive promoção), sem selo para inconclusivo/teoria, graduação do lance no exercício (melhor, excelente, bom, mate mais lento, rejeitado, ponto de vista das Pretas, profundidade mínima) |
| `tests/pgn-paste.test.ts` | importação colada pelo mesmo caminho, deduplicação contra arquivo, só lances sem cabeçalho, erro no relatório, texto vazio, limite de tamanho |
| `tests/sequence.test.ts` (+6) | o veredito traz as pontuações (lance da árvore, verificado pelo motor, rejeitado, xeque-mate) e a resposta do adversário quando a linha termina com ela |
| `tests/exercise-context.test.ts` | lance anterior ao exercício, primeiro lance, posição que não confere, partida ausente ou ilegível |
| `e2e/clarity.spec.ts` | colar PGN (importa, duplicada, erro); cartão de tarefa e detalhes recolhidos; selo "melhor" e selo "erro grave" com a ação principal certa; exercício das Pretas com o lance anterior destacado; selos e faixa na análise; celular 360×800 (cartão acima do tabuleiro, 44 px, sem rolagem horizontal, colar PGN) |

**Revisão de código** (agente revisor): aprovado, sem achados críticos ou altos. Corrigido o achado médio: quando a sequência terminava com a resposta do adversário, o destaque continuava no lance do jogador e a legenda o chamava de lance do adversário. O veredito `solved` agora informa a resposta (`reply`). Os outros achados ficaram documentados: no caminho de reserva `measureAfter`, um mate equivalente pode receber "excelente" em vez de "melhor" (subavalia, nunca inventa um erro); o selo do tabuleiro e a legenda são lidos duas vezes por leitores de tela.

Dois testes E2E antigos procuravam "✓ acerto" no histórico, que agora fica recolhido. Eles passaram a ler o resumo visível (`last-attempt`). O comportamento verificado é o mesmo.

### Resultados locais

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | sem erros |
| `npm test` (Vitest) | **322** passaram (eram 289; +33) |
| `npm run test:engine` (Stockfish real) | **21** passaram |
| `npm run build` | ok |
| Playwright | **46** passaram (eram 38; +8 em `e2e/clarity.spec.ts`) |

**Observação sobre o Playwright local.** A porta 4173 estava ocupada por um `vite preview` órfão de uma execução anterior (06/11, 23:58), que servia um build antigo. Como a configuração reaproveita um servidor existente fora da CI, os testes novos rodaram contra o código antigo. Esse processo não foi encerrado, porque não foi iniciado por esta sessão. A bateria foi rodada com uma cópia temporária da configuração, idêntica exceto pela porta 4175 e por sempre gerar um build novo. Antes de rodar `npm run test:e2e` na 4173, encerre o processo antigo.

Também foram conferidas capturas em 1440 px e 360 px: exercício no início, resolvido e com erro; análise; partidas.

## 7. Pendências

- Teste em celular físico (da Sprint 4.1, roteiro em `docs/SPRINT4-1-RELATORIO.md` §11) continua pendente. Ele agora também deveria conferir o selo e o cartão de tarefa.
- Fora do escopo, visto nos testes: uma análise gravada com FEN vazia (dado inválido, que o analisador real nunca grava) deixa a página de análise em branco, porque o app não tem um *error boundary*. Vale uma tarefa à parte.
- Commit, push e PR aguardam autorização. Sugestão: PR com base `feat/sprint4-1-adaptive-training`, ou com base `fix/sprint3-phase1` depois que o PR #2 entrar.
