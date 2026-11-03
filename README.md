# ChessQuest

Treinador pessoal de xadrez **local-first**: importa suas partidas em PGN, analisa cada lance com o Stockfish rodando no próprio navegador, explica os erros com base em fatos verificados, transforma posições relevantes em exercícios e acompanha a evolução das suas competências.

Sem login, sem backend, sem API de IA, sem analytics. Nenhum PGN, posição ou estatística sai do seu dispositivo.

## Funcionalidades

- **Partidas** — importação de arquivos `.pgn` (seletor ou arrastar-e-soltar), várias partidas por arquivo, validação de arquivos vazios/inválidos/parcialmente legíveis, detecção de duplicatas, histórico de importações, metadados preservados (jogadores, resultado, data, evento, ritmo, Elo do PGN como metadado, ECO/abertura, FEN inicial).
- **Análise** — Stockfish 19 (WASM) num Web Worker; análise rápida ou profunda, progresso, interrupção e retomada, cache de avaliações, barra e gráfico de avaliação, lista de lances em SAN, navegação por teclado, variantes exploráveis (arrastando peças ou clicando nas linhas do motor), análise sob demanda da posição exibida, marcação de posições para revisão, orientação do tabuleiro.
- **Classificação** — melhor/excelente/bom/imprecisão/erro/erro grave/inconclusivo, com regras de mate separadas e marcadores (perdeu vantagem, permitiu mate, perda de material…). Limites configuráveis.
- **Explicações** — o que aconteceu, problema, alternativa, por quê, consequência, conceito e como evitar — geradas por regras locais, sinalizando quando a explicação é limitada.
- **Exercícios** — gerados automaticamente dos seus erros (com critérios de qualidade) ou manualmente; aceitam alternativas equivalentes, validam sequências forçadas, dicas progressivas, solução demonstrada, histórico de tentativas e repetição espaçada.
- **Perfil adaptativo** — 8 competências estimadas por modelo Beta-Binomial com intervalo de credibilidade, níveis de confiança, tendência e dificuldade-alvo. Sem rating inicial.
- **Aberturas** — biblioteca inicial de 8 aberturas (linhas principais e variantes com legalidade testada), objetivos, ideias, erros comuns, treino de continuação, repertório pessoal com revisão espaçada e linhas manuais.
- **Dashboard e Evolução** — somente dados reais; "Seu próximo treino" rastreável aos lances que o justificam.
- **Configurações** — profundidades, MultiPV, limites, tolerância, intervalos de revisão, tema, tabuleiro, backup/restauração validada, limpeza seletiva, uso de armazenamento.

A metodologia completa (fórmulas e limites) está em [docs/METHODOLOGY.md](docs/METHODOLOGY.md); as decisões de arquitetura em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos

- Node.js 20+ (desenvolvido com Node 24) e npm.
- Navegador moderno com WebAssembly, Web Workers e IndexedDB (Chrome, Edge, Firefox, Safari recentes).

## Comandos

```bash
npm install            # instala dependências e copia o Stockfish para public/engine
npm run dev            # servidor de desenvolvimento em http://localhost:5173
npm run build          # verificação de tipos + build de produção em dist/
npm run preview        # serve o build de produção em http://localhost:4173
npm test               # testes unitários e de integração (Vitest), inclui o Stockfish real
npm run test:engine    # apenas os testes com o motor real
npm run coverage       # cobertura dos serviços e da camada de dados
npm run test:e2e       # testes de interface (Playwright) contra o build de produção
npm run typecheck
```

Para os testes E2E, instale o navegador do Playwright uma vez: `npx playwright install chromium`.

O build em `dist/` é estático e não carrega nada de CDNs (fontes do sistema, motor servido de `dist/engine/`). Depois de instalado, funciona sem internet; o teste E2E verifica que nenhuma requisição externa é feita.

## Estrutura

```
src/
  app/            App, rotas (HashRouter), página 404
  components/     board/ (tabuleiro, barra de avaliação), charts/, feedback/, layout/
  features/       dashboard/ games/ analysis/ training/ openings/ progress/ settings/
  services/
    chess/        reconstrução de posições, SAN/UCI/FEN, material, ataques
    pgn/          parser/validador de PGN
    engine/       UciEngine (protocolo, fila, cancelamento), transporte Web Worker
    analysis/     avaliação, classificação, orquestração da análise
    pedagogy/     detecção de conceitos + templates de explicação
    exercises/    seleção/geração e validação de exercícios
    adaptation/   evidências e perfil de competências
    scheduling/   repetição espaçada
    recommendations/, stats/, openings/, backup/
  db/             Dexie (IndexedDB): esquema versionado e repositórios
  hooks/ styles/ types/ utils/
tests/            Vitest (unitários, IndexedDB simulado, motor real)
e2e/              Playwright (fluxo completo do MVP)
docs/             metodologia e arquitetura
scripts/          copy-engine.mjs (pós-instalação)
```

## Dados e backup

- Os dados ficam no **IndexedDB do navegador**, banco `chessquest`, por origem (ex.: `http://localhost:5173` e `http://localhost:4173` têm bancos separados). Limpar os dados do site no navegador apaga o histórico.
- **Backup**: Configurações → Dados locais → *Exportar backup* gera `chessquest-backup-AAAA-MM-DD.json` com todas as tabelas.
- **Restauração**: *Restaurar backup* valida formato, versão do esquema, chaves e FENs **antes** de alterar qualquer registro; a restauração ocorre numa única transação (tudo ou nada). Backups inválidos são recusados sem tocar no histórico.
- *Solicitar armazenamento persistente* pede ao navegador para não descartar os dados quando houver pouco espaço.

## Licenças

- Stockfish.js (pacote `stockfish`, GPL-3.0) é executado como arquivo separado (`public/engine/`, cópia da licença em `STOCKFISH-LICENSE.txt`). Uso pessoal não tem restrição; se você **distribuir** o aplicativo, cumpra a GPL-3.0 (fornecer o código-fonte correspondente).
- Demais dependências: React, react-router, Recharts, react-chessboard, lucide-react (MIT/ISC), chess.js (BSD-2), Dexie e dexie-react-hooks (Apache-2.0).
- A biblioteca de aberturas foi escrita para este projeto: sequências de lances de linhas principais conhecidas (fatos, sem texto de terceiros) e descrições gerais próprias.

## Limitações conhecidas

- Motor *lite* (rede neural menor): muito mais forte que humanos, mas mais fraco que o Stockfish completo; avaliações em profundidade baixa podem variar entre execuções.
- Detecção de conceitos é geométrica (não considera cravadas); por isso só se afirma perda de material confirmada pela linha do motor, e o resto vira explicação "limitada".
- Promoção no tabuleiro é sempre para dama.
- Sequências de exercício: se o usuário escolher uma alternativa aceita no 1º lance, o exercício termina ali (não se calcula a continuação dessa alternativa).
- A detecção de fase (abertura/meio-jogo/final) é heurística por material e número do lance.
- Se o mesmo PGN for importado com cabeçalhos diferentes, não é considerado duplicata.
- Partidas contra o computador não fazem parte deste MVP (a arquitetura do `UciEngine` permite adicioná-las).
- Sem lint configurado (ESLint); a qualidade é verificada por TypeScript estrito e testes.

## Pendências sugeridas

Partidas contra o motor; importação de comentários/variantes do PGN como anotações; base teórica de aberturas maior (com fonte licenciada); tablebases para finais; exercícios com continuação calculada para alternativas; seleção de peça na promoção.
