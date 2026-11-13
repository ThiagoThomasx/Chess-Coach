# Sprint 4.6 — Preparação para integração

| Campo | Valor |
|---|---|
| Data | 2026-11-09 |
| Branch | `feat/sprint4-6-understand-mistakes` |
| HEAD | `302f7a9f4c9d202fec99e2fa455e884693a8970b`; a branch não tem commits próprios, todo o trabalho está no working tree |
| `main` local / `origin/main` | `302f7a9` / `302f7a9`, conferido com `git ls-remote` (somente leitura) |
| Branch no remoto | não existe |

Esta etapa só preparou a integração. Não houve commit, push, PR, merge nem deploy.

## 1. Estado da branch

- A branch parte de `302f7a9`, merge do PR #8. `git merge-base HEAD main` = `302f7a9`.
- Não há commits entre `main` e `HEAD`, em nenhuma direção, nem stash.
- `origin/main` não avançou desde a criação da branch. Não há divergência nem risco de conflito com a `main` atual.
- O working tree tem 33 arquivos rastreados modificados e 22 não rastreados (21 antes desta etapa, mais este relatório). Entre os não rastreados estão `.claude/launch.json` (configuração local, fora da integração) e os relatórios. Conferi isso contra o estado registrado no fim da auditoria consolidada, e não há alteração inesperada.

## 2. Resumo do diff (contra `302f7a9`)

| Categoria | Modificados | Novos | Pertence à Sprint 4.6 |
|---|---|---|---|
| Código de produção (`src/`) | 23 | 6 | Sim: B1, PA-1, B3, FA-3, FA-4, B2 e AC-1 a AC-8 |
| Testes unitários (`tests/`) | 3 | 6 | Sim |
| Testes E2E (`e2e/`) | 4 | 3 | Sim |
| Documentação (`docs/`) | 3 | 5 + este | Sim, com uma ressalva para `BASELINE-MAIN.md` e `POST-SPRINT4-5-AUDITORIA.md` (§5) |
| Configuração (`package.json`, lock, `vite`/`playwright`/`tsconfig`, CI) | 0 | 0 | Nenhuma mudança |
| Configuração local | 0 | 1 (`.claude/launch.json`) | **Não**: arquivo do usuário, de 2026-11-07, não deve ser integrado |
| Temporários, capturas, logs | 0 | 0 | Nenhum no repositório |

Novos arquivos de produção:
- `src/services/exercises/refutation.ts` (B1);
- `src/services/analysis/progressSaver.ts` e `src/features/analysis/useLiveAnalysis.ts` (PA-1);
- `src/features/progress/GameTrend.tsx` (B3);
- `src/services/exercises/origin.ts` e `src/features/training/ExerciseOrigin.tsx` (B2).

Todos são importados por código de produção. **Um commit que deixe de fora qualquer arquivo não rastreado de `src/`, `tests/` ou `e2e/` quebra o build ou a suíte.**

Totais do diff rastreado: 33 arquivos, +857 −148 linhas. Sem considerar espaço em branco, são +825 −116. As 32 linhas que mudam só em espaço são reindentações legítimas:
- B1 envolveu o feedback numa região `role="status"`;
- B2 envolveu a lista de lances num fragmento;
- AC-3 colocou a execução da análise num `try`.

Não há reformatação acidental.

Finais de linha: `core.autocrlf=true` e o índice guarda LF. Os arquivos reescritos estão em LF no working tree, e o commit vai normalizar para LF sem ruído no diff.

## 3. Revisão do diff

| Verificação | Resultado |
|---|---|
| `console.log`, `debugger`, `.only`, `.skip`, TODO/FIXME no diff | Nenhum |
| Código morto | `listAnalyses` (`src/db/analysisRepo.ts`) ficou sem uso depois da PA-1. **Removido nesta etapa**, sem referência em código, testes ou docs. `saveAnalysis` é usada só em testes, como API do repositório para preparar dados; mantida |
| Duplicação | O `seedAnalysedGame` das specs da B2 e da auditoria foi centralizado em `e2e/helpers.ts`. As cópias locais de `put` em `clarity`/`consistency` são anteriores à sprint e ficaram como estão |
| Testes existentes | Nenhum removido ou enfraquecido. `e2e/mvp.spec.ts` (passo 8) foi adaptado à B2.2: abre o exercício quando ele já existe e mantém todas as asserções |
| Esperas fixas | `e2e/audit-sprint4-6.spec.ts` usa `waitForTimeout(500)` em duas asserções negativas ("a marcação **não** foi revisada"). Uma espera longa demais só poderia gerar falso positivo, nunca falha falsa. Aceito como LOW. As de `mvp.spec.ts` são anteriores à sprint |
| Arquivos temporários | As specs `e2e/zz-tmp-*` das auditorias foram removidas. Capturas e logs ficaram fora do repositório. `dist`, `test-results`, `playwright-report` e `coverage` estão no `.gitignore` |

## 4. Estado da documentação

Correções factuais feitas nesta etapa, sem reescrita de estilo:

| Documento | Correção |
|---|---|
| `SPRINT4-6-AUDITORIA-CONSOLIDADA.md` | O resumo dizia "8 achados médios e 4 baixos". A tabela tem **7 médios** (AC-1, 2, 3, 5, 6, 7, 8) e **5 baixos** (AC-4, 9, 10, 11, 12). Corrigido |
| `SPRINT4-6-PLANEJAMENTO.md` | "Nada desta proposta foi implementado" contradizia a tabela de situação. Agora diz que é a proposta original e remete à tabela. A contagem de achados médios foi corrigida para 7 |
| `SPRINT4-6-PA1-B3-RELATORIO.md` | "B2 não foi implementado" passou a dizer "nesta etapa", com remissão ao relatório da B2. As contagens de teste estão identificadas como as da etapa |
| `SPRINT4-6-B2-RELATORIO.md` | R6 (marcação revisada pela navegação) e R7 (SAN longo não medido) estão marcados como resolvidos depois, pelo AC-2 e pela medição da auditoria |

Conferido sem contradição com o código:
- `METHODOLOGY.md`: B2 e AC-2, regra de material da B1 (AC-7), B3 sem data (AC-5), o que o indicador mede, datas (FA-3);
- `ARCHITECTURE.md`: fluxo de gravação com `saveAnalysisIfGameExists`, B2;
- os achados AC-1 a AC-12 e os débitos estão registrados na auditoria consolidada.

As contagens de testes nos relatórios de etapa (454, 469, 476) são históricas; as finais estão em §6.

## 5. Arquivos que exigem atenção

| Arquivo | Situação | Recomendação |
|---|---|---|
| `.claude/launch.json` | Não rastreado; configuração local do usuário, anterior à sprint | **Não integrar** e não modificar |
| `docs/BASELINE-MAIN.md` | Modificado na auditoria pós-Sprint 4.5 (2026-11-08), antes da implementação. Descreve a `main` em `302f7a9` | Integrar. Fica mais claro num commit de documentação separado, antes do código da sprint |
| `docs/POST-SPRINT4-5-AUDITORIA.md` | Não rastreado; é a auditoria que originou o escopo da Sprint 4.6 | Integrar junto com `BASELINE-MAIN.md` |

## 6. Resultados dos testes

Execução final, depois de todas as correções desta etapa:

| Suíte | Resultado | Baseline da auditoria |
|---|---|---|
| Typecheck | Aprovado | Aprovado |
| Vitest | **476/476** (30 arquivos) | 476/476 |
| Stockfish real (`npm run test:engine`) | **24/24** | 24/24 |
| Build de produção | Aprovado | Aprovado |
| Playwright completo | **84/84** | 84/84 |
| Cobertura (services + db) | linhas **94,70%**, statements 91,56%, branches 84,21%, funções 89,49% | linhas 94,66% |

- Nenhuma falha e nenhuma instabilidade nesta execução.
- Depois da correção do teste de medição (§7), rodei de novo o arquivo 3 vezes e o Vitest completo: 476/476.
- A instabilidade única registrada na auditoria consolidada (§9 dela) não se repetiu.

## 7. Revisão independente

Uma revisão final separada, somente leitura, sem rodar as suítes, cobriu:
- mudanças fora do escopo;
- arquivos não rastreados indispensáveis;
- a integração entre as últimas correções;
- testes frágeis;
- documentação contra o código.

**Resultado: nada bloqueante (nenhum CRITICAL ou HIGH).**

| Achado | Severidade | Tratamento |
|---|---|---|
| `tests/pa1-measurement.test.ts`: a linha de base das releituras era tirada após uma espera fixa de 50 ms; num runner lento, a execução inicial contaria como releitura | MEDIUM-LOW | **Corrigido**: espera a primeira emissão de cada consulta |
| `docs/BASELINE-MAIN.md` pertence à auditoria pós-Sprint 4.5 | LOW | Mantido; commit de documentação separado recomendado (§5, §11) |
| `.claude/launch.json` não rastreado | LOW | Fora da integração |
| `tests/analysis-progress.test.ts:154` espera fixa de 30 ms | LOW | Débito (§8): baixo risco, o teste já passa com margem |
| `e2e/audit-sprint4-6.spec.ts` esperas de 500 ms em asserções negativas | LOW | Débito (§8) |

Os seis arquivos novos de `src/` são todos importados por código de produção. Os testes e specs novos são autocontidos. Datas nos testes estão congeladas (`setSystemTime`) ou fixas e relativas, então nenhum teste vence com o calendário. A documentação não contradiz o código.

## 8. Débitos técnicos conhecidos

| Débito | Impacto | Impede a integração? |
|---|---|---|
| AC-10: data PGN reconhecida pela meia-noite UTC exata | Probabilidade desprezível (≈ 1 em 86 milhões); a correção exige mudança de schema | Não |
| AC-11: B3 sem teste estatístico; partidas curtas e longas pesam igual | Uma tendência pode refletir poucos erros; o texto e os avisos deixam isso claro | Não |
| B3 não mede força enxadrística | Documentado em METHODOLOGY | Não |
| Resumo da origem (B2) não repete a explicação completa | A explicação fica a um clique | Não |
| Duas abas analisando a mesma partida ao mesmo tempo | A última gravação vence; os dois registros são completos | Não |
| Falha de gravação persistente (disco cheio) | O estado `error` pode não ser gravado; o registro preso em `running` vira `paused` na próxima abertura | Não |
| Esperas fixas em duas asserções negativas do E2E da auditoria e de 30 ms em `tests/analysis-progress.test.ts` | Risco de falso positivo, ou de instabilidade rara num runner muito lento | Não |

## 9. Riscos de conflito

Nenhum com a `main` atual: `origin/main` = base = `302f7a9`. Se a `main` avançar antes da integração, os arquivos com mais chance de conflito são:
- `src/services/analysis/analysisRunner.ts`;
- `src/services/stats/stats.ts`;
- `src/styles/components.css`;
- `docs/METHODOLOGY.md`.

## 10. Veredito

**PRONTA COM RESSALVAS para integração.**

- O working tree está coerente com o escopo da Sprint 4.6 e da sua auditoria.
- A `main` remota não avançou, então não há conflito.
- As suítes completas conferem com o baseline.
- Não há achado CRITICAL, HIGH ou MEDIUM pendente.

As ressalvas não impedem a integração:
1. `.claude/launch.json` deve ficar fora do commit.
2. Os dois documentos da auditoria pós-Sprint 4.5 devem entrar, de preferência num commit de documentação separado.
3. Os débitos LOW de §8 continuam aceitos e documentados.

## 11. Procedimento recomendado (não executado)

1. Conferir de novo `git ls-remote origin refs/heads/main` (deve ser `302f7a9`).
2. Na branch `feat/sprint4-6-understand-mistakes`, preparar dois commits, sem `.claude/`:
   - `docs: record post-Sprint-4.5 audit and main baseline`: `docs/BASELINE-MAIN.md`, `docs/POST-SPRINT4-5-AUDITORIA.md`;
   - `feat: Sprint 4.6 — understand mistakes (B1, PA-1, B3, B2, FA-3, FA-4) and audit fixes`: todo `src/`, `tests/`, `e2e/` e os demais `docs/` (relatórios, planejamento, METHODOLOGY, ARCHITECTURE). Adicionar os arquivos por caminho explícito, nunca `git add -A`, que pegaria `.claude/`.
3. Antes de commitar, confirmar com `git status --short` que só `.claude/` ficou fora.
4. Push com `-u` e PR para `main` com o resumo dos relatórios e o plano de testes.
5. Esperar o check `verify` da CI e integrar por **merge commit** (sem squash nem rebase, como nos PRs anteriores).
6. Depois do merge, validar a `main` (typecheck, Vitest, motor real, build, Playwright) e atualizar `BASELINE-MAIN.md` numa etapa posterior.
