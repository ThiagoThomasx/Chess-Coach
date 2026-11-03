# ChessQuest — Sprint 3: auditoria pedagógica e de uso

Data: 2026-11-03 · Escopo: somente investigação. **Nenhum código de produção foi alterado.**

## Como a auditoria foi feita

- **Linha de base**: 161 testes Vitest passando, `typecheck` limpo.
- **Motor real**: Stockfish 19 *lite* (o mesmo WASM do app), em processo filho, profundidade 16 e MultiPV 3 — as configurações padrão do app.
- **Partidas completas** passaram pelo pipeline real (análise → classificação → explicação → evidências do perfil → exercícios com árvore de solução), para **as duas cores**:
  - Morphy × Duque/Conde (Ópera, 1858): sacrifícios corretos, mate final.
  - Mate de Légal: sacrifício de dama correto (5.Nxe5!) e erro grave que permite mate.
  - Anderssen × Kieseritzky ("Imortal", 1851): sacrifícios em série, posições de mate.
  - Byrne × Fischer (1956): sacrifício de dama correto das pretas (17…Be6!!) e partida longa (82 meias-jogadas).
  - Armadilha Blackburne-Shilling (3…Nd4), com o usuário de brancas.
- **Posições construídas** para pontos específicos (garfo, peça cravada, dama de graça, mate em N).
- **Interface**: app rodando em `audit.localhost:5173` — uma origem separada, para não tocar no banco de dados existente em `localhost:5173`. Foram testados importação, análise, explicação, exercícios, dicas, repetição, aberturas, perfil, tela de celular e uma posição inválida.
- As 19 linhas de abertura foram conferidas com o motor, lance a lance.

Scripts de reprodução (fora do repositório): `C:\Users\thiag\AppData\Local\Temp\claude\C--Users-thiag--claude-spares-spare-8yc4yW\f20d5050-52aa-4270-9e97-0656098951ab\scratchpad\probes\`.

---

## Resumo

| Gravidade | Qtde | Itens |
|---|---|---|
| Crítica | 1 | C1 |
| Alta | 6 | A1–A6 |
| Média | 8 | M1–M8 |
| Baixa | 6 | B1–B6 |

**O que funciona bem (verificado):**
- Os sinais das avaliações estão corretos para brancas e pretas.
- Sacrifícios corretos não são punidos: 5.Nxe5! (Légal), 17…Be6!! (Fischer, "melhor lance · único lance"), Rg1/Qf6+ (Imortal).
- Mates permitidos e mates em 1 são descritos com exatidão.
- O mate em 1 aceita qualquer lance que dá mate.
- Alternativas equivalentes entram na árvore de solução, e lances fora da lista são verificados pelo motor.
- As linhas de abertura são legais, e nenhum lance de livro perde mais de 5 p.p.
- Erros recentes derrubam o perfil para "Precisa revisar".
- Repetir o mesmo exercício perde peso (1/k).
- Não há rolagem horizontal em 375 px.

**O que mais compromete o aprendizado:**
1. Exercícios de mate em ≥ 5 não podem ser resolvidos (C1).
2. É fácil registrar "acerto independente" depois de ver a resposta (A1).
3. Várias explicações afirmam "não há motivo tático" em erros que são táticos (A2).

---

## Problemas reproduzidos

### C1 — Crítica · Exercícios de mate em 5 ou mais não podem ser resolvidos
- **Evidência**: `goalFor` cria a meta `mate` com `maxUserMoves = min(N, 4)`. Já `buildSolutionTree` → `acceptedFrom(…, mateLimit = 4)` descarta todo lance cujo mate seja maior que 4. Por isso, a raiz da árvore fica **vazia**. Com isso, `judge()` não tem referência (`bestWin = null`) e devolve `unverifiable` para **qualquer** lance, inclusive o melhor lance do motor. A mensagem diz que "o motor não está disponível", o que é falso.
  - Reprodução: FEN `6k1/5ppp/8/8/8/8/1Q3PPP/1R4K1 w - - 0 1` com a linha `b1a1` = mate em 6.
  - Resultado: `GOAL {"kind":"mate","maxUserMoves":4,"mateIn":6} ROOT ACCEPTED []`. Jogar Ra1 dá `unverifiable`. A dica 2 só repete o objetivo, porque a lista de lances aceitos está vazia.
- **Impacto**: o exercício fica travado. O enunciado ("Encontre o mate em 6") não bate com o limite de 4 lances, e a mensagem de erro engana o aluno.
- **Correção recomendada**: com N > 4, transformar a meta em "manter o mate forçado durante 4 lances" (aceitar qualquer mate ≤ N − lances já jogados), ou não gerar o exercício. Nunca permitir uma raiz vazia: com `accepted` vazio, descartar o exercício ou usar o MultiPV original. Corrigir a mensagem de `unverifiable` quando o motor existe.
- **Testes**: mate em 5, 6 e 8 (com motor simulado), verificando que o lance principal é aceito e que a dica 2 aponta uma peça. Invariante: "toda árvore gerada tem `accepted.length ≥ 1`". Integração com o motor real em uma posição de mate em 5.

### A1 — Alta · "Resolver de novo" registra acerto independente logo depois de ver a resposta
- **Evidência (interface)**:
  1. No exercício da posição de Légal, usei as 3 dicas; a dica 3 mostra "O lance é Nc6". Resolvi.
  2. Cliquei em "Resolver de novo" e repeti Nc6 sem dica.
  3. No IndexedDB ficaram as tentativas `{c:true,h:3}` e depois `{c:true,h:0}`. Os eventos ficaram `0.25 (independent:false)` e depois `1 (independent:true)`, e a repetição espaçada subiu da caixa 0 para a 1.
- **Causa**: em `useExerciseSession.retry()`, `retries` só aumenta depois de `failed`/`revealed`. Depois de `solved`, ele volta a 0 e as dicas também são zeradas.
- **Impacto**: infla o perfil e a repetição espaçada. Também conta para `distinctIndependent` (o critério de 5 exercícios distintos para "domínio provisório"). Em simulação (5 exercícios × 3 dias, dica 3 seguida de repetição), o perfil sobe sem nenhuma resolução real.
- **Correção recomendada**: repetir na mesma sessão (ou em menos de X minutos após uma tentativa) deve ser registrado como **prática**: sem avançar a repetição espaçada e sem evento independente. Ou, no mínimo, herdar a assistência da tentativa anterior.
- **Testes**: hook/E2E com a sequência solved com dica → retry → solved; esperar `independent:false` e a caixa sem mudança. Teste de unidade: `distinctIndependent` ignora repetições na mesma sessão.

### A2 — Alta · Explicações "posicionais" negam táticas que existem
- **Evidência** (todas com classificação "Explicação limitada", mas o texto afirma um fato):

| Posição (FEN antes do lance) | Lance | Texto exibido | Realidade |
|---|---|---|---|
| `rn1qkbnr/ppp2ppp/3p4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 3 4` | 4…g6? | "Erro posicional: … sem um motivo tático imediato" | Permite 5.Nxe5! (armadilha de Légal): ganha um peão ou dá mate após 5…Bxd1 |
| `r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4` | 4.Nxe5? | idem | 4…Qg5! ataca e5 e g2 (ataque duplo) |
| `r2q1rk1/pp2ppbp/1np2np1/2Q5/3PPBb1/2N2N2/PP3PPP/3RKB1R w K - 5 11` | 11.Bg5?? | "Não há perda imediata de material nas linhas do motor" | 11…Na4!! ganha material (Nxc3, Nxe4) |
| `rn2kb1r/p3qppp/2p2n2/1N2p1B1/2B1P3/1Q6/PPP2PPP/R3K2R b KQkq - 0 10` | 10…cxb5? | "sem um motivo tático imediato" | Abre Bxb5+ com cravada em d7: o ataque decisivo de Morphy |

- **Causa**:
  1. Em `concepts.ts`, só uma variação ≥ 2 pontos (`MATERIAL_THRESHOLD`) conta como tática. Um peão perdido (Légal) não conta.
  2. Linhas **não estabilizadas** (`settled=false`) caem no tema genérico, e os modelos `opening`/`positional` **afirmam ausência** de tática em vez de dizer "não verificado".
  3. Até a meia-jogada 20, o tema vira `opening`. Por isso, o exercício e as evidências vão para a competência "Aberturas" (o perfil de teste mostrou "Aberturas 8 evidências" vindas de erros táticos).
- **Impacto**: ensina uma causa errada ("princípios de abertura") para armadilhas táticas clássicas, aponta para a biblioteca de aberturas e distorce as competências.
- **Correção recomendada**:
  - Reescrever os modelos de recurso sem afirmações negativas, por exemplo: "O ChessQuest não identificou um motivo tático simples; o motor mostra a linha X".
  - Quando a resposta do adversário ganha material (≥ 1 ponto, estabilizado), citar o fato ("o adversário ganha um peão com …").
  - Quando a linha não estabiliza, dizer que a linha não foi verificada.
  - Não usar a fase para definir a competência de um exercício tático.
- **Testes**: as 4 posições acima como regressão em `pedagogy.test.ts`, verificando que o texto **não contém** "sem um motivo tático" e "Não há perda", e que o tema não é `opening`. Teste de varredura: nenhum modelo usa negações factuais sem evidência.

### A3 — Alta · A linha do adversário aparece como "Por que ela é superior"
- **Evidência**:
  - Imortal, `rnb1kb1r/p2p1ppp/2p2n2/1B3Nq1/4PpP1/3P4/PPP4P/RNBQ1KR1 b kq - 2 11`, lance 11…cxb5. Em "Melhor alternativa: h5", o campo "Por que ela é superior" diz: "A linha do motor **h4 Qg6 h5 Nxh5 gxh5 Qe6** ganha 2 ponto(s)…". Essa é a linha das **brancas** contra o lance jogado.
  - O mesmo acontece em `rnb1k1nr/p2p1ppp/3B4/1pbN1N1P/4P1P1/3P1Q2/PqP5/R4KR1 b kq - 1 18` (18…Bxg1): "Re1 Bb7 Kxg1 …".
  - Nesse segundo caso, o conceito **verificado** do próprio jogador (`missed_capture` com Qxa1+) foi detectado mas ficou em segundo plano: o conceito principal é `combination/opponent` não verificado, e a explicação sai "limitada".
- **Causa**: o modelo `combination` só tem a forma do próprio jogador (`why`) e lê `evidence.bestSan`, que no motivo do adversário é a linha de resposta. A ordenação em `detectConcepts` não dá prioridade a conceitos verificados.
- **Impacto**: explicação incorreta e confusa, porque atribui ao lance recomendado a linha que pune o aluno.
- **Correção recomendada**: criar a forma do adversário para `combination` (fato/consequência). Ordenar os conceitos por `verified` antes da categoria.
- **Testes**: as duas posições, verificando que `why` não contém a linha de resposta e que `concepts[0].verified === true` quando existe um conceito verificado.

### A4 — Alta · Todo ganho de material vira "sequência de 3 lances"
- **Evidência**: dama de graça, `4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1` (o aluno jogou Ke2). Resultado:
  - `kind=sequence`, `maxUserMoves=3`.
  - Objetivo: "Encontre a sequência que ganha material (até 3 lances seus…)".
  - Solução: `Rxd5 Ke7 Kd2 Kf6 Ke3`.
- **Causa**: `settledSwing` joga no mínimo 6 meias-jogadas (`basePlies=6`), então `ceil(plies/2)` dá sempre ≥ 3.
- **Impacto**: uma captura simples exige dois lances de rei sem sentido; a dificuldade é inflada; o enunciado é falso; a chance de "errar" um lance tranquilo depois de já ter resolvido aumenta.
- **Correção recomendada**: medir **a meia-jogada em que o ganho acontece** (primeiro ponto em que o saldo ≥ 2 e a troca está estável), não o horizonte da medição. Encerrar a sequência quando o ganho estiver garantido.
- **Testes**: dama de graça → `single` e 1 lance; garfo de cavalo com recaptura → 2 lances; combinação de 3 lances continua com 3.

### A5 — Alta · A dica 1 não ajuda, mas custa como uma dica
- **Evidência (interface)**: dica 1 = "Objetivo: Encontre o melhor lance nesta posição.", o mesmo texto que já está no cabeçalho. A dica 2 mostra a peça; a dica 3, o lance. O resultado cai de 1 para 0,75, e a tentativa vira "com dica" na repetição espaçada.
- **Impacto**: o aluno é penalizado sem receber informação. A progressão pula de "nada" para "qual peça", o que entrega quase a resposta.
- **Correção recomendada**: a dica 1 deve trazer informação verificável e não decisiva: o motivo detectado (por exemplo "procure um xeque", "uma peça adversária está sobrecarregada") ou a casa/peça atacada. Assim, dica 2 = peça e dica 3 = lance.
- **Testes**: `hintForNode` de nível 1 ≠ objetivo, para todos os tipos de exercício.

### A6 — Alta · Lances forçados e posições já perdidas contam como acerto
- **Evidências (eventos gerados)**:
  - Légal, `rn1qkbnr/ppp2B1p/3p2p1/4N3/4P3/2N5/PPPP1PPP/R1BbK2R b KQkq - 0 6`: **Ke7 é o único lance legal** e gerou `defense:1@0.5`.
  - Ópera, `1Q2kb1r/p2n1ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 b k - 1 16`: **Nxb8 é o único lance legal**, levando a mate em 1, e gerou `tactics:1@0.5` e `defense:1@0.5`.
  - Byrne (brancas, a cor que perde): os lances 37 a 41, dentro da rede de mate, geraram **5 eventos `defense:1`**.
- **Causa**: a regra "já perdido por mate → bom" combinada com `defense_needed`, e `settledSwing` da melhor linha sem verificar se havia escolha.
- **Impacto**: o perfil de "Defesa" e de "Visão tática" sobe justamente nas partidas em que o aluno leva mate.
- **Correção recomendada**: não gerar evidência positiva quando `legalMoveCount ≤ 1` nem quando a posição já estava perdida por mate forçado antes do lance. Exigir que exista uma alternativa pior (diferença > tolerância) para premiar.
- **Testes**: as três posições, verificando que nenhum evento positivo é gerado.

### M1 — Média · Exercícios de "motivo do adversário" recebem objetivo enganoso e o título entrega o tema
- **Evidência**: `3qk3/8/8/8/3n4/8/2Q5/R3K3 w Q - 0 1`, o aluno jogou Qh2?? e o adversário respondeu Nf3+ (garfo). O exercício saiu com o título "Ataque duplo" e o objetivo "Mantenha a vantagem decisiva pelos próximos 2 lances".
  - Antes da árvore, `objectiveFor('fork')` = "Encontre o lance que ganha material", o que é errado para um garfo **sofrido**.
  - O cabeçalho do exercício (`THEME_LABEL`) revela o motivo antes da tentativa, por exemplo "Mate permitido" ou "Ataque duplo".
- **Correção recomendada**: definir o objetivo a partir de `concept.side`; temas do adversário viram "evite a tática do adversário". Esconder o tema até a primeira tentativa, ou mostrá-lo como dica 1.
- **Testes**: exercício gerado de um garfo sofrido → objetivo defensivo; o título não contém o tema antes da tentativa.

### M2 — Média · Cravada descrita como se já existisse
- **Evidência**: `r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1`, Kd2?. O texto diz: "Seu cavalo em d5 **está cravado** … pela peça em d8". A torre ainda está em a8; a cravada só surge com a resposta …Rd8.
- **Correção recomendada**: para motivos do adversário vindos de `motifOf(replyLine)`, usar o futuro ("o adversário pode cravar … com Rd8").
- **Testes**: essa posição, verificando que o texto não contém "está cravado" e contém o lance que crava.

### M3 — Média · O treino de aberturas não aceita transposições
- **Evidência (interface)**: no Sistema Londres, 1.d4 d5 2.**Nf3**. A resposta foi: "Nf3 não é o lance da linha. O esperado era Bf4. Esta linha será revisada mais cedo." O treino é encerrado e a falha é registrada.
- **Impacto**: pune uma ordem de lances padrão, sem dizer ao aluno se o lance é bom.
- **Correção recomendada**: aceitar lances que levem a uma posição (FEN sem contadores) presente na linha (transposição), ou classificar o desvio como "fora do repertório, mas jogável" sem registrar falha. Sem motor, só aceitar transposições exatas.
- **Testes**: London com 2.Nf3 e QGD com Nf3 antes de e3, verificando que o resultado não é `wrong`.

### M4 — Média · A identificação da abertura é generosa demais
- **Evidência**: 1.e4 e5 2.Nf3 Nc6 3.Bc4 **Nd4** (Blackburne-Shilling) aparece como "Abertura Italiana (Giuoco Piano)" na lista de partidas, em "Nas suas partidas" e em "Evolução por abertura".
- **Correção recomendada**: exigir que a partida chegue ao lance que define a abertura (por exemplo, Giuoco Piano = 3…Bc5), ou mostrar o nome do nível comum ("Abertura Italiana — desvio no 3º lance").
- **Testes**: `matchOpening` com 3…Nd4, 3…Nf6 e 3…Bc5.

### M5 — Média · Uma posição inválida no PGN derruba o motor, e a análise seguinte trava
- **Evidência (interface)**: um PGN com `[FEN "8/8/8/3k4/8/8/8/K6Q w - - 0 1"]` (rei preto em xeque com as brancas a jogar) é **importado sem aviso**, porque o chess.js aceita. Ao analisar:
  - "Erro no motor: Uncaught [object Object]" e, na barra lateral, "Motor indisponível".
  - A análise rápida de **outra partida** depois disso parou em "4/15 posições" por mais de 1 minuto. Só voltou a funcionar depois de recarregar a página.
  - Enquanto a análise rodava, a barra lateral continuou dizendo "Motor indisponível".
- **Correção recomendada**: validar a legalidade na importação (o lado que não joga não pode estar em xeque; número de reis; peões na 1ª/8ª fileira). Colocar um tempo limite por posição em `UciEngine` com reinício do worker. Mostrar uma mensagem de erro legível. Manter o indicador de estado do motor em sincronia.
- **Testes**: importar esse PGN → falha de importação com motivo claro. `UciEngine` com transporte que trava → rejeita com `timeout` e a fila continua.

### M6 — Média · "Erro grave" em posições já perdidas, com perda de 2,5 p.p.
- **Evidência**: Ópera 15…Nxd7 (`4kb1r/p2B1ppp/4qn2/4p1B1/4P3/1Q6/PPP2PPP/2KR4 b k - 0 15`, +11,4 → mate em 2) e Byrne 36.Kf1 (−20,5 → mate em 5): os dois aparecem como "Erro grave" e entram na contagem do resumo e nos temas recorrentes.
- **Correção recomendada**: com expectativa ≤ 5% antes do lance, `allowed_mate` deve ficar no máximo em "imprecisão", mantendo a marcação "Permitiu mate".
- **Testes**: `classifyMove` com antes = cp −1100 e depois = mate −2.

### M7 — Média · Explicações incompletas: "Por que ela é superior" só repete a linha
- **Evidência**: em todas as explicações posicionais ou de abertura, "Por que ela é superior" é igual a "A continuação preferida pelo motor foi …". Em 5…Bxd1, a alternativa dxe5 não tem justificativa. Em 5.Nxf7 (Blackburne), a ameaça citada é "Seu peão em g2", mas o ponto real é Qxg2 seguido de Qxh1/Qxe4+ e Nf3#.
- **Correção recomendada**: quando houver dados, comparar o lance jogado e a alternativa pelo mesmo critério (material estabilizado, mate, segurança do rei). Caso contrário, omitir a seção em vez de repetir a linha.
- **Testes**: `why` não pode ser igual à linha principal sem acrescentar um fato.

### M8 — Média · Acessibilidade e navegação
- As linhas da tabela de partidas abrem a análise só com o mouse: `<tr onClick>`, sem link e sem foco pelo teclado.
- No celular, a barra de navegação esconde os rótulos com `display:none` e não tem `aria-label`. Os links ficam sem nome acessível (o de "Treinar" é lido só como "1").
- Com cerca de 1000 px de largura, as colunas "Você/Análise/Ações" da tabela ficam atrás de uma rolagem horizontal.
- **Testes**: E2E navegando só com o teclado até a análise. Verificação de nome acessível na navegação em 375 px.

### Baixa
- **B1 · Concordância de gênero**: "Seu **torre** em a1 já podia ser **capturado**", "capturava **o dama** em d5", "ataca o rei em e1 e **dama** em h2". Os modelos usam artigo/possessivo masculino fixo.
- **B2 · Material inflado**: no exemplo do garfo, a consequência fala em "perda de 14 pontos", porque a linha inclui capturas posteriores ao motivo. Citar o ganho no primeiro ponto estável depois do motivo.
- **B3 · Texto de abertura**: Escandinava — "Em a5, a dama crava o cavalo de c3 quando o bispo vai a b4". Quem crava é o bispo; a dama aumenta a pressão.
- **B4 · Perfil com uma única evidência**: mostra "33% (0–72%)" depois de uma única falha. Está rotulado como "Poucas evidências", mas o número em destaque sugere uma precisão que não existe; mostrar só o intervalo, ou "—", abaixo de um peso mínimo.
- **B5 · Rótulo "alternativa equivalente" no melhor lance**: a árvore é buscada de novo e pode reordenar lances empatados. Em `8/8/8/3k4/8/8/8/K5Q1 w`, o lance principal da análise (Qg6) foi chamado de "alternativa equivalente aceita".
- **B6 · Sem crédito parcial**: acertar o 1º lance de uma sequência e errar o 2º vale 0, igual a errar o 1º. Registrar o progresso (por exemplo, 0,5) ajudaria a distinguir os níveis de cálculo.

### Não reproduzido ou não testado nesta etapa
- **Backup e restauração na interface**: não executados, porque a exportação baixa um arquivo. Pela leitura do código, `restoreBackup` só substitui as tabelas presentes no arquivo. Um backup parcial ou antigo mistura dados novos e antigos (por exemplo, `exercises` restaurado com `attempts` atuais). Recomenda-se um teste dedicado.
- **Sessões longas** (horas, dezenas de partidas): não testadas. O único sinal encontrado foi a falta de tempo limite do motor (M5).

---

## Classificação das explicações avaliadas

| Partida/posição | Lance | Classificação do lance | Explicação |
|---|---|---|---|
| Légal | 5…Bxd1 | erro grave (permitiu mate em 2) | **Correta** (falta justificar dxe5) |
| Légal | 4…g6 | erro | **Incorreta** (A2) |
| Blackburne | 4.Nxe5 | erro | **Incorreta** (A2) |
| Blackburne | 5.Nxf7 | erro grave | **Incompleta** (M7) |
| Blackburne | 7.Be2 | erro grave (mate em 1 com Nf3#) | **Correta** |
| Ópera | 10…cxb5 | erro | **Incorreta** (A2) |
| Ópera | 6…Nf6, 9…b5 | imprecisão | **Incompleta** (tema "abertura" para uma concessão tática) |
| Ópera | 15…Nxd7 | erro grave (mate em 2) | **Correta**, mas com severidade inadequada (M6) |
| Imortal | 11…cxb5 | erro grave | **Incorreta** (A3) |
| Imortal | 18…Bxg1 | erro grave | **Incorreta** (A3) |
| Imortal | 18.Bd6, 19.e5 | erro grave / imprecisão | **Correta** (ameaça em a1 real; concordância, B1) |
| Imortal | 20…Na6 | erro grave (mate em 3) | **Correta** |
| Byrne | 11.Bg5 | erro grave | **Incorreta** (A2) |
| Byrne | 18.Bxb6 | erro grave | **Incompleta** (cita o bispo em c4, não as descobertas em série) |
| Construída | Qh2?? (garfo) | erro grave | **Correta** (B1, B2) |
| Construída | Kd2? (cravada) | erro grave | **Incorreta** (tempo verbal, M2) |
| Construída | Ke2? (dama de graça) | erro grave | **Correta** (B1) |

Resultado: 7 corretas, 3 incompletas e 7 incorretas em 17 casos. Todas as afirmações sobre **mate** estavam corretas. Os erros se concentram nos textos de recurso e no lado do adversário.

---

## Plano de implementação priorizado

Cada etapa começa com os testes de regressão listados acima (vermelho), depois vem a correção (verde). Nenhuma etapa adiciona API externa, backend ou IA generativa.

1. **Integridade do treino**
   - C1: mate ≥ 5 e invariante "árvore nunca vazia".
   - A1: repetir não conta como acerto independente.
   - A5: dica 1 informativa.
   - Validação: unidade + E2E (dica → resolver → resolver de novo).
2. **Verdade das explicações**
   - A2: modelos sem negações não comprovadas, limite de 1 ponto para citar um ganho estabilizado, competência que não depende da fase.
   - A3: forma do adversário em `combination` e ordenação por `verified`.
   - M2: tempo verbal da cravada.
   - B1: concordância de gênero.
   - Validação: as 17 posições desta auditoria viram o corpus de regressão de `pedagogy.test.ts`.
3. **Perfil coerente**
   - A6: sem evidência positiva em lances únicos ou com mate já perdido.
   - M6: severidade em posições perdidas.
   - B4: esconder o número com evidência mínima.
   - Validação: eventos das partidas Légal, Ópera e Byrne.
4. **Qualidade dos exercícios**
   - A4: tamanho da sequência pelo ponto do ganho.
   - M1: objetivo a partir do lado do motivo, tema escondido até a tentativa.
   - B5: lance principal estável.
   - B6: crédito parcial (opcional; precisa de aprovação, porque muda o modelo).
5. **Robustez**
   - M5: validação de legalidade na importação, tempo limite e reinício do motor, estado do motor.
   - Teste de backup parcial e antigo.
6. **Aberturas**
   - M3: transposições.
   - M4: identificação pelo lance que define a abertura.
   - B3: texto da Escandinava.
7. **Interface e acessibilidade**
   - M8: links acessíveis por teclado, rótulos acessíveis no celular, colunas da tabela.
   - M7: seção "por que é superior" com fato ou omitida.

As etapas 1 e 2 sozinhas resolvem os problemas que hoje fazem o ChessQuest **ensinar ou medir algo errado**. As demais melhoram a precisão e a experiência.
