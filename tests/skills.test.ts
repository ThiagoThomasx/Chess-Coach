import { describe, expect, it } from 'vitest';
import { estimateSkill, estimateProfile, exerciseOutcome, eventsFromAttempt, targetDifficulty, eventsFromGame, hasPointEstimate, GAME_SUCCESS_SKILLS } from '../src/services/adaptation/skills';
import { detectConcepts, skillOf, THEME_SKILL } from '../src/services/pedagogy/concepts';
import { nextTraining, errorThemes, trainThemeHref } from '../src/services/recommendations/recommend';
import { matchesThemeFilter } from '../src/services/recommendations/themeEvidence';
import { mkExercise } from './support/training';
import { applyUci } from '../src/services/chess/position';
import { DAY_MS } from '../src/services/scheduling/srs';
import type { Exercise, MoveReview, SkillEvent, Theme } from '../src/types/domain';

const NOW = 100 * DAY_MS;
const ev = (outcome: number, i: number, over: Partial<SkillEvent> = {}): SkillEvent => ({ skill: 'tactics', at: NOW - (100 - i) * 1000, outcome, weight: 1, independent: outcome === 1, difficulty: 2, source: 'exercise', ref: {}, ...over });

describe('skill profile', () => {
  it('starts without any rating and with insufficient evidence', () => {
    const p = estimateProfile([], NOW);
    expect(p).toHaveLength(8);
    for (const s of p) {
      expect(s.level).toBeNull();
      expect(s.confidence).toBe('insufficient');
      expect(s.targetDifficulty).toBe(1);
    }
  });

  it('does not claim mastery from a few successes', () => {
    const s = estimateSkill('tactics', [ev(1, 1), ev(1, 2), ev(1, 3)], NOW);
    expect(s.confidence).toBe('initial');
    expect(s.level).toBeLessThan(0.85);
  });

  it('rises with consistent independent successes and reaches provisional mastery', () => {
    const events = Array.from({ length: 16 }, (_, i) => ev(1, i, { ref: { exerciseId: `ex${i}` }, difficulty: i % 2 ? 3 : 2 }));
    const s = estimateSkill('tactics', events, NOW);
    expect(s.level).toBeGreaterThan(0.85);
    expect(s.confidence).toBe('provisional_mastery');
    expect(s.independentRate).toBe(1);
  });

  it('easy exercises alone do not consolidate a skill (Sprint 3)', () => {
    const easy = Array.from({ length: 16 }, (_, i) => ev(1, i, { ref: { exerciseId: `ex${i}` }, difficulty: 1 }));
    expect(estimateSkill('tactics', easy, NOW).confidence).toBe('consistent');
  });

  it('a skill clearly below 50% is flagged for review, not shown as "consistent" (Sprint 3)', () => {
    // 2 of 10 right, steadily: no recent drop, not stale — but the 90% interval is entirely below 50%.
    const weak = Array.from({ length: 10 }, (_, i) => ev(i % 5 === 0 ? 1 : 0, i, { ref: { exerciseId: `ex${i}` } }));
    const s = estimateSkill('tactics', weak, NOW);
    expect(s.interval![1]).toBeLessThan(0.5);
    expect(s.confidence).toBe('needs_review');
  });

  it('falls after failures and changes in response to results', () => {
    const good = Array.from({ length: 8 }, (_, i) => ev(1, i));
    const bad = Array.from({ length: 8 }, (_, i) => ev(0, i + 8));
    const a = estimateSkill('tactics', good, NOW);
    const b = estimateSkill('tactics', [...good, ...bad], NOW);
    expect(b.level!).toBeLessThan(a.level!);
    expect(b.trend).toBe('down');
    expect(b.confidence).toBe('needs_review');
  });

  it('repeating the same exercise does not inflate the skill (audit A4)', () => {
    const same = Array.from({ length: 15 }, (_, i) => ev(1, i, { ref: { exerciseId: 'same' } }));
    const s = estimateSkill('tactics', same, NOW);
    expect(s.confidence).not.toBe('provisional_mastery');
    expect(s.evidence).toBeLessThan(4); // 1 + 1/2 + … + 1/15 ≈ 3.3
  });

  it('mastery requires independent successes on several distinct exercises', () => {
    const fewDistinct = Array.from({ length: 16 }, (_, i) => ev(1, i, { ref: { exerciseId: `ex${i % 3}` } }));
    expect(estimateSkill('tactics', fewDistinct, NOW).confidence).not.toBe('provisional_mastery');
  });

  it('older evidence weighs less than recent evidence', () => {
    const old = estimateSkill('tactics', [ev(1, 0, { at: NOW - 240 * DAY_MS, ref: { exerciseId: 'a' } })], NOW);
    const fresh = estimateSkill('tactics', [ev(1, 0, { at: NOW, ref: { exerciseId: 'a' } })], NOW);
    expect(old.evidence).toBeCloseTo(0.25, 2);
    expect(fresh.evidence).toBeCloseTo(1, 2);
  });

  it('only old evidence means no recent evidence, not a need for review (decision D-4 B)', () => {
    const old = Array.from({ length: 10 }, (_, i) => ev(1, i, { at: i }));
    const s = estimateSkill('tactics', old, NOW);
    expect(s.confidence).toBe('no_recent');
    // The historical diagnosis still says what the evidence shows: 10 successes.
    expect(s.history?.level).toBeGreaterThan(0.85);
    expect(s.history?.events).toBe(10);
  });

  it('separates independent and hint-assisted performance', () => {
    const ex = { id: 'e', skill: 'tactics', difficulty: 2, solutionLine: ['a'] } as unknown as Exercise;
    const [assisted] = eventsFromAttempt(ex, { exerciseId: 'e', at: 1, correct: true, hintsUsed: 2, revealed: false, timeMs: 90_000, moves: [] });
    expect(assisted?.independent).toBe(false);
    expect(assisted?.outcome).toBe(0.5);
    expect(exerciseOutcome({ correct: true, hintsUsed: 0, revealed: false })).toBe(1);
    expect(exerciseOutcome({ correct: true, hintsUsed: 0, revealed: true })).toBe(0);
    const s = estimateSkill('tactics', [ev(1, 1), { ...assisted!, at: NOW }], NOW);
    expect(s.assistedRate).toBe(0.5);
  });

  it('adapts the target difficulty up after success streaks and down after failures', () => {
    const ups = [ev(1, 1, { difficulty: 1 }), ev(1, 2, { difficulty: 1 }), ev(1, 3, { difficulty: 2 }), ev(1, 4, { difficulty: 2 })];
    expect(targetDifficulty(ups)).toBe(3);
    expect(targetDifficulty([...ups, ev(0, 5)])).toBe(2);
  });

  it('derives traceable evidence from analyzed games', () => {
    const fenBefore = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const r: MoveReview = {
      ply: 5, san: 'Nd4', uci: 'f3d4', color: 'w', fenBefore, fenAfter: applyUci(fenBefore, 'f3d4')!, evalBefore: { kind: 'cp', value: 40 }, evalAfter: { kind: 'cp', value: -290 },
      bestLine: ['f1c4'], winBefore: 53, winAfter: 25, winLoss: 28, classification: 'blunder', flags: ['material_loss'], depth: 16,
    };
    const events = eventsFromGame('g1', [r, { ...r, color: 'b' }], { 5: ['e5d4', 'c2c3'] }, 'w', NOW);
    expect(events.every((e) => e.ref.gameId === 'g1' && e.ref.ply === 5)).toBe(true);
    expect(events.map((e) => e.skill)).toContain('threats');
    expect(events.find((e) => e.skill === 'threats')?.outcome).toBe(0);
  });

  describe('no positive evidence without a real choice (A6)', () => {
    const review = (fenBefore: string, uci: string, over: Partial<MoveReview>): MoveReview => ({
      ply: 12, san: '', uci, color: 'b', fenBefore, fenAfter: applyUci(fenBefore, uci)!, evalBefore: { kind: 'cp', value: 0 }, evalAfter: { kind: 'cp', value: 0 },
      bestLine: [uci], winBefore: 50, winAfter: 50, winLoss: 0, classification: 'best', flags: [], depth: 16, ...over,
    });
    const positives = (r: MoveReview) => eventsFromGame('g', [r], {}, r.color, NOW).filter((e) => e.outcome > 0);

    it('Légal 6…Ke7, the only legal move, yields no positive event', () => {
      const r = review('rn1qkbnr/ppp2B1p/3p2p1/4N3/4P3/2N5/PPPP1PPP/R1BbK2R b KQkq - 0 6', 'e8e7', {
        evalBefore: { kind: 'mate', value: 1 }, evalAfter: { kind: 'mate', value: 1 }, winBefore: 0, winAfter: 0, bestLine: ['e8e7', 'c3d5'], flags: ['defense_needed'],
      });
      expect(positives(r)).toEqual([]);
    });

    it('Ópera 16…Nxb8, the only legal move before mate, yields no tactics or defense event', () => {
      const r = review('1Q2kb1r/p2n1ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 b k - 1 16', 'd7b8', {
        evalBefore: { kind: 'mate', value: 1 }, evalAfter: { kind: 'mate', value: 1 }, winBefore: 0, winAfter: 0, bestLine: ['d7b8', 'd1d8'], flags: ['defense_needed'],
      });
      expect(positives(r)).toEqual([]);
    });

    it('moves inside an already forced mate yield no positive event even with several legal moves', () => {
      const r = review('8/8/8/3k4/8/8/8/K5Q1 b - - 0 1', 'd5e4', {
        evalBefore: { kind: 'mate', value: 9 }, evalAfter: { kind: 'mate', value: 9 }, winBefore: 0, winAfter: 0, classification: 'good', flags: ['defense_needed'],
      });
      expect(positives(r)).toEqual([]);
    });

    it('the only move that holds a balanced position counts as defense', () => {
      const r = review('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'e7e5', { winBefore: 45, winAfter: 45, flags: ['only_move'] });
      expect(positives(r).map((e) => e.skill)).toContain('defense');
    });
  });

  it('shows a point estimate only once the evidence is not insufficient (B4)', () => {
    expect(hasPointEstimate(estimateSkill('tactics', [ev(0, 1)], NOW))).toBe(false);
    expect(hasPointEstimate(estimateSkill('tactics', [ev(1, 1), ev(1, 2), ev(0, 3)], NOW))).toBe(true);
  });

  it('caps the weight one game can add to a skill', () => {
    const fenBefore = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const good: MoveReview = {
      ply: 1, san: 'e4', uci: 'e2e4', color: 'w', fenBefore, fenAfter: applyUci(fenBefore, 'e2e4')!, evalBefore: { kind: 'cp', value: 30 }, evalAfter: { kind: 'cp', value: 30 },
      bestLine: ['e2e4'], winBefore: 53, winAfter: 53, winLoss: 0, classification: 'best', flags: [], depth: 16,
    };
    const many = Array.from({ length: 20 }, (_, i) => ({ ...good, ply: i * 2 + 1 }));
    const events = eventsFromGame('g', many, {}, 'w', NOW);
    const openingsWeight = events.filter((e) => e.skill === 'openings').reduce((s, e) => s + e.weight, 0);
    expect(openingsWeight).toBeCloseTo(1, 5);
  });
});

describe('recommendations', () => {
  const fenBefore = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const r: MoveReview = {
    ply: 5, san: 'Nd4', uci: 'f3d4', color: 'w', fenBefore, fenAfter: applyUci(fenBefore, 'f3d4')!, evalBefore: { kind: 'cp', value: 40 }, evalAfter: { kind: 'cp', value: -290 },
    bestLine: ['f1c4'], winBefore: 53, winAfter: 25, winLoss: 28, classification: 'blunder', flags: [], depth: 16,
  };

  it('invites to import when there is no data', () => {
    expect(nextTraining({ games: [], dueReviews: 0, totalGames: 0, profile: [] }).kind).toBe('import');
  });

  it('needs at least two occurrences of a theme and cites the evidence', () => {
    const one = [{ gameId: 'a', userColor: 'w' as const, reviews: [r], replyLines: { 5: ['e5d4', 'c2c3'] } }];
    expect(nextTraining({ games: one, dueReviews: 0, totalGames: 1, profile: [] }).kind).not.toBe('theme');
    const two = [...one, { ...one[0]!, gameId: 'b' }];
    const rec = nextTraining({ games: two, dueReviews: 0, totalGames: 2, profile: [] });
    expect(rec.kind).toBe('theme');
    expect(rec.theme).toBe('hanging_piece');
    expect(rec.message).toContain('peças desprotegidas em 2');
    expect(rec.evidence.map((e) => e.gameId)).toEqual(['a', 'b']);
  });

  it('ignores games where the user color is unknown', () => {
    expect(errorThemes([{ gameId: 'a', reviews: [r], replyLines: { 5: ['e5d4', 'c2c3'] } }]).size).toBe(0);
  });

  // 1.Qh2?? allows 1…Nf3+ forking king and queen (the audit's constructed fork).
  const forkFen = '3qk3/8/8/8/3n4/8/2Q5/R3K3 w Q - 0 1';
  const allowedFork: MoveReview = {
    ply: 31, san: 'Qh2', uci: 'c2h2', color: 'w', fenBefore: forkFen, fenAfter: applyUci(forkFen, 'c2h2')!, evalBefore: { kind: 'cp', value: 0 }, evalAfter: { kind: 'cp', value: -900 },
    bestLine: ['e1f1'], winBefore: 50, winAfter: 3, winLoss: 47, classification: 'blunder', flags: [], depth: 16,
  };
  const forkGames = ['a', 'b'].map((gameId) => ({ gameId, userColor: 'w' as const, reviews: [allowedFork], replyLines: { 31: ['d4f3', 'e1f1', 'f3h2', 'f1g2', 'h2g4', 'a1a7'] } }));

  it('an allowed fork is reported as the opponent fork, never as a fork "not taken" (Sprint 3)', () => {
    const rec = nextTraining({ games: forkGames, dueReviews: 0, totalGames: 2, profile: [] });
    expect(rec.theme).toBe('fork');
    expect(rec.title).toMatch(/do adversário/);
    expect(rec.message).not.toMatch(/não aproveitad/);
    // And the evidence lands on threat identification, not on own pattern recognition.
    const events = eventsFromGame('a', [allowedFork], { 31: ['d4f3', 'e1f1', 'f3h2', 'f1g2', 'h2g4', 'a1a7'] }, 'w', NOW);
    expect(events.some((e) => e.skill === 'threats' && e.outcome === 0)).toBe(true);
    expect(events.some((e) => e.skill === 'patterns')).toBe(false);
  });

  it('"Treinar este tema" opens the exercises of the same side of the motif (Sprint 4.7, PD-3)', () => {
    const rec = nextTraining({ games: forkGames, dueReviews: 0, totalGames: 2, profile: [] });
    expect(rec.action.to).toBe('/train?theme=fork&side=opponent');
    const allowed = mkExercise('o', { theme: 'fork', motifSide: 'opponent' });
    const missed = mkExercise('m', { theme: 'fork', motifSide: 'own' });
    const legacy = mkExercise('l', { theme: 'fork' }); // before motifSide: always the player's own tactic
    expect([allowed, missed, legacy].filter((e) => matchesThemeFilter(e, 'fork', 'opponent')).map((e) => e.id)).toEqual(['o']);
    expect([allowed, missed, legacy].filter((e) => matchesThemeFilter(e, 'fork', 'own')).map((e) => e.id)).toEqual(['m', 'l']);
    expect([allowed, missed, legacy].filter((e) => matchesThemeFilter(e, 'fork')).map((e) => e.id)).toEqual(['o', 'm', 'l']);
    // One-sided themes keep a plain theme link.
    expect(trainThemeHref('hanging_piece', 'opponent')).toBe('/train?theme=hanging_piece');
  });

  it('without a recurring pattern or due reviews, recommends a skill flagged for review with its numbers (Sprint 3)', () => {
    const weak = Array.from({ length: 10 }, (_, i) => ev(i % 5 === 0 ? 1 : 0, i, { skill: 'defense', ref: { exerciseId: `d${i}` } }));
    const profile = [estimateSkill('defense', weak, NOW)];
    const rec = nextTraining({ games: [{ gameId: 'a', userColor: 'w', reviews: [], replyLines: {} }], dueReviews: 0, totalGames: 1, profile });
    expect(rec.kind).toBe('skill');
    expect(rec.message).toMatch(/Defesa precisa de revisão \(taxa recente \d+%; estimativa entre \d+% e \d+%, em 10 evidência/);
    expect(rec.action.to).toBe('/train?skill=defense');
  });
});

describe('historical diagnosis and recent evolution (Sprint 4.5, decision D-4 B)', () => {
  const YEAR = 365 * DAY_MS;
  const T = 2000 * DAY_MS;
  const game = (ageMs: number, outcome: number, i: number): SkillEvent => ({ skill: 'strategy', at: T - ageMs - i * DAY_MS, outcome, weight: 0.2, independent: true, source: 'game', ref: { gameId: `g${i}`, ply: 1 } });
  const exercise = (outcome: number, i: number, at = T): SkillEvent => ({ skill: 'strategy', at: at - i * 1000, outcome, weight: 1, independent: outcome === 1, difficulty: 2, source: 'exercise', ref: { exerciseId: `x${i}` } });
  const oldGames = Array.from({ length: 60 }, (_, i) => game(YEAR, i % 10 < 4 ? 1 : 0, i));

  it('a new player with only year-old games gets a historical diagnosis and no false "needs review"', () => {
    const s = estimateSkill('strategy', oldGames, T);
    expect(s.confidence).toBe('no_recent');
    expect(s.history?.level).toBeCloseTo(0.4, 1);
    expect(s.history?.evidence).toBeCloseTo(12, 5); // 60 × 0.2, no decay
    expect(s.history?.from).toBeLessThan(s.history?.to ?? 0);
    expect(hasPointEstimate(s)).toBe(false); // the decayed recent estimate is not shown as a number
    // Nor a "recent" rate or a trend computed from year-old moves.
    expect(s.recentRate).toBeNull();
    expect(s.trend).toBe('unknown');
  });

  it('the historical diagnosis does not decay with age; the recent evolution does', () => {
    const recent = estimateSkill('strategy', oldGames.map((e) => ({ ...e, at: e.at + YEAR })), T);
    const old = estimateSkill('strategy', oldGames, T);
    expect(old.history?.level).toBeCloseTo(recent.history?.level ?? 0, 10);
    expect(old.history?.evidence).toBeCloseTo(recent.history?.evidence ?? 0, 10);
    expect(old.evidence).toBeLessThan(recent.evidence / 5);
  });

  it('exercises after old games do not make a trend out of the change of evidence kind (N2)', () => {
    const s = estimateSkill('strategy', [...oldGames, ...[1, 1, 1, 1, 0].map((o, i) => exercise(o, i))], T);
    expect(s.trend).toBe('unknown'); // only 5 exercises: no earlier exercises to compare with
    expect(s.confidence).not.toBe('needs_review');
  });

  it('a real drop within the same kind of evidence still asks for review, with a downward trend', () => {
    const outcomes = [...Array(8).fill(1), ...Array(8).fill(0)];
    const s = estimateSkill('strategy', [...oldGames, ...outcomes.map((o, i) => exercise(o, 15 - i))], T);
    expect(s.trend).toBe('down');
    expect(s.confidence).toBe('needs_review');
  });

  it('games-only evidence compares game moves with game moves', () => {
    const recentGames = Array.from({ length: 16 }, (_, i) => game(0, i < 8 ? 0 : 1, 15 - i));
    expect(estimateSkill('strategy', recentGames, T).trend).toBe('up');
  });
});

describe('review findings (Sprint 4.5)', () => {
  const T = 2000 * DAY_MS;
  it('repeating one exercise does not fabricate a recent drop (1/k also in the recent comparison)', () => {
    const ev = (i: number, outcome: number, exerciseId: string) => ({ skill: 'tactics' as const, at: T - (20 - i) * 1000, outcome, weight: 1, independent: outcome === 1, difficulty: 2, source: 'exercise' as const, ref: { exerciseId } });
    // 8 distinct exercises solved, then 4 more solved and one exercise failed 4 times in a row.
    const events = [...Array.from({ length: 12 }, (_, i) => ev(i, 1, `d${i}`)), ...Array.from({ length: 4 }, (_, i) => ev(12 + i, 0, 'same'))];
    const s = estimateSkill('tactics', events, T);
    // With raw weights: recent 4/8 = 50% against 12/16 = 75% (a 25 p.p. "drop"). With 1/k the repeats
    // weigh 1 + 1/2 + 1/3 + 1/4: recent 4/6.08 ≈ 66% against 12/14.08 ≈ 85%, below the 20 p.p. threshold.
    expect(s.recentRate).toBeCloseTo(4 / (4 + 1 + 1 / 2 + 1 / 3 + 1 / 4), 3);
    expect(s.confidence).not.toBe('needs_review');
  });

  it('skills without recent evidence are named even when others still lack evidence', () => {
    const T2 = 1000 * DAY_MS;
    const old = Array.from({ length: 20 }, (_, i) => ({ skill: 'strategy' as const, at: T2 - 400 * DAY_MS - i * DAY_MS, outcome: 1, weight: 0.2, independent: true, source: 'game' as const, ref: { gameId: 'g', ply: i } }));
    const profile = estimateProfile(old, T2);
    const rec = nextTraining({ profile, games: [{ gameId: 'g', userColor: 'w', reviews: [], replyLines: {} }], dueReviews: 0, totalGames: 1 });
    expect(rec.message).toContain('Sem evidência recente em: Estratégia');
    expect(rec.message).toContain('Ainda há poucas evidências em');
  });
});

describe('the recent window is a time window (audit AI-1)', () => {
  const T = 3000 * DAY_MS;
  const x = (ageDays: number, outcome: number, id: string, i = 0): SkillEvent => ({ skill: 'strategy', at: T - ageDays * DAY_MS - i * 1000, outcome, weight: 1, independent: outcome === 1, difficulty: 2, source: 'exercise', ref: { exerciseId: id } });
  const g = (ageDays: number, outcome: number, i: number): SkillEvent => ({ skill: 'strategy', at: T - ageDays * DAY_MS - i * 1000, outcome, weight: 0.2, independent: true, source: 'game', ref: { gameId: `g${i}`, ply: 1 } });

  it('one solved exercise after weeks-old failures is not a "recent drop" nor a review recommendation', () => {
    const old = [...Array.from({ length: 12 }, (_, i) => x(60, 1, `c${i}`, i)), ...Array.from({ length: 12 }, (_, i) => x(45, 0, `d${i}`, i))];
    const events = [...old, x(1, 1, 'yesterday')];
    const s = estimateSkill('strategy', events, T);
    expect(s.confidence).not.toBe('needs_review');
    expect(s.recentRate).toBeNull(); // 1 event in 30 days: below the minimum sample
    expect(s.trend).toBe('unknown');
    const rec = nextTraining({ profile: estimateProfile(events, T), games: [{ gameId: 'z', userColor: 'w', reviews: [], replyLines: {} }], dueReviews: 0, totalGames: 1 });
    expect(rec.title).not.toContain('Revisar');
  });

  it('year-old exercises plus one today give no recent rate nor trend', () => {
    const old = [...Array.from({ length: 12 }, (_, i) => x(400, 1, `a${i}`, i)), ...Array.from({ length: 12 }, (_, i) => x(370, 0, `b${i}`, i))];
    const s = estimateSkill('strategy', [...old, x(1, 1, 'today')], T);
    expect(s.recentRate).toBeNull();
    expect(s.trend).toBe('unknown');
  });

  it('two recent game moves after old games: no "recent 75% · up" next to "insufficient"', () => {
    const old = Array.from({ length: 60 }, (_, i) => g(365, i % 10 < 4 ? 1 : 0, i));
    const s = estimateSkill('strategy', [...old, g(1, 1, 900), g(1, 1, 901)], T);
    expect(s.recentRate).toBeNull();
    expect(s.trend).toBe('unknown');
  });

  it('enough recent events still give a recent rate, a trend against an older baseline and a real drop', () => {
    const before = Array.from({ length: 8 }, (_, i) => x(60, 1, `p${i}`, i));
    const recent = Array.from({ length: 6 }, (_, i) => x(2, 0, `r${i}`, i));
    const s = estimateSkill('strategy', [...before, ...recent], T);
    expect(s.recentRate).toBe(0);
    expect(s.trend).toBe('down');
    expect(s.confidence).toBe('needs_review');
  });
});

describe('old evidence does not ask for review through the weak bound either (final audit FA-1)', () => {
  const T = 3000 * DAY_MS;
  const x = (ageDays: number, outcome: number, id: string, i = 0): SkillEvent => ({ skill: 'tactics', at: T - ageDays * DAY_MS - i * 1000, outcome, weight: 1, independent: outcome === 1, difficulty: 2, source: 'exercise', ref: { exerciseId: id } });
  const g = (ageDays: number, outcome: number, i: number): SkillEvent => ({ skill: 'tactics', at: T - ageDays * DAY_MS - i * 1000, outcome, weight: 0.3, independent: true, source: 'game', ref: { gameId: `g${i}`, ply: 1 } });
  const oldFailures = (ageDays: number) => Array.from({ length: 20 }, (_, i) => x(ageDays, 0, `f${i}`, i));
  const review = (events: SkillEvent[]) => nextTraining({ profile: estimateProfile(events, T), games: [{ gameId: 'z', userColor: 'w', reviews: [], replyLines: {} }], dueReviews: 0, totalGames: 1 });

  it.each([35, 90, 200])('failures %i days old plus one solved exercise today: no "needs review", no review recommendation', (age) => {
    const events = [...oldFailures(age), x(0, 1, 'today')];
    const s = estimateSkill('tactics', events, T);
    expect(s.confidence).not.toBe('needs_review');
    expect(s.history?.level).toBeLessThan(0.2); // the historical diagnosis still shows the weakness
    expect(review(events).title).not.toContain('Revisar');
  });

  it('one recent game move after old failures does not ask for review', () => {
    expect(estimateSkill('tactics', [...oldFailures(35), g(0, 1, 1)], T).confidence).not.toBe('needs_review');
  });

  it('solving one exercise does not turn "no recent evidence" into "needs review"', () => {
    expect(estimateSkill('tactics', oldFailures(35), T).confidence).toBe('no_recent');
    expect(estimateSkill('tactics', [...oldFailures(35), x(0, 1, 'today')], T).confidence).not.toBe('needs_review');
  });

  it('enough recent evidence below 50% still asks for review, of any kind', () => {
    const recentExercises = Array.from({ length: 8 }, (_, i) => x(i, 0, `r${i}`));
    expect(estimateSkill('tactics', recentExercises, T).confidence).toBe('needs_review');
    // Old exercises plus many recent game errors: the recent sample is the game moves.
    const oldGood = Array.from({ length: 6 }, (_, i) => x(300, 1, `o${i}`, i));
    const recentGames = Array.from({ length: 30 }, (_, i) => g(i % 10, 0, i));
    expect(estimateSkill('tactics', [...oldGood, ...recentGames], T).confidence).toBe('needs_review');
  });
});

describe('the weak bound is measured on recent evidence (final audit FA-7)', () => {
  const T = 3000 * DAY_MS;
  let k = 0;
  const x = (ageDays: number, outcome: number): SkillEvent => ({ skill: 'tactics', at: T - ageDays * DAY_MS - ++k * 1000, outcome, weight: 1, independent: outcome === 1, difficulty: 2, source: 'exercise', ref: { exerciseId: `q${k}` } });
  const rep = (n: number, age: number, outcome: number) => Array.from({ length: n }, () => x(age, outcome));
  const rec = (events: SkillEvent[]) => nextTraining({ profile: estimateProfile(events, T), games: [{ gameId: 'z', userColor: 'w', reviews: [], replyLines: {} }], dueReviews: 0, totalGames: 1 });

  it.each([
    [20, 60, 4],
    [40, 90, 8],
  ])('%i failures %i days old plus %i recent successes: no "needs review", no review recommendation', (old, age, recent) => {
    const events = [...rep(old, age, 0), ...rep(recent, 2, 1)];
    const s = estimateSkill('tactics', events, T);
    expect(s.recentRate).toBe(1);
    expect(s.confidence).not.toBe('needs_review');
    expect(s.history?.level).toBeLessThan(0.35); // the historical diagnosis still shows the old weakness
    expect(rec(events).title).not.toContain('Revisar');
  });

  it('recent failures after old successes still ask for review', () => {
    expect(estimateSkill('tactics', [...rep(20, 60, 1), ...rep(6, 2, 0)], T).confidence).toBe('needs_review');
  });

  it('a recent sample clearly below 50% asks for review even without a drop', () => {
    const s = estimateSkill('tactics', [...rep(20, 60, 0), ...rep(5, 2, 0), ...rep(1, 1, 1)], T);
    expect(s.confidence).toBe('needs_review');
  });
});

describe('one-sided game evidence (Sprint 4.7, PD-1)', () => {
  // 1.Qxd5?? exd5: a capture that loses the queen for a pawn (SEE −8, settled in the engine line).
  const fenBefore = '4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1';
  const losingCapture: MoveReview = {
    ply: 41, san: 'Qxd5', uci: 'd1d5', color: 'w', fenBefore, fenAfter: applyUci(fenBefore, 'd1d5')!, evalBefore: { kind: 'cp', value: 0 }, evalAfter: { kind: 'cp', value: -900 },
    bestLine: ['e1e2'], winBefore: 50, winAfter: 3, winLoss: 47, classification: 'blunder', flags: ['material_loss'], depth: 16,
  };
  const replies = { 41: ['e6d5', 'e1e2'] };

  it('games can only fail a skill they can also succeed in: a losing capture yields no "calculation" event', () => {
    const concept = detectConcepts(losingCapture, replies[41])[0];
    expect(concept?.theme).toBe('losing_capture');
    expect(concept && skillOf(concept)).toBe('calculation');
    const events = eventsFromGame('g', [losingCapture], replies, 'w', NOW);
    expect(events.length).toBeGreaterThan(0); // the phase evidence stays
    expect(events.some((e) => e.skill === 'calculation')).toBe(false);
  });

  it('every skill a game event can carry has a success path in games', () => {
    expect(GAME_SUCCESS_SKILLS).not.toContain('calculation');
    const reachable = new Set(Object.keys(THEME_SKILL).flatMap((t) => [skillOf({ theme: t as Theme, side: 'own' }), skillOf({ theme: t as Theme, side: 'opponent' })]));
    for (const skill of reachable) {
      if (!GAME_SUCCESS_SKILLS.includes(skill)) expect(skill).toBe('calculation');
    }
  });

  it('game failures stored before the fix neither measure nor flag "calculation" (reproduction R2 of the post-4.6 audit)', () => {
    const legacy: SkillEvent[] = Array.from({ length: 14 }, (_, i) => ({ skill: 'calculation', at: NOW - i * DAY_MS, outcome: 0, weight: 0.5, independent: true, source: 'game', ref: { gameId: `g${i}`, ply: 10 } }));
    const s = estimateSkill('calculation', legacy, NOW);
    expect(s.confidence).toBe('insufficient');
    expect(s.level).toBeNull();
    expect(s.events).toBe(0);
    const rec = nextTraining({ games: [{ gameId: 'a', userColor: 'w', reviews: [], replyLines: {} }], dueReviews: 0, totalGames: 1, profile: estimateProfile(legacy, NOW) });
    expect(rec.kind).not.toBe('skill');
  });

  it('exercises still measure "calculation", in both directions', () => {
    const fails = Array.from({ length: 10 }, (_, i) => ev(0, i, { skill: 'calculation', ref: { exerciseId: `c${i}` } }));
    expect(estimateSkill('calculation', fails, NOW).confidence).toBe('needs_review');
  });
});
