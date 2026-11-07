import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { deleteGame, getGame, importPgn, setUserColor } from '../src/db/gamesRepo';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { changeUserColor, derivationMessage, startAnalysis } from '../src/services/analysis/analysisRunner';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import { positionsOf } from '../src/services/chess/position';
import { materialBalance } from '../src/services/chess/material';
import type { Game } from '../src/types/domain';
import { SHORT_BLUNDER_GAME } from './fixtures';

/**
 * Deterministic engine for SHORT_BLUNDER_GAME (1.e4 e5 2.Nf3 Nc6 3.Nd4?? exd4):
 * material ×100 everywhere, except that the position after 3.Nd4 is scored as
 * already losing the knight, so 3.Nd4 is a blunder with 3.Bc4 as the best move.
 */
function scriptedEngine(game: Game): EngineLike {
  const fens = positionsOf(game.moves);
  const afterBlunder = fens[5];
  const beforeBlunder = fens[4];
  return {
    async analyze({ fen, depth = 12, multiPv = 1 }) {
      const score = { kind: 'cp' as const, value: fen === afterBlunder ? -300 : materialBalance(fen, 'w') * 100 };
      const legal = new Chess(fen).moves({ verbose: true });
      const first = fen === beforeBlunder ? 'f1c4' : legal[0] ? `${legal[0].from}${legal[0].to}` : undefined;
      return { fen, depth, multiPv, lines: [{ multipv: 1, score, pv: first ? [first] : [], depth }], complete: true, timeMs: 1 };
    },
  };
}

const settings = { ...DEFAULT_SETTINGS, analysisDepth: 12 };
let n = 0;

async function importedGame(): Promise<Game> {
  const r = await importPgn(SHORT_BLUNDER_GAME, 'a.pgn', []); // no player names: color unknown
  const g = await getGame(r.imported[0]?.id ?? '');
  if (!g) throw new Error('fixture not imported');
  return g;
}

const gameEvents = (gameId: string) => getDb().skillEvents.where('ref.gameId').equals(gameId).toArray();

beforeEach(() => {
  setDb(new ChessQuestDB(`color-${++n}`));
});

describe('user color and derived training data (Sprint 4.3)', () => {
  it('an analysis completed without the user color derives nothing and says so', async () => {
    const game = await importedGame();
    expect(game.userColor).toBeUndefined();
    const out = await startAnalysis(game, settings, scriptedEngine(game));
    expect(out.analysis.status).toBe('complete');
    expect(out.derivation).toEqual({ hasUserColor: false, exercisesAdded: 0 });
    expect(await getDb().exercises.count()).toBe(0);
    expect(await gameEvents(game.id)).toHaveLength(0);
  });

  it('setting the color on an analyzed game creates its exercises and skill evidence without re-analysis', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));

    const d = await changeUserColor(game.id, 'w', settings);
    expect(d).toEqual({ hasUserColor: true, exercisesAdded: 1 });
    expect((await getGame(game.id))?.userColor).toBe('w');
    const [ex] = await getDb().exercises.toArray();
    expect(ex?.gameId).toBe(game.id);
    expect(ex?.sideToMove).toBe('w');
    const events = await gameEvents(game.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => (e.ref.ply ?? 0) % 2 === 1)).toBe(true); // White moves only
  });

  it('switching sides replaces the game evidence; exercises already created are kept', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await changeUserColor(game.id, 'w', settings);

    const d = await changeUserColor(game.id, 'b', settings);
    expect(d?.hasUserColor).toBe(true);
    const events = await gameEvents(game.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => (e.ref.ply ?? 1) % 2 === 0)).toBe(true); // Black moves only
    expect(await getDb().exercises.count()).toBe(1);
  });

  it('clearing the color removes the game evidence (it is no longer known whose moves they were)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await changeUserColor(game.id, 'w', settings);

    const d = await changeUserColor(game.id, undefined, settings);
    expect(d).toEqual({ hasUserColor: false, exercisesAdded: 0 });
    expect((await getGame(game.id))?.userColor).toBeUndefined();
    expect(await gameEvents(game.id)).toHaveLength(0);
  });

  it('on a game without a complete analysis it only saves the color', async () => {
    const game = await importedGame();
    const d = await changeUserColor(game.id, 'w', settings);
    expect(d).toBeNull();
    expect((await getGame(game.id))?.userColor).toBe('w');
    expect(await getDb().exercises.count()).toBe(0);
  });

  it('a color set while the analysis runs is the one used when it completes', async () => {
    const game = await importedGame();
    const engine = scriptedEngine(game);
    let set = false;
    const slow: EngineLike = {
      async analyze(req) {
        if (!set) {
          set = true;
          await setUserColor(game.id, 'w');
        }
        return engine.analyze(req);
      },
    };
    const out = await startAnalysis(game, settings, slow);
    expect(out.derivation).toEqual({ hasUserColor: true, exercisesAdded: 1 });
  });

  it('a color switched while exercises are being built ends with the new side only (review M1/M2)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    // Building the White exercise's solution tree calls the engine: the user switches to Black meanwhile.
    // Like the UI, the second change is a separate event: it does not block the first one's engine call.
    let second: Promise<unknown> | null = null;
    const treeEngine: EngineLike = {
      async analyze(req) {
        if (!second) {
          await setUserColor(game.id, 'b'); // the select saves at once...
          second = changeUserColor(game.id, 'b', settings); // ...and queues its own derivation
        }
        return scriptedEngine(game).analyze(req);
      },
    };
    await changeUserColor(game.id, 'w', settings, () => treeEngine);
    await second;

    expect((await getGame(game.id))?.userColor).toBe('b');
    const events = await gameEvents(game.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => (e.ref.ply ?? 1) % 2 === 0)).toBe(true); // Black only
    expect(await getDb().exercises.filter((e) => e.sideToMove === 'w').count()).toBe(0);
  });

  it('concurrent color changes are applied in order and the last one wins', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await Promise.all([changeUserColor(game.id, 'w', settings), changeUserColor(game.id, 'b', settings), changeUserColor(game.id, 'w', settings)]);
    expect((await getGame(game.id))?.userColor).toBe('w');
    const events = await gameEvents(game.id);
    expect(events.every((e) => (e.ref.ply ?? 0) % 2 === 1)).toBe(true);
  });

  it('a game deleted while its analysis runs gets no evidence or exercises (review L4)', async () => {
    const game = await importedGame();
    const engine = scriptedEngine(game);
    let calls = 0;
    const deleting: EngineLike = {
      async analyze(req) {
        if (++calls === 3) await deleteGame(game.id);
        return engine.analyze(req);
      },
    };
    const out = await startAnalysis({ ...game, userColor: 'w' }, settings, deleting);
    expect(out.derivation).toBeNull();
    expect(await gameEvents(game.id)).toHaveLength(0);
    expect(await getDb().exercises.count()).toBe(0);
  });

  it('changing the color of an unknown game does nothing', async () => {
    expect(await changeUserColor('missing', 'w', settings)).toBeNull();
  });
});

describe('derivation message', () => {
  it('tells the truth about what was generated', () => {
    expect(derivationMessage(null)).toBe('Análise concluída.');
    expect(derivationMessage({ hasUserColor: false, exercisesAdded: 0 })).toBe('Análise concluída. Defina sua cor na lista de partidas para gerar exercícios e atualizar seu perfil.');
    expect(derivationMessage({ hasUserColor: true, exercisesAdded: 0 })).toBe('Análise concluída. Perfil atualizado; nenhum exercício novo.');
    expect(derivationMessage({ hasUserColor: true, exercisesAdded: 2 })).toBe('Análise concluída. Perfil atualizado e 2 exercício(s) novo(s).');
    expect(derivationMessage({ hasUserColor: true, exercisesAdded: 1 }, 'Cor salva.')).toBe('Cor salva. Perfil atualizado e 1 exercício(s) novo(s).');
  });
});
