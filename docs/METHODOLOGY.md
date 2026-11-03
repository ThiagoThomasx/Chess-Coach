# Metodologia do ChessQuest

Este documento descreve as regras usadas para avaliar lances, gerar explicações e exercícios e estimar competências. Todas as regras ficam em funções puras, cobertas por testes em `tests/`.

## 1. Avaliações do motor

- Motor: Stockfish 19 *lite single-threaded* (WebAssembly), executado num Web Worker local. Nenhuma consulta remota.
- O protocolo UCI reporta pontuações do ponto de vista **do lado que joga**. `UciEngine` converte tudo para o ponto de vista **das brancas** (`toWhitePov`) antes de armazenar. Nunca se subtraem avaliações de perspectivas diferentes: a comparação é feita sempre do ponto de vista de quem moveu (`povOf`, `winPercentFor`).
- Pontuações de mate (`mate N`) são mantidas como `{ kind: 'mate' }` e **nunca** convertidas em centipawns. Uma posição de xeque-mate já no tabuleiro é codificada como mate com |valor| = 0,5.
- Uma busca interrompida (`stop`) é marcada `complete: false` e não é reutilizada nem tratada como definitiva.
- Cache: avaliações completas são guardadas por FEN (sem os contadores de lances). São reaproveitadas somente se a profundidade e o MultiPV armazenados forem ≥ aos pedidos. Limitação: ignorar o contador de 50 lances pode, em casos raros, reaproveitar uma avaliação de posição idêntica com relógio diferente.

## 2. Comparação de um lance

Para o lance *i* (da posição *P(i−1)* para *P(i)*):

1. A posição anterior é analisada com MultiPV *k* (padrão 3). A melhor linha dá a avaliação de referência.
2. Se o lance jogado aparece entre as *k* linhas, usa-se a pontuação **dessa linha** (mesma busca, mesma profundidade). Caso contrário, usa-se a avaliação da posição resultante *P(i)*.
3. As duas pontuações são convertidas em **expectativa de vitória** de quem moveu, pelo modelo logístico publicado pelo Lichess: `50 + 50·(2/(1+e^(−0,00368208·cp)) − 1)` (cp limitado a ±1000). Mate a favor = 100, mate contra = 0.
4. Perda = max(0, expectativa antes − expectativa depois), em pontos percentuais (p.p.).

## 3. Classificação

| Categoria | Regra (padrão, configurável) |
|---|---|
| Melhor lance | O lance é o primeiro da busca ou tem pontuação idêntica a ele |
| Excelente | perda < 2 p.p. |
| Bom | perda < 5 p.p. |
| Imprecisão | perda < 10 p.p. |
| Erro | perda < 15 p.p. |
| Erro grave | perda ≥ 15 p.p. |
| Inconclusivo | busca interrompida ou profundidade < mínimo (padrão 10) |

Regras de mate (precedem a tabela):

- **Permitiu mate**: depois do lance o adversário tem mate forçado que não tinha antes → erro grave.
- **Mate perdido**: havia mate forçado e ele desapareceu → imprecisão se a posição continua vencedora (≥ 80%), erro se ≥ 60%, senão erro grave.
- **Mate mais lento**: continua havendo mate, só mais longo → no máximo "bom".

Marcadores adicionais (não alteram a categoria): perda de posição vencedora, perda de vantagem, perda de igualdade, entrada em posição inferior (faixas: vencendo ≥ 80, vantagem ≥ 60, igual 40–60, pior 20–40, perdendo < 20), defesa necessária, erro de abertura (erro/erro grave até a meia-jogada 20), único lance (diferença ≥ 15 p.p. para a 2ª linha), perda de material (a linha de resposta do motor perde ≥ 2 pontos em até 6 meias-jogadas), oportunidade tática desperdiçada (a melhor linha ganhava ≥ 2 pontos).

### Métricas de partida

"Perda média de expectativa" = média da perda (p.p.) por lance conclusivo; "perda média em centipawns" considera só lances em que antes e depois são centipawns (limitado a 1000). **Não é** a "precisão" de outras plataformas e não deve ser comparada a ela.

## 4. Explicações

`services/pedagogy/concepts.ts` detecta conceitos usando apenas fatos verificáveis:

| Conceito | Verificação |
|---|---|
| Peça desprotegida | Após o lance, uma peça sua é atacada e sem defensores (ou atacada por peça de menor valor) **e** o primeiro lance da resposta do motor a captura **e** a linha do motor perde ≥ 2 pontos |
| Ameaça ignorada | Igual ao anterior, mas a peça já estava vulnerável antes do lance |
| Defensor removido | Igual, e a peça movida defendia a casa antes do lance |
| Ataque duplo | A melhor linha ganha ≥ 2 pontos e a peça que se move ataca ≥ 2 alvos de valor ≥ 3 (ou o rei) |
| Captura desperdiçada / xeque decisivo | A melhor linha ganha ≥ 2 pontos começando com captura / xeque |
| Mate perdido / permitido | Marcadores de mate da classificação |
| Abertura / final / posicional | Fallback por fase, marcado como explicação **limitada** |

Os textos ficam em `services/pedagogy/explain.ts`, separados da interface, e só interpolam evidências calculadas. Quando nenhuma causa é verificada, a explicação mostra apenas a avaliação objetiva do motor e é sinalizada como "limitada". Os ataques são geométricos (cravadas não são consideradas); por isso nenhuma perda é afirmada sem a confirmação da linha do motor.

## 5. Exercícios

Critérios mínimos (`checkCandidate`): análise completa, profundidade ≥ mínimo, lance classificado como erro/erro grave (ou imprecisão com mate perdido/tática desperdiçada), ≥ 2 lances legais, e o lance errado **não** pode estar dentro da tolerância (senão a posição é descartada como ambígua). No máximo *N* por partida (padrão 4), priorizando a maior perda; posições repetidas são ignoradas.

- **Lances aceitos**: todas as linhas do MultiPV cuja expectativa fica a até `tolerância` (padrão 5 p.p.) da melhor. Se houver mais de uma, o exercício é marcado como "várias soluções".
- **Lance fora da lista**: o motor analisa a posição resultante na hora; o lance é aceito se a perda ficar dentro da tolerância e a busca terminar. Se o motor não puder verificar, nada é registrado.
- **Sequências**: mates em até 3 e temas táticos guardam a linha forçada (até 3 lances do usuário). Cada lance seguinte precisa seguir a linha (ou dar mate); as respostas do adversário são jogadas automaticamente.
- **Dificuldade (1–5)**: base 2; +1 se o primeiro lance é tranquilo (sem captura/xeque); +1 se exige ≥ 3 lances; +0,5 se exige 2 lances (exceto capturas); −1 para captura simples; −0,5 se há várias soluções.
- **Dicas progressivas**: 1) tema/objetivo; 2) casa da peça a mover; 3) o lance.
- **Repetição de tentativa**: resolver de novo após errar na mesma sessão conta como ajuda (1 dica) no registro.

## 6. Repetição espaçada

Leitner simples (`services/scheduling/srs.ts`), intervalos padrão 1, 3, 7, 14, 30, 60 dias:

- Erro ou solução revelada → caixa 0, volta em 10 minutos.
- Acerto com dicas → mantém a caixa, metade do intervalo (mínimo 1 dia).
- Acerto independente → agenda pelo intervalo da caixa atual e sobe uma caixa.

Treinos de linhas de abertura do repertório usam o mesmo agendador (erro → revisão em 10 minutos).

## 7. Perfil de competências

Competências: visão tática, cálculo, identificação de ameaças, defesa, estratégia, aberturas, finais, reconhecimento de padrões.

**Evidências** (`SkillEvent`, todas rastreáveis a uma partida/lance, exercício ou linha de abertura):

| Fonte | Peso | Resultado |
|---|---|---|
| Exercício | 1 | 1 sem dica; 1 − 0,25·dicas (mín. 0,25) com dica; 0 se errou ou viu a solução. Exercícios com sequência ≥ 3 meias-jogadas também contam para "cálculo" (peso 0,5) |
| Lance de partida (fase: abertura/meio-jogo/final) | 0,2 | 1 bom+, 0,5 imprecisão, 0 erro |
| Erro de partida com conceito verificado | 0,5 | 0 na competência do conceito |
| Oportunidade aproveitada (ganho ≥ 2 encontrado, mate encontrado, defesa necessária encontrada, peça ameaçada salva) | 0,5 | 1 |
| Treino de abertura | 0,5 | 1 / 0 |

**Estimativa**: Beta(1,1) + Σ peso·resultado (α) e Σ peso·(1−resultado) (β). Mostra-se a média e o intervalo de credibilidade de 90% (aproximação normal da Beta). Nenhum rating é inferido; nenhum dado inicial é exigido.

**Confiança**: peso < 2 → poucas evidências; < 6 → evidências iniciais; última evidência há > 30 dias ou taxa recente (últimos 8 eventos) 20 p.p. abaixo da média → precisa revisar; peso ≥ 10, média ≥ 75% e limite inferior ≥ 60% → domínio provisório; senão desempenho consistente.

**Tendência**: compara os últimos 8 eventos com os 8 anteriores (≥ 4); diferença > 10 p.p. → subindo/caindo.

**Dificuldade-alvo**: começa em 1; duas vitórias independentes seguidas em exercícios de dificuldade ≥ alvo sobem 1; um erro desce 1. O filtro "No meu nível" mostra exercícios a ±1 do alvo. O tempo de resposta é registrado, mas não entra no cálculo.

## 8. Recomendações

"Seu próximo treino" só cita um tema quando o **mesmo conceito verificado** aparece em pelo menos 2 lances do usuário em partidas analisadas (com a cor definida). Cada recomendação lista os lances que a justificam, com link para a posição. Sem esse padrão, recomenda revisões pendentes ou mais diagnóstico; sem partidas, convida a importar.
