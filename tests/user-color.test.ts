import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { deleteGame, getGame, importPgn, setUserColor } from '../src/db/gamesRepo';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { changeUserColor, colorChangeFailureMessage, derivationMessage, reconcileDerivations, startAnalysis } from '../src/services/analysis/analysisRunner';
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
function scriptedEngine(game: Game, opts: { alsoBlunder2Nf3?: boolean } = {}): EngineLike {
  const fens = positionsOf(game.moves);
  // ply 5 = after 3.Nd4 (best 3.Bc4); optionally ply 3 = after 2.Nf3 (best 2.Bc4) as a second, smaller White blunder.
  const bad = new Map([[fens[5], -300], ...(opts.alsoBlunder2Nf3 ? [[fens[3], -250] as const] : [])]);
  const best = new Map([[fens[4], 'f1c4'], ...(opts.alsoBlunder2Nf3 ? [[fens[2], 'f1c4'] as const] : [])]);
  return {
    async analyze({ fen, depth = 12, multiPv = 1 }) {
      const score = { kind: 'cp' as const, value: bad.get(fen) ?? materialBalance(fen, 'w') * 100 };
      const legal = new Chess(fen).moves({ verbose: true });
      const first = best.get(fen) ?? (legal[0] ? `${legal[0].from}${legal[0].to}` : undefined);
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

  it('switching sides replaces the game evidence and removes the never-attempted exercises of the old side (decision D3)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await changeUserColor(game.id, 'w', settings);
    expect(await getDb().exercises.count()).toBe(1);

    const d = await changeUserColor(game.id, 'b', settings);
    expect(d).toEqual({ hasUserColor: true, exercisesAdded: 0, exercisesRemoved: 1 });
    expect(derivationMessage(d, 'Cor salva.')).toBe('Cor salva. Perfil atualizado; nenhum exercício novo. 1 exercício(s) nunca tentado(s) do outro lado foram removidos.');
    const events = await gameEvents(game.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => (e.ref.ply ?? 1) % 2 === 0)).toBe(true); // Black moves only
    expect(await getDb().exercises.count()).toBe(0);
  });

  it('an old-side exercise already attempted is kept with its history when switching sides (decision D3)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await changeUserColor(game.id, 'w', settings);
    const [ex] = await getDb().exercises.toArray();
    if (!ex) throw new Error('no exercise');
    await getDb().attempts.add({ exerciseId: ex.id, at: Date.now(), correct: true, hintsUsed: 0, revealed: false, timeMs: 1, moves: [] });

    const d = await changeUserColor(game.id, 'b', settings);
    expect(d?.exercisesRemoved).toBeUndefined();
    expect((await getDb().exercises.toArray()).map((e) => e.id)).toEqual([ex.id]);
    expect(await getDb().attempts.count()).toBe(1);
  });

  it('clearing the color or setting it the first time removes no exercise (decision D3)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await changeUserColor(game.id, 'w', settings);
    await changeUserColor(game.id, undefined, settings);
    expect(await getDb().exercises.count()).toBe(1);
    await changeUserColor(game.id, 'w', settings);
    expect(await getDb().exercises.count()).toBe(1);
  });

  it('switching sides while the game has no complete analysis removes nothing silently (review M2)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await changeUserColor(game.id, 'w', settings);
    await getDb().analyses.update(game.id, { status: 'running' }); // e.g. a deeper re-analysis in progress
    expect(await changeUserColor(game.id, 'b', settings)).toBeNull();
    expect(await getDb().exercises.count()).toBe(1);
  });

  it('switching sides keeps the exercises of other games (decision D3)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await changeUserColor(game.id, 'w', settings);
    const [ex] = await getDb().exercises.toArray();
    if (!ex) throw new Error('no exercise');
    await getDb().exercises.add({ ...ex, id: 'other', gameId: 'other-game', fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1' });
    await changeUserColor(game.id, 'b', settings);
    expect((await getDb().exercises.toArray()).map((e) => e.id)).toEqual(['other']);
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

  it('a second color change waits for the derivation in progress (audit P2-3)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    // The White derivation is held inside the engine until the test releases it.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inEngine = new Promise<void>((r) => (entered = r));
    const held: EngineLike = {
      async analyze(req) {
        entered();
        await gate;
        return scriptedEngine(game).analyze(req);
      },
    };
    const finished: string[] = [];
    const first = changeUserColor(game.id, 'w', settings, () => held).then(() => finished.push('w'));
    await inEngine;
    const second = changeUserColor(game.id, 'b', settings).then(() => finished.push('b'));
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect(finished).toEqual([]); // the Black derivation is queued behind the White one
    release();
    await Promise.all([first, second]);

    expect(finished).toEqual(['w', 'b']);
    expect((await getGame(game.id))?.userColor).toBe('b');
    const events = await gameEvents(game.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => (e.ref.ply ?? 1) % 2 === 0)).toBe(true);
    expect((await getDb().analyses.get(game.id))?.derivation).toBe('done');
  });

  it('clearing the color removes only this game\'s game evidence (audit P2-2)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await changeUserColor(game.id, 'w', settings);
    const [ex] = await getDb().exercises.toArray();
    const base = { skill: 'tactics' as const, at: 1, outcome: 1, weight: 1, independent: true };
    await getDb().skillEvents.bulkAdd([
      { ...base, source: 'exercise', ref: { exerciseId: ex?.id ?? 'x', gameId: game.id, ply: 5 } },
      { ...base, source: 'opening', ref: { gameId: game.id, lineId: 'l1' } },
      { ...base, source: 'game', ref: { gameId: 'other-game', ply: 3 } },
    ]);
    const before = await getDb().skillEvents.count();
    const own = (await gameEvents(game.id)).filter((e) => e.source === 'game').length;
    expect(own).toBeGreaterThan(0);

    await changeUserColor(game.id, undefined, settings);

    const left = await getDb().skillEvents.toArray();
    expect(left).toHaveLength(before - own);
    expect(left.filter((e) => e.source === 'game' && e.ref.gameId === game.id)).toHaveLength(0);
    expect(left.map((e) => e.source).sort()).toEqual(['exercise', 'game', 'opening']);
    expect(left.find((e) => e.source === 'game')?.ref.gameId).toBe('other-game');
    expect(await getDb().exercises.count()).toBe(1); // exercises are kept
  });

  it('marks the derivation pending before the work starts and done when it matches the color (audit P2-1)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    expect((await getDb().analyses.get(game.id))?.derivation).toBe('done');
    let seen: string | undefined;
    const probe: EngineLike = {
      async analyze(req) {
        seen ??= (await getDb().analyses.get(game.id))?.derivation;
        return scriptedEngine(game).analyze(req);
      },
    };
    await changeUserColor(game.id, 'w', settings, () => probe);
    expect(seen).toBe('pending'); // a tab closed now would leave this mark behind
    expect((await getDb().analyses.get(game.id))?.derivation).toBe('done');
  });

  it('a color change interrupted before its derivation finished is completed on the next start (audit P2-1)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    // State left by a tab closed right after the color was saved.
    await setUserColor(game.id, 'w');
    await getDb().analyses.update(game.id, { derivation: 'pending' });

    expect(await reconcileDerivations(settings, () => scriptedEngine(game))).toBe(1);

    expect(await getDb().exercises.count()).toBe(1);
    const events = await gameEvents(game.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => (e.ref.ply ?? 0) % 2 === 1)).toBe(true);
    expect((await getDb().analyses.get(game.id))?.derivation).toBe('done');
    expect(await reconcileDerivations(settings)).toBe(0); // nothing left to do
  });

  it('a partially derived game is completed without exceeding the per-game exercise limit (audit P2-1)', async () => {
    const game = await importedGame();
    const engine = scriptedEngine(game, { alsoBlunder2Nf3: true });
    const one = { ...settings, maxExercisesPerGame: 1 };
    await startAnalysis(game, one, engine);
    const white = () => getDb().exercises.filter((e) => e.gameId === game.id && e.sideToMove === 'w').toArray();
    await changeUserColor(game.id, 'w', one);
    const [firstPick] = await white();
    expect(firstPick).toBeDefined();
    await changeUserColor(game.id, 'b', one);
    await changeUserColor(game.id, 'w', one); // deriving White again must not pick a new position
    await getDb().analyses.update(game.id, { derivation: 'pending' });
    await reconcileDerivations(one);
    // The never-attempted pick was removed by the switch to Black (D3) and rebuilt for the same position.
    expect((await white()).map((e) => e.fen)).toEqual([firstPick?.fen]);
  });

  it('startup reconciliation leaves finished and pre-4.3 analyses alone', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await setUserColor(game.id, 'w'); // e.g. training data cleared on purpose: not regenerated
    expect(await reconcileDerivations(settings)).toBe(0);
    const legacy = await getDb().analyses.get(game.id);
    if (!legacy) throw new Error('analysis missing');
    const { derivation: _drop, ...old } = legacy;
    await getDb().analyses.put(old);
    expect(await reconcileDerivations(settings)).toBe(0);
    expect(await getDb().exercises.count()).toBe(0);
  });

  it('a game whose derivation fails does not block the reconciliation of the others', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await setUserColor(game.id, 'w');
    await getDb().analyses.update(game.id, { derivation: 'pending' });
    const analysis = await getDb().analyses.get(game.id);
    if (!analysis) throw new Error('analysis missing');
    // A corrupt pending analysis that sorts before the good one makes its derivation throw.
    await getDb().games.put({ ...game, id: '0-broken', hash: 'broken', userColor: 'w' });
    await getDb().analyses.put({ ...analysis, gameId: '0-broken', reviews: undefined as never, positions: undefined as never });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await reconcileDerivations(settings)).toBe(1);

    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    expect((await getDb().analyses.get(game.id))?.derivation).toBe('done');
    expect((await getDb().analyses.get('0-broken'))?.derivation).toBe('pending'); // retried on the next start
    expect(await getDb().exercises.where('gameId').equals(game.id).count()).toBe(1);
  });

  it('a game another run already finished is not derived again', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await setUserColor(game.id, 'w');
    await getDb().analyses.update(game.id, { derivation: 'pending' });
    let calls = 0;
    const counting: EngineLike = {
      async analyze(req) {
        calls++;
        return scriptedEngine(game).analyze(req);
      },
    };
    // Two startups at once (StrictMode double effect, or two tabs).
    const [a, b] = await Promise.all([reconcileDerivations(settings, () => counting), reconcileDerivations(settings, () => counting)]);
    expect(a + b).toBe(1);
    const once = calls;
    await getDb().analyses.update(game.id, { derivation: 'pending' });
    await getDb().exercises.clear();
    calls = 0;
    await reconcileDerivations(settings, () => counting);
    expect(once).toBe(calls);
  });

  it('a running analysis is not reconciled (it derives when it completes)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    await getDb().analyses.update(game.id, { derivation: 'pending', status: 'running' });
    expect(await reconcileDerivations(settings)).toBe(0);
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

  it('a derivation that fails after the color is saved keeps the color and leaves the work pending (audit P3-1)', async () => {
    const game = await importedGame();
    await startAnalysis(game, settings, scriptedEngine(game));
    const analysis = await getDb().analyses.get(game.id);
    if (!analysis) throw new Error('analysis missing');
    await getDb().analyses.put({ ...analysis, reviews: undefined as never }); // makes the derivation throw

    await expect(changeUserColor(game.id, 'w', settings)).rejects.toThrow();

    expect((await getGame(game.id))?.userColor).toBe('w');
    expect((await getDb().analyses.get(game.id))?.derivation).toBe('pending');
    expect(colorChangeFailureMessage(true, 'w')).toBe('Cor salva. Os exercícios não puderam ser gerados agora; o app tentará de novo na próxima abertura.');
  });

  it('an error seen by the quick analysis that the deeper tree search accepts creates no exercise (Sprint 4.4, O1)', async () => {
    const game = await importedGame();
    const base = scriptedEngine(game);
    const [, , , , before3Nd4, after3Nd4] = positionsOf(game.moves);
    // At the tree depth (16) 3.Nd4 is as good as 3.Bc4; the quick analysis (11) still calls it a blunder.
    const deeper: EngineLike = {
      async analyze(req) {
        const r = await base.analyze(req);
        if ((req.depth ?? 0) < 16) return r;
        const equal = { kind: 'cp' as const, value: 0 };
        if (req.fen === after3Nd4) return { ...r, lines: r.lines.map((l) => ({ ...l, score: equal })) };
        if (req.fen !== before3Nd4) return r;
        const line = (uci: string, multipv: number) => ({ multipv, score: equal, pv: [uci], depth: req.depth ?? 16 });
        return { ...r, lines: [line('f1c4', 1), line('f3d4', 2)] };
      },
    };
    const full = { ...settings, analysisDepth: 16 };
    await startAnalysis(game, full, deeper, 11);
    expect((await getDb().analyses.get(game.id))?.reviews.find((r) => r.ply === 5)?.classification).toBe('blunder');

    const d = await changeUserColor(game.id, 'w', full, () => deeper);
    expect(d).toEqual({ hasUserColor: true, exercisesAdded: 0 });
    expect(await getDb().exercises.count()).toBe(0);
    expect((await getDb().analyses.get(game.id))?.derivation).toBe('done');
  });

  it('a shallower tree does not discard an error the deeper analysis found (audit A5-1)', async () => {
    const game = await importedGame();
    const [, , , , before3Nd4, after3Nd4] = positionsOf(game.moves);
    // Depth 20 (the configured analysis): 3.Nd4 is a blunder. Depth 16 (the tree cap): it looks equal.
    const engine: EngineLike = {
      async analyze({ fen, depth = 12, multiPv = 1 }) {
        const deep = depth >= 20;
        const score = { kind: 'cp' as const, value: fen === after3Nd4 && deep ? -300 : fen === after3Nd4 ? 0 : materialBalance(fen, 'w') * 100 };
        const line = (uci: string, multipv: number) => ({ multipv, score, pv: [uci], depth });
        if (fen === before3Nd4) return { fen, depth, multiPv, lines: deep ? [line('f1c4', 1)] : [line('f1c4', 1), line('f3d4', 2)], complete: true, timeMs: 1 };
        const legal = new Chess(fen).moves({ verbose: true });
        return { fen, depth, multiPv, lines: legal[0] ? [line(`${legal[0].from}${legal[0].to}`, 1)] : [], complete: true, timeMs: 1 };
      },
    };
    const deep = { ...settings, analysisDepth: 20 };
    await startAnalysis(game, deep, engine);
    expect((await getDb().analyses.get(game.id))?.reviews.find((r) => r.ply === 5)?.classification).toBe('blunder');

    const d = await changeUserColor(game.id, 'w', deep, () => engine);
    expect(d).toEqual({ hasUserColor: true, exercisesAdded: 1 });
    const [ex] = await getDb().exercises.toArray();
    expect(ex?.ply).toBe(5);
    expect(ex?.tree?.depth).toBe(16); // the tree is capped below the analysis depth
  });

  it('changing the color of an unknown game does nothing', async () => {
    expect(await changeUserColor('missing', 'w', settings)).toBeNull();
  });
});

describe('color change failure message (audit P3-1)', () => {
  it('never says the color was not saved when it was', () => {
    expect(colorChangeFailureMessage(false, 'w')).toBe('Não foi possível salvar a cor. Tente de novo.');
    expect(colorChangeFailureMessage(false, undefined)).toBe('Não foi possível salvar a cor. Tente de novo.');
    expect(colorChangeFailureMessage(true, 'b')).toMatch(/^Cor salva\. .*próxima abertura\.$/);
    expect(colorChangeFailureMessage(true, undefined)).toMatch(/^Cor removida\. .*próxima abertura\.$/);
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
