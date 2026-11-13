// Sprint 4.7: measures what the trainer would teach on a corpus of real games, with the real engine.
// Not part of the default suite: it runs only when CORPUS_PGN is set (npm run measure:pedagogy).
//
//   CORPUS_PGN     path of a PGN file (read locally; nothing leaves the machine)
//   CORPUS_PLAYER  player name as in the [White]/[Black] headers (case-insensitive); without it both
//                  sides of every game are measured and the report says so
//   CORPUS_DEPTH   analysis depth (default: the app default, 16)
//   CORPUS_MAX     maximum games (default 40)
//   CORPUS_OUT     optional path of a JSON file with the aggregated report (no moves, no names)
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { UciEngine } from '../../src/services/engine/UciEngine';
import { nodeTransport } from '../support/nodeEngine';
import { parsePgnText } from '../../src/services/pgn/parsePgn';
import { analyzeGame, replyLinesOf } from '../../src/services/analysis/gameAnalyzer';
import { DECISIVE_WIN_PERCENT, ERROR_CLASSES } from '../../src/services/analysis/classify';
import { explainMove } from '../../src/services/pedagogy/explain';
import { detectConcepts, skillOf } from '../../src/services/pedagogy/concepts';
import { acceptsPlayedMove, buildExercise, playedMeetsGoal, selectExercisePositions } from '../../src/services/exercises/generate';
import { completeExercise } from '../../src/services/analysis/analysisRunner';
import { GAME_SUCCESS_SKILLS } from '../../src/services/adaptation/skills';
import { DEFAULT_SETTINGS } from '../../src/db/settings';
import type { Color, Game, MoveClass } from '../../src/types/domain';

const PGN = process.env.CORPUS_PGN;
const PLAYER = process.env.CORPUS_PLAYER?.trim().toLowerCase();
const DEPTH = Number(process.env.CORPUS_DEPTH ?? DEFAULT_SETTINGS.analysisDepth);
const MAX_GAMES = Number(process.env.CORPUS_MAX ?? 40);

type Counter = Record<string, number>;
const bump = (c: Counter, k: string, n = 1) => {
  c[k] = (c[k] ?? 0) + n;
};
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');

function sidesOf(game: Game): Color[] {
  if (!PLAYER) return ['w', 'b'];
  if (game.headers.white.toLowerCase() === PLAYER) return ['w'];
  if (game.headers.black.toLowerCase() === PLAYER) return ['b'];
  return [];
}

describe.skipIf(!PGN)('pedagogical quality on a game corpus (Sprint 4.7, measurement)', () => {
  const engine = new UciEngine(nodeTransport);
  afterAll(() => engine.terminate());

  it('reports what the trainer would explain and train', async () => {
    const parsed = parsePgnText(readFileSync(PGN as string, 'utf8')).games.slice(0, MAX_GAMES);
    const settings = { ...DEFAULT_SETTINGS, analysisDepth: DEPTH };
    const r = {
      games: 0, gamesSkipped: 0, sidesMeasured: 0, userMoves: 0,
      classes: {} as Counter,
      errors: 0, verified: 0, limited: 0,
      kinds: {} as Counter, themes: {} as Counter,
      keptDecisive: 0, calculationOnly: 0,
      candidates: 0, built: 0, discardedByTree: 0, discardedByGoal: 0,
      goals: {} as Counter, ambiguous: 0, rootAccepted: 0,
    };
    for (const [i, parsedGame] of parsed.entries()) {
      const base = { ...parsedGame, id: `corpus-${i}`, importId: 'corpus', importedAt: 0 } as Game;
      const sides = sidesOf(base);
      if (sides.length === 0) {
        r.gamesSkipped++;
        continue;
      }
      const a = await analyzeGame(base, { depth: DEPTH, multiPv: settings.multiPv }, { engine, thresholds: settings.thresholds });
      expect(a.status).toBe('complete');
      r.games++;
      const replies = replyLinesOf(a);
      for (const side of sides) {
        r.sidesMeasured++;
        const game = { ...base, userColor: side };
        for (const rev of a.reviews.filter((x) => x.color === side)) {
          r.userMoves++;
          bump(r.classes, rev.classification);
          if (rev.classification !== 'mistake' && rev.classification !== 'blunder') continue;
          r.errors++;
          if (rev.winAfter >= DECISIVE_WIN_PERCENT) r.keptDecisive++;
          const e = explainMove(rev, replies[rev.ply] ?? []);
          if (e.confidence === 'verified') r.verified++;
          else r.limited++;
          bump(r.kinds, e.kind);
          if (e.theme) bump(r.themes, e.theme);
          const c = detectConcepts(rev, replies[rev.ply] ?? [])[0];
          if (c?.verified && !GAME_SUCCESS_SKILLS.includes(skillOf(c))) r.calculationOnly++;
        }
        const picks = selectExercisePositions(game, a.reviews, a.positions, { max: settings.maxExercisesPerGame, thresholds: settings.thresholds });
        r.candidates += picks.length;
        for (const rev of picks) {
          const before = a.positions[rev.ply - 1];
          if (!before) continue;
          const ex = buildExercise({ game, review: rev, before, replyLine: replies[rev.ply] ?? [], tolerance: settings.exerciseTolerance });
          if (!ex) continue;
          const full = await completeExercise(ex, settings, engine);
          if (acceptsPlayedMove(full, rev.uci, before.depth)) {
            r.discardedByTree++;
            continue;
          }
          if (playedMeetsGoal(full, rev.winAfter)) {
            r.discardedByGoal++;
            continue;
          }
          r.built++;
          bump(r.goals, full.goal?.kind ?? 'none');
          if (full.ambiguous) r.ambiguous++;
          r.rootAccepted += full.tree?.accepted.length ?? full.acceptableMoves.length;
        }
      }
    }

    const classes = (Object.keys(r.classes) as MoveClass[]).map((k) => `${k} ${r.classes[k]}`).join(' · ');
    const lines = [
      `Corpus: ${r.games} partida(s) analisada(s) na profundidade ${DEPTH}${r.gamesSkipped ? `, ${r.gamesSkipped} sem o jogador` : ''}; lados medidos: ${r.sidesMeasured}${PLAYER ? '' : ' (sem CORPUS_PLAYER: os dois lados de cada partida)'}`,
      `Lances medidos: ${r.userMoves} · ${classes}`,
      `Erros e erros graves: ${r.errors} · explicação verificada ${pct(r.verified, r.errors)} · limitada (só avaliação) ${pct(r.limited, r.errors)}`,
      `Tipos: ${JSON.stringify(r.kinds)}`,
      `Temas principais: ${JSON.stringify(r.themes)}`,
      `Erros que mantiveram vantagem decisiva (fora do B3): ${r.keptDecisive} · erros verificados só de cálculo (fora do perfil, PD-1): ${r.calculationOnly}`,
      `Exercícios: ${r.candidates} candidato(s) · ${r.built} criado(s) · descartados pela árvore ${r.discardedByTree} · pelo objetivo (PD-2) ${r.discardedByGoal}`,
      `Objetivos: ${JSON.stringify(r.goals)} · ambíguos ${pct(r.ambiguous, r.built)} · lances aceitos na raiz (média) ${r.built ? (r.rootAccepted / r.built).toFixed(2) : '—'}`,
    ];
    console.log(`\n${lines.join('\n')}\n`);
    if (process.env.CORPUS_OUT) writeFileSync(process.env.CORPUS_OUT, JSON.stringify({ depth: DEPTH, player: PLAYER ? 'set' : 'both sides', errorClasses: ERROR_CLASSES, ...r }, null, 2));
    expect(r.games).toBeGreaterThan(0);
  }, 3_600_000);
});
