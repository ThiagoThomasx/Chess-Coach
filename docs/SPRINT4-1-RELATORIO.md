# Sprint 4.1 — Ciclo adaptativo de treinamento

- **Branch:** `feat/sprint4-1-adaptive-training`, criada a partir de `055f6e1`, o head do PR #1 auditado em `docs/SPRINT4-AUDITORIA.md`.
- **Data:** 2026-11-06.
- **Situação:** implementado e verificado localmente, e auditado na rodada 4.1.1 (§10). Ainda sem commit, push ou PR.

## 0. Pré-verificação (Fase 0)

| Item | Estado encontrado |
|---|---|
| Branch / HEAD | `fix/sprint3-phase1` @ `055f6e1`, igual a `origin` |
| `origin/main` | `9c964de`; **não** contém `055f6e1` |
| PR #1 | **Aberto**, sem merge (base `main`, head `fix/sprint3-phase1`) |
| Branch padrão no GitHub | `fix/sprint3-phase1` |
| Alterações locais | Só `.claude/` e `docs/SPRINT4-AUDITORIA.md`, nenhum dos dois rastreado; ambos foram preservados |

A divergência foi registrada e o trabalho parou para pedir orientação. O usuário escolheu criar a branch a partir de `055f6e1`. Por isso, o PR desta sprint deve usar `fix/sprint3-phase1` como base, ou ser rebaseado em `main` depois que o PR #1 entrar.

## 1. Problema original

A auditoria da Sprint 4.0 apontou que **o ciclo de treino não responde ao treino**:
- O "Seu próximo treino" contava os padrões de erro em **todo** o histórico. Um padrão visto duas vezes ficava no topo para sempre.
- O desempenho nos exercícios não mudava a recomendação.
- Revisões vencidas perdiam para qualquer padrão recorrente.
- Não havia sessão guiada: o jogador escolhia exercício por exercício numa lista.

## 2. Decisões de implementação

- **Um único sistema de recomendação.** `nextTraining` continua sendo a única entrada. Ele recebeu dois parâmetros opcionais (`exercises`, `attempts`), e as chamadas antigas continuam válidas. A evidência dos exercícios por padrão fica num módulo puro novo, `themeEvidence.ts`, usado pela recomendação.
- **Nenhuma mudança de esquema e nenhuma entidade nova.** A sessão é um plano, isto é, uma lista ordenada de ids, guardado no `localStorage`. Os resultados são as tentativas normais gravadas por `recordAttempt`: mesma janela de prática, mesmo reagendamento e mesmas evidências de perfil. O banco continua na versão 2. Backup e restauração não mudam, porque nenhuma tabela foi criada.
- **Mesma chave de padrão dos dois lados.** O padrão de erro das partidas e o padrão do exercício usam a mesma chave, `tema` ou `tema:lado` para motivos bilaterais. Assim, o desempenho nos exercícios de "ataque duplo do adversário" não se mistura com "ataque duplo não aproveitado".
- **Revisão vencida significa exercício já tentado.** Um exercício novo nasce com `dueAt` igual ao momento da criação. Sem esta regra, analisar uma partida que gera 5 exercícios faria "Revisões pendentes" ocupar a recomendação. Esse problema foi encontrado na revisão de código e corrigido; veja a seção 7.
- **A sessão usa o próprio solucionador.** `Solver` foi exportado e recebeu uma propriedade opcional `session` (cabeçalho e controles). Fora da sessão ele se comporta exatamente como antes.

## 3. Regras adaptativas

Os números estão em `src/services/recommendations/recommend.ts` e `themeEvidence.ts`, cada um com a justificativa no comentário.

| Regra | Valor | Por quê |
|---|---|---|
| Janela recente de partidas | 10 últimas analisadas | Ordenadas pela data do PGN; empate desfeito pela importação. Partidas sem data confiável contam como as mais antigas e a mensagem informa quantas estão na janela (auditoria 4.1.1, §10). O histórico continua no Progresso. |
| Ocorrências mínimas de um padrão | 2 | Regra já existente, mantida. |
| Evidência por exercício | 1 por exercício, com o resultado da **última** tentativa | Repetir a mesma posição não infla a amostra. Repetições dentro da janela de prática nem são gravadas (regra existente). |
| Janela recente de exercícios | Os 10 últimos exercícios do padrão | Uma melhora consistente tira as falhas antigas da janela. |
| Amostra insuficiente | Menos de 3 exercícios | Nada muda, e um único exercício nunca altera a recomendação. |
| Em dificuldade | Menos de 50% de acertos **sem ajuda** | Acertos com dica são contados à parte e não valem como independentes. |
| Dominado nos exercícios | ≥ 5 exercícios, ≥ 80% sem ajuda e ≥ 2 deles de dificuldade ≥ 2 | Os 5 exercícios são o mesmo limite do perfil (`MASTERY_DISTINCT_EXERCISES`). A exigência de dificuldade impede que só capturas triviais contem. |
| Prioridade | ocorrências recentes × fator | O fator é 1,5 em dificuldade, 0,5 quando dominado e 1 nos outros casos. |
| Revisões primeiro | ≥ 5 revisões vencidas | Metade da meta diária padrão (10). Com o padrão do topo já dominado, basta 1 revisão vencida. |

**Ordem final da recomendação:**
1. Muitas revisões vencidas.
2. Padrão recorrente recente, ponderado pelo desempenho nos exercícios.
3. Revisões vencidas.
4. Padrão em dificuldade só nos exercícios.
5. Competência que precisa de revisão (regra existente).
6. Ampliar o diagnóstico.

Os pesos e a meia-vida do perfil (`skills.ts`) **não foram alterados**.

**A justificativa usa números reais.** Um exemplo gerado pelos testes: "Você deixou peças desprotegidas em 2 posições recentes. … Contagem nas últimas 4 partida(s) analisada(s). Nos exercícios deste tema, você resolveu 1 de 4 sem ajuda, 3 com dicas. Você tem 2 revisão(ões) vencida(s)." Quando ainda não há tentativa, a mensagem diz isso e não mostra porcentagem.

`docs/METHODOLOGY.md` §8 foi atualizado com essas regras.

## 4. Sessão guiada (`/train/session`)

1. **Preparação.** A tela mostra a recomendação atual e quantos exercícios de cada grupo entram na fila: revisões vencidas, foco recomendado e exercícios no seu nível.
2. **Fila.** Tem no máximo `dailyGoal` exercícios e nenhum se repete. A ordem é:
   - revisões vencidas, das mais atrasadas para as mais recentes;
   - exercícios do foco recomendado (padrão ou competência);
   - exercícios a ±1 da dificuldade-alvo da competência.

   Ficam de fora os exercícios não vencidos cuja última tentativa foi um acerto sem ajuda, porque a repetição espaçada já decidiu quando eles voltam. Também ficam de fora os tentados nos últimos 10 minutos: uma nova tentativa seria prática, não seria gravada e a sessão não avançaria (auditoria 4.1.1).
3. **Fila curta.** Se houver menos exercícios do que a meta, a tela avisa ("Há N exercício(s) adequado(s) agora; sua meta diária é M. Nenhum exercício é repetido…") e oferece o link para a lista. Se não houver nenhum, mostra um estado vazio com explicação e acesso aos exercícios.
4. **Durante a sessão.** Aparece um exercício por vez, com uma barra no topo que mostra "Exercício i de N", o motivo do exercício e o progresso. Depois do resultado, "Próximo exercício" avança. Antes do resultado, "Pular" registra só a escolha, sem criar tentativa.
5. **Interromper e retomar.** "Interromper" volta para o Treino e mantém o plano do dia. Ao voltar, mesmo depois de recarregar a página, a sessão continua no primeiro exercício ainda não feito. Exercícios concluídos não reaparecem.
6. **Encerrar.** "Encerrar" mostra o resumo a qualquer momento e encerra a sessão: o plano deixa de ficar guardado, então sair do resumo por qualquer caminho não a traz de volta como ativa. "Continuar exercícios", no resumo, guarda o plano de novo. Terminar o último exercício também encerra (auditoria 4.1.1).
7. **Sem inflação de estatísticas.** Navegar não grava nada. O resultado de um exercício na sessão é a primeira tentativa registrada depois do início dela.

## 5. Resumo após o treino

Mostra os exercícios realizados, os acertos sem ajuda, os acertos com dicas, os erros (incluindo os de solução vista), as revisões concluídas, os pulados e as competências trabalhadas. São contagens absolutas desta sessão, sem porcentagem ou "evolução" calculada sobre poucos exercícios.

A **próxima recomendação** aparece no mesmo painel. Ela vem de uma consulta ao vivo (`useTrainingLoop`), então já reflete as tentativas gravadas sem recarregar a página. O E2E confirma isso:
- **Antes da sessão:** "Você tem 2 exercício(s) para revisar hoje."
- **Depois da sessão:** "Nos exercícios deste tema, você resolveu 1 de 3 sem ajuda, 1 com dicas. Vale reforçar este tema antes de avançar."

## 6. Arquivos

**Novos:**
- `src/services/recommendations/themeEvidence.ts`: evidência dos exercícios por padrão, estados e fatores.
- `src/services/training/session.ts`: fila, resultados, resumo e validação do plano salvo. Módulo puro.
- `src/features/training/SessionPage.tsx`, `SessionSummary.tsx`, `sessionStore.ts` (`localStorage` com try/catch) e `useTrainingLoop.ts` (dados ao vivo e recomendação).
- `tests/adaptive.test.ts` (18 testes), `tests/session.test.ts` (13 testes) e `tests/support/training.ts`.
- `e2e/session.spec.ts` (4 testes, incluindo telefone 360×800).
- Auditoria 4.1.1: `tests/adaptive-boundaries.test.ts` (17 testes), mais 2 testes em `tests/session.test.ts` e 6 em `e2e/session.spec.ts` (veja §10).

**Alterados:**
- `recommend.ts`: janela recente, ranking com fator, ordem nova e `focus`/`performance` na recomendação.
- `srs.ts`: adicionado `isDueReview`.
- `stats.ts`: adicionados `gameTime` e a chave cronológica nos dados analisados.
- `ExerciseSolver.tsx`: modo sessão opcional.
- `DashboardPage.tsx`:
  - a recomendação recebe exercícios e tentativas;
  - adicionado o botão "Sessão guiada de hoje";
  - o card "Revisões pendentes" passa a contar só revisões, sem os exercícios novos.
- `TrainingPage.tsx`: adicionado o botão "Sessão guiada".
- `App.tsx`: adicionada a rota `/train/session`.
- `features.css`: estilos da barra de sessão, do plano e do resumo.
- `docs/METHODOLOGY.md` §8.

`docs/SPRINT4-AUDITORIA.md`, da rodada anterior, continua sem commit, junto com esta sprint.

## 7. Testes executados

**Testes novos de recomendação:**
- competência recorrente com baixo desempenho;
- melhora consistente: as falhas antigas saem da janela;
- tema dominado com amostra suficiente, perdendo prioridade sem ser apagado;
- domínio negado só com exercícios fáceis;
- amostra insuficiente;
- revisões vencidas, acima e abaixo do limite;
- revisão vencida contra tema dominado;
- acertos com e sem dica;
- repetição do mesmo exercício;
- histórico antigo contra janela recente;
- ordem por data e por importação;
- ausência de exercícios, com a mensagem sem números inventados;
- exercícios antigos sem `motifSide`.

**Testes novos de sessão:**
- ordem da fila;
- respeito ao `dailyGoal`, sem completar a fila artificialmente;
- sem duplicatas;
- exercícios já resolvidos fora da fila;
- foco por competência;
- fila vazia;
- exercícios novos não contam como revisão;
- avanço e pulo;
- tentativas anteriores à sessão ignoradas;
- resumo;
- interrupção e retomada, com o plano salvo indo e voltando e planos de outro dia ou inválidos recusados.

**Integração (IndexedDB real em memória):** uma sessão completa feita por `recordAttempt`:
- a repetição dentro da janela de prática é recusada;
- a repetição espaçada reagenda os exercícios;
- o perfil recebe uma evidência por tentativa;
- a recomendação seguinte muda;
- exercícios antigos sem os campos novos continuam funcionando, com o banco ainda na versão 2.

**E2E:**
- fluxo completo: Treino → iniciar → resolver três exercícios (um sem ajuda, um com dica, um com a solução vista) → resumo com os números certos → recomendação atualizada no resumo e no dashboard; e exatamente uma tentativa gravada por exercício;
- interrupção com recarga da página, retomada no exercício 2, pulo e encerramento;
- estado vazio;
- telefone 360×800 com toque: botões de 44 px e nenhuma rolagem horizontal em todas as telas da sessão.

### Resultados da Sprint 4.1

Registro da entrega da 4.1. Os resultados finais, depois da auditoria 4.1.1, estão na §10.

| Verificação | Antes (`055f6e1`) | Depois da 4.1 |
|---|---|---|
| Typecheck | 0 erros | 0 erros |
| Vitest | 239 | **270/270** (239 + 18 + 13) |
| Stockfish real | 21/21 | **21/21** |
| Build | OK | OK |
| Playwright | 28 | **32/32**, incluindo o E2E existente de zero requisições externas |

**Revisão de código.** Um agente revisor independente leu o diff e apontou:
- **1 achado HIGH, corrigido.** Um exercício novo contava como revisão vencida. Corrigido com `isDueReview`, e há testes de regressão.
- **3 achados MEDIUM, corrigidos:**
  - com muitas revisões, o foco podia ficar num tema já dominado;
  - partidas da mesma data não tinham desempate pela importação;
  - exercícios antigos sem `motifSide` não contavam para o padrão bilateral.
- **Formatação:** um bloco do `Solver` estava mal formatado e foi corrigido.

Os itens restantes estão na seção 8.

## 8. Limitações conhecidas

Só limitações em aberto. Dois itens da lista original da 4.1 foram resolvidos na auditoria 4.1.1 e estão na §10: as datas incompletas no PGN e a falta de teste em 430 px.

- **Virada do dia com a página aberta.** O plano é validado ao abrir a tela. Se a página ficar aberta depois da meia-noite, o plano do dia anterior continua até recarregar. O cálculo de "vencido" também usa o instante da última mudança nos dados.
- **Tentativas fora da sessão.** Um exercício da fila resolvido pela lista normal depois de interromper a sessão aparece como feito no resumo. Isso é coerente com "os resultados são as tentativas normais", mas o resumo não diferencia esse caso.
- **Exercícios excluídos durante a sessão** simplesmente saem da fila. Se todos forem excluídos, o resumo mostra 0.
- **Origem de exercícios antigos.** A chave de padrão vem do primeiro conceito detectado, mesmo quando ele não foi verificado. As partidas só contam conceitos verificados. Um exercício antigo desse tipo pode alimentar uma chave que as partidas não contam. O efeito é só não influenciar.
- **Tamanho da sessão.** A meta diária é o tamanho da sessão, sem descontar o que já foi feito no dia. Iniciar uma segunda sessão monta outra fila sem repetir exercícios já resolvidos sem ajuda.
- **Card do dashboard.** Exercícios novos não entram mais em "Revisões pendentes" no dashboard. Na lista de treino continuam marcados "Pendente", como antes.
- **Sem aparelho físico.** O teste em celular real continua pendente, como desde a Sprint 3.1. A verificação foi feita só por emulação.
- **Duas abas.** As duas abas usam o mesmo plano e veem os mesmos resultados (consulta ao vivo), sem gravar nada em dobro (E2E). A lista de "pulados", porém, fica na memória de cada aba: pular em uma aba e depois pular em outra pode sobrescrever o pulo da primeira. O exercício só volta a aparecer como pendente; nenhuma estatística é afetada. Da mesma forma, se uma aba encerra a sessão e a outra, ainda aberta nela, usa "Pular", a sessão volta a ficar guardada. Só o E2E do plano compartilhado sem gravação em dobro cobre duas abas; esses dois casos não têm teste.
- **Domínio sem decaimento no tempo.** A janela de exercícios é por quantidade (10 últimos), não por data. Um tema dominado há meses continua "dominado" até as revisões espaçadas trazerem os exercícios de volta. O efeito é limitado: o fator 0,5 só reduz a prioridade, qualquer revisão vencida passa à frente e a mensagem diz que o foco é reconhecer o tema na partida. Proposta, se a evidência de uso mostrar que é um problema: exigir que parte dos 5 exercícios seja dos últimos N dias. Os limites não foram alterados nesta auditoria.
- **Navegação muito rápida.** As rotas carregam sob demanda e a navegação é uma transição do React. Se a pessoa voltar para a sessão antes de outra tela terminar de carregar, a tela anterior continua montada com o estado que tinha. Isso só foi observado em automação (dois `goto` sem esperar a página); nenhum resultado é gravado em dobro.

## 9. Decisões que afetam as próximas sprints

- **`focus` na recomendação** é o contrato entre recomendação e sessão. Qualquer novo tipo de recomendação que queira alimentar a sessão deve preenchê-lo.
- **"Revisão vencida" exige tentativa anterior** (`isDueReview`). Telas novas devem usar essa função, e não `dueAt ≤ agora`.
- **O plano da sessão é local e diário.** Se no futuro for preciso histórico de sessões ou sincronização, aí sim será necessária uma tabela nova, com migração v3. Isso não foi necessário agora.
- **Base do PR.** Esta branch foi criada a partir de `055f6e1`. O PR deve usar `fix/sprint3-phase1` como base até o PR #1 entrar na `main`.

## 10. Auditoria 4.1.1 (antes do primeiro commit)

Objetivo: auditar a implementação sem adicionar funcionalidades. Cada problema foi reproduzido por um teste automatizado que falhava antes da correção.

### Problemas reproduzidos e corrigidos

| # | Problema | Como foi reproduzido | Correção | Regressão |
|---|---|---|---|---|
| 1 | **"Encerrar" não encerrava.** Depois de "Encerrar", sair do resumo pela navegação (sem "Concluir") e voltar trazia a sessão de volta como ativa. | E2E: falha com o código antigo (confirmado revertendo só a correção) e passa com o novo. | "Encerrar" e o fim do último exercício apagam o plano guardado; "Continuar exercícios" o guarda de novo. `SessionPage.tsx`. | `e2e/session.spec.ts` › *an ended session is not resumed as active* |
| 2 | **Sessão travada pela janela de prática.** Um exercício errado pela lista há menos de 10 minutos podia entrar na fila (foco ou nível). A nova tentativa seria prática e não seria gravada: o exercício nunca ganhava resultado, só restava "Pular", e o resumo não o contava. | Vitest: `buildQueue` incluía o exercício. | `buildQueue` deixa de fora exercícios tentados dentro da janela de prática. `session.ts`. | `tests/session.test.ts` › *leaves out an exercise attempted in the last 10 minutes* |
| 3 | **Datas não confiáveis tratadas como recentes.** Data ausente ou incompleta usava a data de importação (entrava como recente). `2023.13.45` e `2023.02.30` eram aceitas (o `Date.UTC` "rola" para outra data). Datas futuras ficavam sempre no topo. | Vitest: `gameTime` devolvia uma data para esses casos. | `gameTime` devolve "sem data confiável" para ausente, incompleta, inválida, ano < 1400 e posterior ao dia da importação. Essas partidas contam como as mais antigas, e a mensagem diz quantas estão na janela. Nenhuma data é inventada e o PGN original não muda. `stats.ts`, `recommend.ts`. | `tests/adaptive-boundaries.test.ts` › *game dates* |

**Comportamento de datas definido:**

| Data no PGN | Tratamento |
|---|---|
| Ausente ou incompleta (`????.??.??`, `2024.??.??`) | Sem data confiável: conta como a mais antiga |
| Inválida (`2023.13.45`, `2023.02.30`, `0050.01.01`) | Sem data confiável |
| Futura (posterior ao dia da importação, com 1 dia de folga) | Sem data confiável |
| Antiga (por exemplo, `1985.03.07`) | Usada como está: fica fora da janela se houver 10 partidas mais novas |
| Válida e recente | Usada como está |

### Cenários verificados sem problema

- **Sessão:**
  - recarregar antes de responder;
  - recarregar depois de responder e antes de avançar (o exercício respondido não volta);
  - interromper e voltar;
  - "Continuar" depois de "Encerrar";
  - iniciar de novo com uma sessão interrompida no mesmo dia, o que retoma a mesma sessão e não cria outra;
  - duas abas: o mesmo plano, resultado visto ao vivo na outra aba e uma só tentativa gravada.
- **Exercício resolvido pela lista enquanto está na fila.** Conta como feito na sessão, porque é a mesma tentativa, gravada uma vez, e não volta à fila.
- **Fronteiras da recomendação** (em `tests/adaptive-boundaries.test.ts`, que tem 17 testes ao todo, incluindo datas e ordenação):
  - 2 contra 3 exercícios;
  - 4 contra 5;
  - 79% contra 80%;
  - menos de 2 contra 2 acertos de dificuldade ≥ 2, com acerto com dica não contando;
  - tema dominado com evidência antiga;
  - amostra baixa;
  - tema fraco com 4 contra 5 revisões vencidas;
  - tema dominado com 1 revisão vencida;
  - empates (mais ocorrências vencem; depois a ordem cronológica, independente da ordem do array);
  - nenhuma partida analisada.

  Um exercício a mais só muda o fator de prioridade depois da amostra mínima, e no máximo para ×1,5 ou ×0,5. As regras deram decisões coerentes, e nenhum limite estatístico foi alterado.
- **Repetição espaçada.** Teste de integração com IndexedDB:
  - exercício novo não é revisão;
  - uma tentativa válida com dica mantém a caixa e reagenda pela metade do intervalo (3,5 dias na caixa 2 de [1, 3, 7]);
  - uma repetição dentro da janela de prática não muda tentativas, agenda nem evidências;
  - o exercício vira revisão vencida exatamente na data, e não antes.

  `lastReviewedAt` existe desde o MVP (`ef447c1`), então exercícios antigos já tentados continuam sendo reconhecidos como revisões.
- **Arquitetura:**
  - banco na versão 2;
  - nenhum arquivo do motor, do banco ou do backup alterado;
  - nenhuma chamada de rede nos módulos da sprint (o E2E de zero requisições externas continua passando);
  - um só perfil (`estimateProfile`) e uma só recomendação (`nextTraining`);
  - o `localStorage` guarda só `version`, `startedAt`, `day`, os ids e motivos da fila e os ids pulados, sem resultados nem dados de partida.
- **Layout em 360, 390, 430 e 768 px (emulação, sem aparelho físico):**
  - botões da sessão com pelo menos 44 px;
  - posição, "Interromper" e "Encerrar" sem sobreposição;
  - feedback e "Próximo" sem sobreposição;
  - barra de progresso visível;
  - nenhuma rolagem horizontal no exercício nem no resumo.

### Ajustes de testes

- O teste antigo *skips exercises already solved independently* usava tentativas de 100 ms antes. Pela correção 2 elas agora ficam de fora, então passaram a 20 minutos antes. A intenção do teste não mudou.
- Os novos E2E esperam a página de destino aparecer antes de voltar à sessão. Sem essa espera, dois `goto` seguidos não desmontam a tela (rotas lazy em transição). Isso é um artefato de automação, descrito nas limitações.

### Resultados finais

| Verificação | Referência (4.1) | Depois da 4.1.1 | Diferença |
|---|---|---|---|
| Typecheck | 0 erros | 0 erros | — |
| Vitest | 270 | **289/289** | +19: 17 de fronteira, datas e ordenação; 2 de sessão (janela de prática e ciclo SRS) |
| Stockfish real | 21 | **21/21** | — |
| Build | OK | OK | — |
| Playwright | 32 | **38/38** | +6: sessão encerrada, duas abas, layout em 360/390/430/768 px |

Também não há `console.log` em `src`. O banco continua na versão 2, e `.claude/` não foi alterado.

### Revisão final pré-commit

A revisão do diff completo não encontrou problema CRITICAL, HIGH ou MEDIUM. Os cinco itens LOW foram corrigidos:

| # | Item | Correção | Verificação |
|---|---|---|---|
| 1 | Comentário de `AnalyzedGameInput.at` ainda dizia "senão, data de importação" | Comentário reescrito conforme `gameTime` | — |
| 2 | Itens já resolvidos (datas, 430 px) apareciam como limitações | Retirados da §8, com nota apontando para esta seção | — |
| 3 | O resumo dizia "você pode continuar hoje" mesmo depois de "Encerrar", quando sair da tela já encerra a sessão | O texto agora diz para usar "Continuar exercícios" antes de sair | E2E *an ended session is not resumed as active* verifica o texto |
| 4 | Encerrar em uma aba e pular na outra volta a guardar a sessão; isso não estava documentado | Descrito na §8, com a observação de que não há teste | — |
| 5 | A ordenação por data dependia de `NaN` ser falso no `\|\|` (duas partidas sem data) | Comparador explícito `byDate`, mesmo comportamento | `tests/adaptive-boundaries.test.ts` › *ordering* |

O mesmo `tests/adaptive-boundaries.test.ts` passou de 16 para 17 testes. O Playwright continua com 38: só ganhou verificações dentro de um teste que já existia. Os números da tabela acima vêm da bateria rodada depois dessas correções.
