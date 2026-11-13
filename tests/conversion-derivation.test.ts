import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { getGame, importPgn, setUserColor } from '../src/db/gamesRepo';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { startAnalysis } from '../src/services/analysis/analysisRunner';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import { positionsOf } from '../src/services/chess/position';
import type { Game } from '../src/types/domain';
import { SHORT_BLUNDER_GAME } from './fixtures';

// Sprint 4.7, PD-2 (closing review M2): the automatic derivation never builds a conversion from a move
// that kept the decisive advantage, and still builds it when the advantage was given away.

/**
 * Deterministic engine for SHORT_BLUNDER_GAME (1.e4 e5 2.Nf3 Nc6 3.Nd4 exd4): every position is equal
 * except the one before 3.Nd4 (+12, best 3.Bc4) and the one after it (`afterNd4`), with quiet lines only,
 * so 3.Nd4 is a positional loss in a winning position: a conversion.
 */
function conversionEngine(game: Game, afterNd4: number): EngineLike {
  const fens = positionsOf(game.moves);
  const scores = new Map([[fens[4], 1200], [fens[5], afterNd4]]);
  const quiet = new Map([[fens[4], 'f1c4'], [fens[5], 'a7a6']]);
  return {
    async analyze({ fen, depth = 12, multiPv = 1 }) {
      const legal = new Chess(fen).moves({ verbose: true }).filter((m) => !m.captured);
      const first = quiet.get(fen) ?? (legal[0] ? `${legal[0].from}${legal[0].to}` : undefined);
      const score = { kind: 'cp' as const, value: scores.get(fen) ?? 0 };
      return { fen, depth, multiPv, lines: [{ multipv: 1, score, pv: first ? [first] : [], depth }], complete: true, timeMs: 1 };
    },
  };
}

const settings = { ...DEFAULT_SETTINGS, analysisDepth: 12 };
let n = 0;

async function whiteGame(): Promise<Game> {
  const r = await importPgn(SHORT_BLUNDER_GAME, 'a.pgn', []);
  const id = r.imported[0]?.id ?? '';
  await setUserColor(id, 'w');
  const g = await getGame(id);
  if (!g) throw new Error('fixture not imported');
  return g;
}

beforeEach(() => {
  setDb(new ChessQuestDB(`conversion-${++n}`));
});

describe('automatic derivation of conversions (Sprint 4.7, PD-2)', () => {
  it('+12 → +5 is an error in the analysis but derives no conversion: the move kept the decisive advantage', async () => {
    const game = await whiteGame();
    const out = await startAnalysis(game, settings, conversionEngine(game, 500));
    const nd4 = out.analysis.reviews.find((r) => r.ply === 5);
    expect(nd4?.classification).toBe('mistake'); // the technical error stays
    expect(nd4?.winAfter).toBeGreaterThanOrEqual(80);
    expect(out.derivation?.exercisesAdded).toBe(0);
    expect(await getDb().exercises.count()).toBe(0);
  });

  it('+12 → +1 gives the decisive advantage away: the same position derives a conversion', async () => {
    const game = await whiteGame();
    const out = await startAnalysis(game, settings, conversionEngine(game, 100));
    expect(out.analysis.reviews.find((r) => r.ply === 5)?.winAfter).toBeLessThan(80);
    const exercises = await getDb().exercises.toArray();
    expect(exercises).toHaveLength(1);
    expect(exercises[0]?.ply).toBe(5);
    expect(exercises[0]?.goal?.kind).toBe('conversion');
  });
});
