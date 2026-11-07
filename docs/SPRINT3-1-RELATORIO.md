# ChessQuest — Sprint 3.1: fechamento do PR #1

Data: 2026-11-05 · Branch `fix/sprint3-phase1` ([PR #1](https://github.com/ThiagoThomasx/Chess-Coach/pull/1)), sobre o commit `6f0aef9`. As alterações desta rodada foram commitadas e enviadas como `b38830e`. Sem merge, sem auto-merge e sem alteração nas regras do repositório.

## Situação atual (atualizado em 2026-11-06)

**CI no commit `b38830e`**: [execução 42135543730](https://github.com/ThiagoThomasx/Chess-Coach/actions/runs/42135543730), evento `pull_request`, terminou com **sucesso**.

- Verificação dos arquivos WASM do Stockfish: aprovada.
- Typecheck: aprovado.
- Vitest: 239/239, incluindo o Stockfish real com 21/21.
- Build: aprovado.
- Playwright E2E: 28/28.
- Nenhum teste ignorado.
- Avisos apenas informativos: deprecação do `punycode` no Node, e as actions na v4 (`checkout`, `setup-node`, `cache`), feitas para Node 20, rodando em Node 24.

**Validação mobile**

- *Validado por automação* (Playwright, Chromium com emulação de toque):
  - viewports de 360, 390, 430 e 768 px;
  - ausência de rolagem horizontal;
  - alvos de toque de 44 px;
  - tabuleiro de Aberturas visível e priorizado;
  - volta da biblioteca de aberturas para o tabuleiro;
  - comportamento no desktop preservado.
- *Ainda depende de teste em aparelho físico, **não realizado***:
  - precisão do toque e arraste de peças;
  - desempenho do Stockfish em CPU de celular;
  - persistência ao sair do app e voltar;
  - teclado virtual e barra de endereço;
  - rotação de tela;
  - compatibilidade com Safari no iOS.

  O roteiro está na seção 6.

**PR #1**

- Continua aberto. O último commit validado é `b38830e`, com o CI aprovado nesse SHA.
- Na última verificação, estava sem conflitos (`MERGEABLE`, `CLEAN`) e sem revisões nem comentários pendentes.
- O auto-merge está desativado e nenhum merge foi feito.
- A `main` não tem branch protection, rulesets nem required status checks: o check `verify` é apenas informativo.

## 1. Diagnóstico

### Problemas encontrados

| # | Problema | Gravidade | Evidência |
|---|---|---|---|
| D1 | Deduplicação de exercícios sem transação: duas gravações simultâneas da mesma posição geram 2 exercícios | Integridade dos dados | Teste em `tests/persistence.test.ts` falhou antes da correção (2 gravados), nos cenários de mesma conexão e de duas conexões |
| D2 | `newId()` usa `crypto.randomUUID`, que só existe em contexto seguro (HTTPS ou localhost). Aberto do celular em `http://<IP-da-rede>:porta`, a importação de PGN falha | Funcional, e bloqueia o teste no aparelho | Teste unitário falhou com `crypto.randomUUID is not a function`. No Chromium, pelo IP da rede (`isSecureContext = false`), a importação falhou com o código antigo e funcionou com a correção |
| D3 | Erro ao salvar o exercício pelo botão "Criar exercício desta posição" deixava o botão travado em "Calculando a sequência…", sem aviso | Funcional (achado da revisão) | E2E com falha simulada do IndexedDB falhou antes (nenhuma mensagem) e passa depois |
| M1 | Em Aberturas, no celular, o tabuleiro começava em y ≈ 853 px (telas de 800 e 844 px de altura): era preciso rolar a lista da biblioteca para chegar a ele | Usabilidade mobile | Medição automatizada (seção 3) e E2E que falhou antes (base do tabuleiro em 1181 px) |
| M2 | Alvos de toque abaixo de 44 px: navegação (39×36), botões (34 px), botões compactos, lances e abas de variante (28–29 px), lista de lances da análise (29 px), links de texto (17–20 px), caixa de seleção (13×13) | Usabilidade mobile | Medição automatizada nas quatro larguras |
| M3 | Em Aberturas, a ordem de leitura e de teclado (biblioteca → tabuleiro) não acompanhava a ordem visual no celular depois da correção de M1 | Acessibilidade (achado da revisão) | E2E que compara a posição no documento falhou antes |

### Problemas descartados

- **Gravação parcial na deduplicação**: `addExercise` faz uma única escrita (`add`). Uma falha não deixa estado intermediário, e o teste de falha passou antes e depois da correção. A transação foi adotada por causa da concorrência (D1), não por gravação parcial.
- **Rolagem horizontal da página**: nenhuma, em todas as telas e larguras medidas. Isso já era verdade antes desta rodada.
- **Desempenho da varredura O(n) na deduplicação**: continua sem otimização, porque não há evidência de impacto (medições em [SPRINT3.1-VALIDACAO.md](SPRINT3.1-VALIDACAO.md), menos de 5% do tempo da etapa mesmo com 10.000 exercícios).
- **Casas do tabuleiro de 41 px a 360 px de largura**: é a largura disponível dividida por 8 (328 px). O tabuleiro já usa a largura toda, e não há o que corrigir.
- **Link da partida na tabela (37 px de altura)**: a linha inteira da tabela é clicável, e o link existe para o teclado e os leitores de tela.

## 2. Deduplicação

**Fluxo atual** (`src/db/trainingRepo.ts`, `addExercise`):

1. Calcular `fenKey(fen)`, que é o FEN sem os contadores de lance.
2. Ler: `exercises.filter(fenKey(e.fen) === key).first()`.
3. Se encontrar, devolver o id existente. Se não, `exercises.add(ex)`.

As chamadas vêm de dois lugares: da geração automática (`deriveFromAnalysis`, uma por posição selecionada) e do botão "Criar exercício desta posição" (`ExplanationPanel`).

**Respostas:**

- **Duplicação concorrente: sim, real e reproduzível.**
  - Antes, a leitura e a escrita ficavam em transações separadas. Duas chamadas simultâneas para a mesma posição, com contadores de lance diferentes, passavam ambas pela checagem.
  - Cenários reais: o botão coincidir com a geração automática da mesma partida, ou duas abas analisando a mesma partida.
- **Gravação parcial: não.** Há uma única escrita.
- **Cobertura da transação: agora completa.** A leitura e o `add` estão em `db.transaction('rw', db.exercises, …)`.
  - O IndexedDB serializa transações de escrita no mesmo store, inclusive entre abas.
  - Nada fora do Dexie é aguardado dentro da transação. A construção da árvore de solução com o Stockfish acontece antes de `addExercise`, então a transação não fecha antes da hora e continua curta.
- **Compatibilidade:** não há mudança de esquema (continua v2), nem de formato de dados ou de backup.

**Testes** (`tests/persistence.test.ts`, bloco "exercise deduplication is atomic"):

| Teste | Antes | Depois |
|---|---|---|
| Duas inserções simultâneas da mesma posição na mesma conexão gravam 1 exercício, e as duas chamadas devolvem o mesmo id | Falhou (2) | Passa |
| Duas conexões (simulando duas abas) gravando ao mesmo tempo gravam 1 | Falhou (2) | Passa |
| Uma inserção que falha (id repetido) não grava nada e propaga o erro (rollback) | Passa | Passa |

Limitação: o teste de "duas abas" usa duas conexões do `fake-indexeddb` no mesmo processo. Ele modela a serialização de transações do IndexedDB, mas não substitui duas abas reais.

**Erro na criação manual (D3)**: `ExplanationPanel.create` agora usa `try/catch/finally`. Em caso de falha, mostra "Não foi possível salvar o exercício. Nada foi gravado; tente novamente." e libera o botão. Na geração automática (`analysisRunner`), um erro continua sendo tratado como falha da análise, como antes.

## 3. Mobile

**Método**: Playwright no build de produção, com emulação mobile (toque, `pointer: coarse`, user agent Android), dados reais (uma partida importada e analisada pelo Stockfish, com o exercício gerado) e medição de cada elemento interativo por `getBoundingClientRect`.

**Viewports**: 360×800, 390×844, 430×932 e 768×1024. A 1440×900 e a 1100 px, foi verificado que o layout de mouse não mudou.

**Telas**: dashboard, navegação, partidas, análise, treinar, exercício, aberturas, evolução e configurações.

### Por seção

| Seção | Problema | Correção |
|---|---|---|
| Navegação (abaixo de 860 px) | Ícones com 39×36 px | Mínimo de 44×44 px |
| Botões, campos e seletores (todas as telas) | 34 px (28 px nos compactos) | 44 px em telas de toque (`@media (pointer: coarse)`). Com mouse, nada muda |
| Aberturas | Tabuleiro abaixo da biblioteca, com o topo em y ≈ 853 px | Ordem no celular: tabuleiro e navegação, depois detalhes da linha (variantes, praticar, repertório), depois biblioteca. Topo do tabuleiro em y ≈ 229 px (360 e 390) e 207 px (430). Ao escolher uma abertura na biblioteca, a tela volta ao tabuleiro |
| Aberturas | Lances da linha e abas de variante com 28–29 px | 44 px de altura no toque |
| Aberturas | Ordem de teclado e de leitor de tela diferente da visual | A ordem no DOM passou a ser tabuleiro → detalhes → biblioteca, com `grid-template-areas` mantendo a posição de cada coluna no desktop e no tablet |
| Análise | Lista de lances com 29 px | 44 px no toque. A lista mantém a própria caixa de rolagem (340 px) |
| Análise e exercício | Link "← Partidas" / "← Treino" com 20 px | Área de toque ampliada (padding com margem negativa, sem mudar o layout) |
| Exercício | Link "Partida de origem" com 17 px | Idem |
| Dashboard | "Detalhes" e "Perfil completo" com 18 px | Idem |
| Evolução | Resumo "Como o perfil é calculado" com 20 px | Idem, mantendo o marcador de expandir |
| Configurações | Caixa de seleção com 13×13 px | Rótulo com 44 px de altura (o rótulo inteiro é clicável) e caixa com 20×20 px |

Orientação e coordenadas do tabuleiro: a orientação segue o lado da abertura (pretas embaixo nas defesas). As coordenadas continuam ligadas e são legíveis a 360 px. Nenhuma tela tem rolagem horizontal da página em nenhuma das larguras.

### Limitações que permanecem

- A tabela de partidas rola horizontalmente dentro do próprio contêiner no celular (limitação já documentada).
- Os lances curtos da linha em Aberturas (por exemplo "e5") têm 35–42 px de largura e 44 px de altura.
- Nos links de texto, a área de toque ampliada pode avançar alguns pixels sobre o título vizinho, que não é interativo.
- A medição usa Chromium com emulação. Teclado virtual, barra de endereço que encolhe, área segura de notch, precisão real do dedo, desempenho do Stockfish em CPU móvel e Safari/iOS **não foram testados**.

## 4. Testes

Tudo executado localmente no estado final do working tree (Windows, Node 24, Chromium do Playwright).

| Verificação | Resultado | Quantidade | Observações |
|---|---|---|---|
| Typecheck (`npm run typecheck`) | Passou | — | 0 erros |
| Vitest (`npm test`) | Passou | 239 testes, 15 arquivos | Eram 234. Novos: 3 de deduplicação e 2 de `newId` |
| Stockfish real (`npm run test:engine`) | Passou | 21 | Executado sozinho e também dentro da suíte completa (por causa da dependência do estado de hash) |
| Build (`npm run build`) | Passou | — | |
| Playwright E2E (`CI=1 npm run test:e2e`) | Passou | 28 | Eram 22. Novos: 5 em `e2e/mobile.spec.ts` e 1 de falha ao salvar exercício em `e2e/mvp.spec.ts` |
| Responsividade (medição) | Passou | 4 viewports × 8 telas | Sem rolagem horizontal. Os alvos abaixo de 44 px que restam estão listados na seção 3 |
| Origem HTTP na rede local (`http://192.168.0.4:4180`, não seguro) | Passou | 1 fluxo | Importar → analisar → gerar exercício, sem erro no console. Com o código antigo, a importação falhou. Teste manual, não versionado |

Cada correção teve o teste escrito antes, e cada um falhou pelo motivo esperado antes de passar. A exceção são as asserções da lista de lances da análise e dos links "voltar", adicionadas junto com a correção. Para essas, a medição "antes" (29 px e 20 px) está na seção 3.

## 5. Revisão do PR

O diff completo de `main...HEAD` (11 commits) e o working tree desta rodada foram revisados, também por um agente revisor independente. Não foi encontrado nenhum problema crítico ou alto. Os dois médios (D3 e o marcador do `<summary>`) e um baixo (M3) foram corrigidos nesta rodada.

**Arquivos desta rodada** (13 modificados e 3 novos):

- **Dados**: `src/db/trainingRepo.ts`, `src/utils/hash.ts`.
- **Interface**: `src/features/openings/OpeningsPage.tsx`, `src/features/analysis/ExplanationPanel.tsx`, e uma classe nova em `AnalysisPage.tsx`, `ExerciseSolver.tsx` e `ProgressPage.tsx`.
- **Estilos**: `global.css`, `components.css`, `layout.css`, `features.css`.
- **Testes**: `tests/persistence.test.ts`, `tests/hash.test.ts` (novo), `e2e/mobile.spec.ts` (novo), `e2e/mvp.spec.ts`.
- **Docs**: este relatório (novo) e uma nota de atualização em `docs/SPRINT3.1-VALIDACAO.md`.

**Verificado**:

- **Arquivos indevidos**: nenhum. Os scripts de medição e de captura de tela ficaram fora do repositório. `test-results/` e `dist/` estão no `.gitignore`. `.claude/launch.json` (configuração local do servidor de desenvolvimento) continua fora do versionamento e não deve ser incluído no commit.
- **Código de depuração**: nenhum `console.*` ou `debugger` nos arquivos alterados.
- **Privacidade (local-first)**: nenhuma requisição externa no código, e o E2E principal confirma isso. Não foi adicionado backend, login, analytics nem dependência. O Stockfish e a sua configuração não mudaram.
- **Dados antigos**: o esquema continua na v2, os ids continuam no formato UUID v4 e o formato do backup não mudou.
- **Desktop**: com mouse, os tamanhos e o layout de três colunas de Aberturas se mantêm, com teste E2E e capturas a 1440 e a 1100 px.
- **Workflow do GitHub Actions** (`.github/workflows/ci.yml`): sem alteração. Continua executando `npm ci`, a checagem dos arquivos WASM, o typecheck, o Vitest (com o Stockfish real), o build, a instalação do Chromium e o E2E. Os testes novos entram automaticamente, porque são arquivos novos em `tests/` e `e2e/`.

**Riscos identificados**:

- Alguns testes de `e2e/mobile.spec.ts` fixam valores de layout: 34×34 px no desktop, 60% do tabuleiro visível e a abertura na posição 3 da lista. Uma mudança visual legítima pode exigir ajustá-los.
- O Git avisa sobre conversão LF→CRLF no working tree. Isso é configuração local (`core.autocrlf`), não muda o conteúdo versionado e já acontecia antes.

**Pendências para aprovação**:

- ~~Commit e push desta rodada, e CI verde no novo commit.~~ Concluído: o commit `b38830e` foi enviado e o CI passou nele (veja "Situação atual").
- Proteção de branch: a `main` **não tem proteção nem rulesets** (a API do GitHub responde "Branch not protected"). O check `verify` passa, mas **não é obrigatório** para o merge. A configuração não foi alterada.
- O teste em aparelho físico (seção 6).

## 6. Validação manual em celular físico

### Como abrir o app no celular (rede local, sem serviços externos)

1. O computador e o celular devem estar na **mesma rede Wi-Fi**.
2. No computador, gerar o build e servi-lo para a rede:
   ```bash
   npm run build
   ```
   ```bash
   npm run preview -- --host
   ```
   O Vite mostra o endereço da rede, por exemplo `Network: http://192.168.0.4:4173/`. Para conferir o IP no Windows, use `ipconfig` (campo "Endereço IPv4").
3. Se o Firewall do Windows perguntar, permita o Node **apenas em redes privadas**.
4. No celular, abra esse endereço no navegador: Chrome no Android e, se possível, Safari no iOS.
5. Ao terminar, pare o servidor com `Ctrl+C`.

Observações sobre esse modo:

- O endereço `http://<IP>` não é um contexto seguro. Esta rodada corrigiu a geração de ids, que era o único ponto que quebrava (D2). O botão "Solicitar armazenamento persistente" não tem efeito nesse modo, porque a API exige HTTPS.
- Os dados ficam no navegador do celular, nessa origem, separados dos dados do computador. O app começa vazio.
- Opcional: usar `npm run dev -- --host` (porta 5173) para ver alterações ao vivo. O build de preview é mais fiel ao uso real.

### Roteiro (cerca de 15 minutos)

Anote aparelho, sistema, navegador e versão. Em cada passo, marque OK ou descreva o problema, com captura de tela.

| # | Passo | O que conferir |
|---|---|---|
| 1 | Abrir o endereço no celular | O dashboard carrega, sem rolagem horizontal e sem a barra superior esticada |
| 2 | Tocar em cada ícone da barra (Dashboard, Partidas, Treinar, Aberturas, Evolução, Configurações) | Todos respondem ao primeiro toque, sem acertar o vizinho, e o ícone ativo fica destacado |
| 3 | Em Configurações, escrever seu nome em "Seus nomes nos arquivos PGN". Em Partidas, importar um `.pgn` (pelo seletor de arquivos do celular) | Aparece "1 importada(s)" e a partida entra na lista |
| 4 | Abrir a partida, tocar em "Rápida" e esperar a análise | A barra de progresso avança, e em "Análise concluída" a lista de lances mostra as classificações. Anote o tempo (Stockfish em CPU móvel) |
| 5 | Tocar em um erro na lista de lances | A explicação aparece. "Criar exercício desta posição" responde, ou o exercício já foi criado automaticamente |
| 6 | Em Treinar, abrir o exercício e resolvê-lo **tocando** na peça e na casa de destino (e também arrastando) | Destaque da peça, lances possíveis, mensagem "correto" ou de erro, e a dica funciona |
| 7 | Em Aberturas: o tabuleiro aparece logo no topo. Tocar em ‹ e › e nos lances da linha. Trocar de variante. Escolher outra abertura na biblioteca, no fim da página | O tabuleiro cabe na tela sem cortes e as coordenadas são legíveis. Ao escolher na biblioteca, a tela volta ao tabuleiro. "Praticar" funciona tocando |
| 8 | Conferir alvos pequenos: "Detalhes" no dashboard, "← Partidas" na análise, "Como o perfil é calculado" em Evolução, a caixa "Mostrar coordenadas" em Configurações | Cada um responde a um toque normal, sem precisar de precisão |
| 9 | Recarregar a página (puxar para baixo ou recarregar no menu) | Partida, análise, exercício e tentativa continuam lá |
| 10 | Mudar para outro app por cerca de 1 minuto e voltar. Bloquear e desbloquear a tela no meio de uma análise | O app continua no mesmo ponto, sem tela branca. Se a análise parou, "Retomar" continua de onde estava |
| 11 | Girar o celular para a horizontal e voltar | O layout se ajusta, sem rolagem horizontal |
| 12 | Durante todo o roteiro | Sem textos cortados ou sobrepostos, sem travamentos, e o teclado virtual não cobre o campo em edição |

### O que foi automatizado e o que falta

- **Automatizado** (Chromium com emulação de toque):
  - os passos 1 a 9 na forma dos E2E existentes e dos novos, incluindo resolver por toque, recarregar e conferir a persistência;
  - as medições de alvos de toque e de rolagem horizontal;
  - o fluxo importar → analisar → gerar exercício por uma origem HTTP da rede local.
- **Depende de validação manual**:
  - a precisão real do toque e o arrastar no aparelho;
  - o desempenho e o aquecimento do Stockfish WASM em CPU móvel;
  - o comportamento ao sair do app e voltar (passo 10);
  - o teclado virtual, a barra de endereço dinâmica e a área segura de notch;
  - a rotação;
  - **Safari/iOS**, que nunca foi testado: o CI e a auditoria usam só o Chromium.

## 7. Conclusão

**Pronto com ressalvas.**

Todas as verificações automatizadas passaram e não há bloqueador conhecido. As três falhas reproduzíveis desta rodada foram corrigidas, cada uma com teste de regressão:

- a duplicação concorrente de exercícios;
- a quebra em origem HTTP da rede local;
- o botão travado após um erro ao salvar.

As ressalvas são:

1. O teste em aparelho físico (iOS incluído) ainda não foi feito. O roteiro está na seção 6.
2. O check do CI não é obrigatório para o merge, porque a `main` não tem proteção configurada.

(Uma ressalva anterior, a de que as alterações ainda não tinham sido enviadas e o CI estava pendente, foi superada: `b38830e` foi enviado e o CI passou.)
