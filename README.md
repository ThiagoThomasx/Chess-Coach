# ChessQuest

Treinador pessoal de xadrez **local-first**: importa suas partidas em PGN, analisa cada lance com o Stockfish rodando no próprio navegador, explica os erros com base em fatos verificados, transforma posições relevantes em exercícios e acompanha a evolução das suas competências.

Sem login, sem backend, sem API de IA, sem analytics. Nenhum PGN, posição ou estatística sai do seu dispositivo.

## Funcionalidades

- **Partidas** — importação de arquivos `.pgn` (seletor ou arrastar-e-soltar) ou de texto colado, várias partidas por arquivo, validação de arquivos vazios/inválidos/parcialmente legíveis, detecção de duplicatas, histórico de importações, metadados preservados (jogadores, resultado, data, evento, ritmo, Elo do PGN como metadado, ECO/abertura, FEN inicial). Sua cor em cada partida é detectada pelos nomes cadastrados em Configurações ou escolhida na lista; ao defini-la numa partida já analisada, os exercícios e as evidências dela são gerados na hora, sem reanalisar.
- **Análise** — Stockfish 19 (WASM) num Web Worker; análise rápida ou profunda, progresso, interrupção e retomada, cache de avaliações, barra e gráfico de avaliação, lista de lances em SAN, navegação por teclado, variantes exploráveis (arrastando peças ou clicando nas linhas do motor), análise sob demanda da posição exibida, marcação de posições para revisão, orientação do tabuleiro.
- **Classificação** — melhor/excelente/bom/imprecisão/erro/erro grave/inconclusivo, com regras de mate separadas e marcadores (perdeu vantagem, permitiu mate, perda de material…). Limites configuráveis. Selos de qualidade (★ ! ✓ ?! ? ??) na casa de destino do lance, na análise e no exercício.
- **Explicações** — o que aconteceu, qual era a ameaça do adversário, por que o lance não funcionou, melhor alternativa, o que acontece depois dela, por que é superior, conceito e como reconhecer; tipo de decisão rotulado (erro tático, posicional, estratégico, de cálculo, oportunidade perdida, lance correto ou equivalente) e tamanho proporcional à gravidade — com fatos táticos baseados em lances legais (SEE, cravadas, ataques descobertos, garfos, sobrecarga, desvio, mate em 1) e linhas do motor medidas em ponto estável; erros táticos e posicionais diferenciados; explicação "limitada" quando a causa não é verificável.
- **Exercícios** — gerados dos seus erros (com critérios de qualidade) ou manualmente: lance único, sequência forçada, mate, conversão e defesa; árvore de solução calculada pelo motor com alternativas equivalentes e respostas do adversário que são defesas reais (mate mais longo, margem em centipawns); lances fora da árvore verificados pelo motor numa busca comparável, com veredito "incerto" (sem registro) quando a diferença fica perto da tolerância; sem exercícios repetidos da mesma posição; dicas progressivas, solução demonstrada, histórico e repetição espaçada. **Sessão guiada** diária (revisões vencidas, foco recomendado e exercícios no seu nível), com retomada.
- **Perfil adaptativo** — 8 competências estimadas por modelo Beta-Binomial com intervalo de credibilidade, quatro estados (evidências insuficientes, em desenvolvimento, consolidada, precisa revisar), tendência e dificuldade-alvo. Táticas sofridas contam como identificação de ameaças, não como táticas próprias perdidas. Sem rating.
- **Aberturas** — biblioteca inicial de 8 aberturas (linhas principais e variantes com legalidade testada), objetivos, ideias, erros comuns, treino de continuação, repertório pessoal com revisão espaçada e linhas manuais; identificação da abertura das partidas por posição (aceita transposições).
- **Dashboard e Evolução** — somente dados reais: partidas analisadas, exercícios resolvidos, acerto independente, padrões de erro recorrentes (separando o motivo do jogador e o do adversário), competências agrupadas por estado e "Seu próximo treino" rastreável aos lances ou aos números que o justificam.
- **Configurações** — profundidades, MultiPV, limites, tolerância, intervalos de revisão, tema, tabuleiro, backup/restauração validada, limpeza seletiva, uso de armazenamento.

A metodologia completa (fórmulas e limites) está em [docs/METHODOLOGY.md](docs/METHODOLOGY.md); as decisões de arquitetura em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); a auditoria de precisão em [docs/AUDIT-2026-11.md](docs/AUDIT-2026-11.md); as auditorias pedagógicas em [docs/AUDITORIA-SPRINT3.md](docs/AUDITORIA-SPRINT3.md) e [docs/SPRINT3-RELATORIO.md](docs/SPRINT3-RELATORIO.md); a baseline da `main` e o procedimento de validação em [docs/BASELINE-MAIN.md](docs/BASELINE-MAIN.md); os relatórios das sprints seguintes em `docs/SPRINT*-RELATORIO.md`.

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
npm run test:e2e       # testes de interface (Playwright) contra um build novo, na porta 4176
npm run typecheck
```

Para os testes E2E, instale o navegador do Playwright uma vez: `npx playwright install chromium`. O Playwright sempre sobe o próprio servidor na porta 4176 e nunca reaproveita um existente: se a porta estiver ocupada (por exemplo, por um `vite preview` esquecido), a execução falha em vez de testar um build antigo.

Integração contínua: [.github/workflows/ci.yml](.github/workflows/ci.yml) roda `npm ci`, a verificação dos arquivos do Stockfish, typecheck, Vitest (com o motor real), build e os testes E2E em cada pull request e em cada push na `main`. No CI, o Playwright serve o build já feito em vez de gerar outro.

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
  db/             Dexie (IndexedDB): histórico de esquema (SCHEMA_VERSIONS) e repositórios
  hooks/ styles/ types/ utils/
tests/            Vitest (unitários, IndexedDB simulado, motor real)
e2e/              Playwright (fluxo completo do MVP)
docs/             metodologia e arquitetura
scripts/          copy-engine.mjs (pós-instalação)
```

## Dados e backup

- Os dados ficam no **IndexedDB do navegador**, banco `chessquest`, por origem (ex.: `http://localhost:5173` e `http://localhost:4173` têm bancos separados). Limpar os dados do site no navegador apaga o histórico.
- **Backup**: Configurações → Dados locais → *Exportar backup* gera `chessquest-backup-AAAA-MM-DD.json` com todas as tabelas.
- **Plano da sessão guiada**: fica no `localStorage`, expira no fim do dia e não entra no backup.
- **Restauração**: *Restaurar backup* valida formato, versão do esquema, chaves e FENs **antes** de alterar qualquer registro; a restauração ocorre numa única transação (tudo ou nada). Backups inválidos são recusados sem tocar no histórico.
- *Solicitar armazenamento persistente* pede ao navegador para não descartar os dados quando houver pouco espaço.

## Licenças

- Stockfish.js (pacote `stockfish`, GPL-3.0) é executado como arquivo separado (`public/engine/`, cópia da licença em `STOCKFISH-LICENSE.txt`). Uso pessoal não tem restrição; se você **distribuir** o aplicativo, cumpra a GPL-3.0 (fornecer o código-fonte correspondente).
- Demais dependências: React, react-router, Recharts, react-chessboard, lucide-react (MIT/ISC), chess.js (BSD-2), Dexie e dexie-react-hooks (Apache-2.0).
- A biblioteca de aberturas foi escrita para este projeto: sequências de lances de linhas principais conhecidas (fatos, sem texto de terceiros) e descrições gerais próprias.

## Limitações conhecidas

- Motor *lite* (rede neural menor): muito mais forte que humanos, mas mais fraco que o Stockfish completo; avaliações em profundidade baixa podem variar entre execuções.
- A troca estática (SEE) considera só a casa da troca; por isso perdas de material só são afirmadas quando a linha do motor as confirma em ponto estável. Espetos, raio-X e interferências não são detectados.
- Promoção no tabuleiro é sempre para dama.
- Exercícios e evidências gravados antes desta versão mantêm a competência calculada na época (um garfo sofrido pode continuar em "Reconhecimento de padrões"); reanalisar a partida recalcula as evidências dela.
- Árvore de solução com ramificação limitada (2 alternativas na raiz, 2 respostas do adversário, até 4 lances); outras continuações exigem o motor ao vivo — sem ele, uma alternativa não expandida encerra o exercício como resolvido, com aviso.
- A detecção de fase (abertura/meio-jogo/final) é heurística por material e número do lance.
- Se o mesmo PGN for importado com cabeçalhos diferentes, não é considerado duplicata.
- Partidas contra o computador não fazem parte deste MVP (a arquitetura do `UciEngine` permite adicioná-las).
- Sem lint configurado (ESLint); a qualidade é verificada por TypeScript estrito e testes.

## Pendências sugeridas

Partidas contra o motor; importação de comentários/variantes do PGN como anotações; base teórica de aberturas maior (com fonte licenciada); tablebases para finais; exercícios com continuação calculada para alternativas; seleção de peça na promoção.
