import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ChessQuestDB, getDb, setDb } from '../src/db/database';
import { getGame, importPgn } from '../src/db/gamesRepo';
import { redateGameEvidence } from '../src/db/analysisRepo';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { changeUserColor, startAnalysis } from '../src/services/analysis/analysisRunner';
import type { EngineLike } from '../src/services/analysis/gameAnalyzer';
import { estimateSkill } from '../src/services/adaptation/skills';
import { gameEvidenceTime } from '../src/services/games/gameDate';
import { positionsOf } from '../src/services/chess/position';
import { materialBalance } from '../src/services/chess/material';
import type { Game, SkillEvent } from '../src/types/domain';
import { SHORT_BLUNDER_GAME } from './fixtures';

// Sprint 4.4 (E1): game evidence is dated when the game was played, not when it was analysed.

/** Material ×100, except 3.Nd4?? which is scored as losing the knight (best 3.Bc4). */
function scriptedEngine(game: Game): EngineLike {
  const fens = positionsOf(game.moves);
  return {
    async analyze({ fen, depth = 12, multiPv = 1 }) {
      const score = { kind: 'cp' as const, value: fen === fens[5] ? -300 : materialBalance(fen, 'w') * 100 };
      const legal = new Chess(fen).moves({ verbose: true });
      const first = fen === fens[4] ? 'f1c4' : legal[0] ? `${legal[0].from}${legal[0].to}` : undefined;
      return { fen, depth, multiPv, lines: [{ multipv: 1, score, pv: first ? [first] : [], depth }], complete: true, timeMs: 1 };
    },
  };
}

const settings = { ...DEFAULT_SETTINGS, analysisDepth: 12 };
const withDate = (date: string | null) => (date === null ? SHORT_BLUNDER_GAME.replace(/\[Date "[^"]*"\]\n/, '') : SHORT_BLUNDER_GAME.replace(/\[Date "[^"]*"\]/, `[Date "${date}"]`));
let n = 0;

async function analysedWhiteGame(pgn: string): Promise<Game> {
  const r = await importPgn(pgn, 'a.pgn', []);
  const game = await getGame(r.imported[0]?.id ?? '');
  if (!game) throw new Error('fixture not imported');
  await startAnalysis(game, settings, scriptedEngine(game));
  await changeUserColor(game.id, 'w', settings);
  return (await getGame(game.id)) as Game;
}

const gameEvents = (gameId: string) => getDb().skillEvents.where('ref.gameId').equals(gameId).toArray();

beforeEach(() => {
  setDb(new ChessQuestDB(`dates-${++n}`));
});

describe('game evidence dates (Sprint 4.4, E1)', () => {
  it('uses the PGN date of the game, not the analysis time', async () => {
    const game = await analysedWhiteGame(withDate('2025.01.10'));
    const events = await gameEvents(game.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.at === Date.UTC(2025, 0, 10))).toBe(true);
  });

  it('without a reliable PGN date, uses the import time (deterministic)', async () => {
    for (const pgn of [withDate(null), withDate('????.??.??'), withDate('2099.01.01')]) {
      setDb(new ChessQuestDB(`dates-${++n}`)); // a PGN without a date and one with "????.??.??" are duplicates
      const game = await analysedWhiteGame(pgn);
      const events = await gameEvents(game.id);
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.at === game.importedAt)).toBe(true);
    }
  });

  it('re-analysing the game does not change the date of its evidence', async () => {
    const game = await analysedWhiteGame(withDate('2025.01.10'));
    const before = (await gameEvents(game.id)).map((e) => e.at);
    await getDb().analyses.delete(game.id);
    await startAnalysis(game, { ...settings, analysisDepth: 14 }, scriptedEngine(game));
    const after = (await gameEvents(game.id)).map((e) => e.at);
    expect(after.length).toBe(before.length);
    expect(after.every((t) => t === Date.UTC(2025, 0, 10))).toBe(true);
  });

  it('an old game weighs less in the profile than the same game played recently', async () => {
    const recent = await analysedWhiteGame(withDate('2026.10.01'));
    const recentEvents = await gameEvents(recent.id);
    setDb(new ChessQuestDB(`dates-${++n}`));
    const old = await analysedWhiteGame(withDate('2024.10.01'));
    const oldEvents = await gameEvents(old.id);
    const skill = recentEvents[0]?.skill;
    if (!skill) throw new Error('no evidence derived');
    const now = Date.UTC(2026, 10, 7);
    expect(estimateSkill(skill, oldEvents, now).evidence).toBeLessThan(estimateSkill(skill, recentEvents, now).evidence);
  });
});

describe('re-dating evidence stored before Sprint 4.4', () => {
  it('moves game evidence to the game date and touches nothing else', async () => {
    const game = await analysedWhiteGame(withDate('2025.01.10'));
    const analysedAt = Date.UTC(2026, 10, 1);
    const db = getDb();
    // Pre-4.4 state: game evidence dated by the analysis; plus exercise and opening evidence.
    const gameIds = (await gameEvents(game.id)).map((e) => e.id as number);
    await db.skillEvents.bulkUpdate(gameIds.map((key) => ({ key, changes: { at: analysedAt } })));
    const others: SkillEvent[] = [
      { skill: 'tactics', at: analysedAt, outcome: 1, weight: 1, independent: true, source: 'exercise', ref: { exerciseId: 'x' } },
      { skill: 'openings', at: analysedAt, outcome: 1, weight: 0.5, independent: true, source: 'opening', ref: { lineId: 'l' } },
    ];
    await db.skillEvents.bulkAdd(others);
    const exercises = await db.exercises.toArray();

    expect(await redateGameEvidence()).toBe(gameIds.length);

    expect((await gameEvents(game.id)).every((e) => e.at === Date.UTC(2025, 0, 10))).toBe(true);
    const rest = await db.skillEvents.filter((e) => e.source !== 'game').toArray();
    expect(rest.map((e) => e.at)).toEqual([analysedAt, analysedAt]);
    expect(await db.exercises.toArray()).toEqual(exercises);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const game = await analysedWhiteGame(withDate('2025.01.10'));
    const db = getDb();
    await db.skillEvents.toCollection().modify({ at: 1 });
    expect(await redateGameEvidence()).toBeGreaterThan(0);
    const snapshot = await db.skillEvents.toArray();
    expect(await redateGameEvidence()).toBe(0);
    expect(await db.skillEvents.toArray()).toEqual(snapshot);
    expect(snapshot.every((e) => e.at === gameEvidenceTime(game, 0))).toBe(true);
  });

  it('leaves evidence of a game that no longer exists alone', async () => {
    const db = getDb();
    await db.skillEvents.add({ skill: 'tactics', at: 5, outcome: 0, weight: 0.5, independent: true, source: 'game', ref: { gameId: 'gone', ply: 3 } });
    expect(await redateGameEvidence()).toBe(0);
    expect((await db.skillEvents.toArray())[0]?.at).toBe(5);
  });
});

describe('calendar day of evidence in the charts (Sprint 4.5, P3-1)', () => {
  // A zone west of Greenwich, where 00:00 UTC is still the previous local day: without it (a CI runner
  // in UTC) local and UTC days coincide and the test could not tell them apart (audit AI-4).
  const previousTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Sao_Paulo';
  });
  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it('the zone used by this test is west of Greenwich', () => {
    expect(new Date(Date.UTC(2025, 0, 10)).getDate()).toBe(9);
  });

  it('game evidence is read on its UTC calendar day; other evidence on the local day', async () => {
    const { evidenceDayKey, dayKey } = await import('../src/services/stats/stats');
    expect(evidenceDayKey({ at: Date.UTC(2025, 0, 10), source: 'game' })).toBe('2025-01-10');
    expect(evidenceDayKey({ at: Date.UTC(2025, 11, 31), source: 'game' })).toBe('2025-12-31');
    const t = Date.UTC(2025, 0, 10, 15);
    expect(evidenceDayKey({ at: t, source: 'exercise' })).toBe(dayKey(t));
  });
});
