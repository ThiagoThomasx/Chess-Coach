# ChessQuest — Sprint 3.1: validação final e CI

Data: 2026-11-03 · Branch `fix/sprint3-phase1` (PR #1). Sem merge e sem auto-merge.

## 1. Integração contínua

O workflow [.github/workflows/ci.yml](../.github/workflows/ci.yml) roda em todo pull request e em todo push na `main`. Pushes em outros branches não disparam o workflow, para que um mesmo commit de PR não rode duas vezes. Os passos, em um único job em `ubuntu-latest` com Node 24:

1. `npm ci`, com o cache de npm do `actions/setup-node`. O `postinstall` copia o Stockfish WASM para `public/engine`.
2. Confere se `stockfish-19-lite-single.js` e `.wasm` existem e não estão vazios. Assim, uma falha na cópia do motor aparece com uma mensagem clara, e não como erro nos testes.
3. `npm run typecheck`.
4. `npm test` (Vitest), incluindo os testes com o Stockfish real em processo filho.
5. `npm run build`.
6. Playwright Chromium. Os navegadores ficam em cache por versão do Playwright, e em caso de acerto do cache só as dependências do sistema são instaladas.
7. `npm run test:e2e`. Com `CI` definido, o `playwright.config.ts` serve o build do passo 5 em vez de gerar outro e não reaproveita servidores já abertos.
8. Se algo falhar, os traces do Playwright (`test-results/`) são anexados por 7 dias.

O workflow usa apenas ações oficiais do GitHub (`checkout`, `setup-node`, `cache`, `upload-artifact`), sem serviços externos, e a permissão é somente de leitura (`contents: read`).

## 2. Deduplicação de exercícios: diagnóstico

**Implementação atual** (`src/db/trainingRepo.ts`, `addExercise`): `db.exercises.filter((e) => fenKey(e.fen) === key).first()`. Isso varre a tabela e desserializa cada exercício até achar a posição: **O(n)** por inserção, e n inteiro quando a posição é nova, que é o caso comum. `deriveFromAnalysis` lê também a tabela inteira uma vez por partida (`listExercises`) e chama `addExercise` até `maxExercisesPerGame` vezes (4 por padrão, até 15).

**Medição** no IndexedDB real do Chromium (Playwright), com exercícios de cerca de 2,4 KB cada (árvore de solução, 3 linhas de referência e textos). Os valores são a mediana de 5 execuções. O script de benchmark não está versionado.

| Exercícios | Varredura, posição nova | Varredura, posição existente (meio da tabela) | `listExercises` (tabela inteira) | Consulta por índice |
|---:|---:|---:|---:|---:|
| 1.000 | 26 ms | 13 ms | 25 ms | 0,3 ms |
| 5.000 | 109 ms | 36 ms | 99 ms | 0,3 ms |
| 10.000 | 203 ms | 91 ms | 186 ms | 0,2 ms |

**Impacto**: por partida analisada, o custo é uma leitura completa mais até 4 varreduras. Isso dá cerca de 0,12 s com 1.000 exercícios, 0,5 s com 5.000 e 1,0 s com 10.000. A mesma etapa constrói a árvore de solução de cada exercício com o Stockfish, o que leva segundos por exercício, e a análise da partida leva dezenas de segundos. Mesmo com 10.000 exercícios (cerca de 2.500 partidas no padrão de 4 por partida), a deduplicação fica abaixo de 5% do tempo da etapa, e a varredura roda fora da thread da interface. **Otimizar agora seria prematuro.** Exercícios reais com árvores maiores podem aumentar esses tempos de forma proporcional.

**Índice que resolveria**: um campo `posKey = fenKey(fen)` indexado em `exercises`. Ele exige o esquema v3, com uma função de upgrade que preencha o campo nas linhas existentes e a atualização de `buildExercise`/`addExercise` e do backup. Com o índice, a consulta cai para cerca de 0,3 ms em qualquer tamanho. O índice deve ser **não único**: um índice único (`&posKey`) faria um backup antigo com duplicatas falhar no upgrade ou na restauração.

**Risco de duplicatas concorrentes: confirmado.** A checagem e a inserção não ficam numa transação. Duas chamadas simultâneas para a mesma posição, com contadores de lance diferentes, gravaram **2** exercícios. Envolvendo as duas operações numa transação `rw` em `exercises`, a segunda chamada viu a primeira e gravou **1**. Na prática, isso acontece quando o botão "Criar exercício desta posição" coincide com a geração automática da mesma partida, ou quando duas abas analisam a mesma partida. As duplicatas não corrompem dados, mas repetem o exercício e contam em dobro no perfil.

**Proposta, em ordem e ainda não aplicada:**

1. Envolver a checagem e o `add` em `db.transaction('rw', db.exercises, …)`. A correção é de uma linha, não muda o esquema e fecha a corrida tanto na mesma aba quanto entre abas, porque o IndexedDB serializa transações de escrita no mesmo store.
2. Junto com a migração v3 já prevista (reclassificar exercícios antigos), adicionar o índice `posKey` não único e trocar a varredura por `where('posKey').equals(key).first()`.
3. Trocar `listExercises()` em `deriveFromAnalysis` por consultas pontuais pelo índice.

## 3. Responsividade

Auditoria automatizada com Playwright no build de produção: emulação mobile com toque, user agent Android, dados reais (uma partida importada e analisada pelo Stockfish e o exercício gerado a partir dela). Larguras de 360, 390 e 430 px e tablets de 768×1024 e 1024×1366. Telas: dashboard, partidas, análise, treinar, exercício, aberturas, evolução e configurações.

| Verificação | Resultado |
|---|---|
| Rolagem horizontal da página | Nenhuma, em todas as telas e larguras |
| Elementos para fora da tela | Nenhum |
| Navegação | 6 de 6 links visíveis e com nome acessível. Abaixo de 860 px, barra fixa no topo só com ícones |
| Tabuleiro | Cabe na largura: 296 px (análise) e 328 px (exercício) a 360 px; 730 px no exercício a 768 px |
| Resolver um exercício **tocando** nas casas | Funcionou nas 5 larguras ("correto!") |
| Gráficos (avaliação, desempenho, evolução) | Ajustam-se ao contêiner, sem corte |
| Modais e menus | O app não tem modais próprios. As confirmações usam o `confirm()` nativo do navegador, e o único menu recolhível é um `<details>` na Evolução, que abre normalmente |
| Erros no console | Nenhum |

**Defeito encontrado e corrigido**: abaixo de 860 px, `.shell` tem `min-height: 100%` e duas linhas automáticas no grid. Em páginas curtas, o espaço que sobra era dividido entre as duas, e a barra de navegação crescia para **87 px a 390 px e 265 px no tablet de 768 px**, uma faixa vazia no topo. A correção é `grid-template-rows: auto 1fr` (`src/styles/layout.css`). Ganhou um teste E2E, que falhou antes da correção e passa depois.

**Observações sem correção, para decisão:**

- Em Aberturas, no celular, o tabuleiro de treino fica abaixo da lista de aberturas (topo em cerca de 850 px numa tela de 800 px), e é preciso rolar para chegar a ele.
- Alvos de toque entre 28 e 29 px de altura (lances da lista, botões compactos) passam no mínimo do WCAG 2.2 AA (24 px), mas ficam abaixo dos 44 px recomendados para toque. Os links "Detalhes" e "Perfil completo" do dashboard têm 18 px de altura, e uma caixa de seleção em Configurações mede 13×13 px.
- A tabela de partidas rola horizontalmente dentro do próprio contêiner no celular (limitação já documentada).
- O tablet de 1024 px usa o layout de desktop, com barra lateral, e o tabuleiro da análise fica com 361 px.

**Esta validação não substitui o teste em aparelho físico.** A emulação não reproduz o teclado virtual, a barra de endereço que encolhe, a área segura de notch, a precisão real do dedo, o desempenho do Stockfish WASM em CPU móvel nem o Safari/iOS (a auditoria usou só o Chromium).

## 4. Revisão de integridade do PR

Os 10 commits (`92f43a1` … `380b4b1`) seguem o padrão convencional, um por fase, e cada fase tem testes de regressão. Pontos verificados:

- **Dados**: o esquema continua na v2 em todo o PR. Os campos novos (`motifSide`, `definingPly`) são opcionais, e o tema novo `unsound_forcing` é aceito pelo backup. `recordAttempt` passou a decidir dentro da transação se a tentativa é treino repetido, o que está correto e é atômico.
- **Regressões potenciais**:
  - a janela de treino repetido (10 min) é igual ao atraso de reapresentação de um erro, então um exercício reapresentado exatamente 10 min depois conta normalmente, porque a comparação usa `<`;
  - exercícios antigos mantêm a competência calculada na época, como já documentado;
  - a corrida na deduplicação existia antes do PR e não foi introduzida por ele.
- **Documentação × implementação**: as constantes, os estados e os comportamentos descritos no README, na METHODOLOGY e no relatório do Sprint 3 existem no código, conferidos um a um.
- **Cobertura dos fluxos**:
  - cobertos ponta a ponta: importar, analisar, explicar, criar e resolver exercício, recarregar, perfil, dashboard, aberturas (treino e transposição), backup, sequência de dois lances, dicas e acessibilidade;
  - sem E2E: o veredito "incerto" (coberto em unidade, com motor simulado), o filtro por competência na tela Treinar, a recomendação por competência no dashboard e a exclusão de partida ou exercício.
