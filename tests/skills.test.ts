import { describe, expect, it } from 'vitest';
import { estimateSkill, estimateProfile, exerciseOutcome, eventsFromAttempt, targetDifficulty, eventsFromGame, hasPointEstimate } from '../src/services/adaptation/skills';
import { nextTraining, errorThemes } from '../src/services/recommendations/recommend';
import { applyUci } from '../src/services/chess/position';
import { DAY_MS } from '../src/services/scheduling/srs';
import type { Exercise, MoveReview, SkillEvent } from '../src/types/domain';

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

  it('flags stale knowledge for review', () => {
    const old = Array.from({ length: 10 }, (_, i) => ev(1, i, { at: i }));
    expect(estimateSkill('tactics', old, NOW).confidence).toBe('needs_review');
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

  it('without a recurring pattern or due reviews, recommends a skill flagged for review with its numbers (Sprint 3)', () => {
    const weak = Array.from({ length: 10 }, (_, i) => ev(i % 5 === 0 ? 1 : 0, i, { skill: 'defense', ref: { exerciseId: `d${i}` } }));
    const profile = [estimateSkill('defense', weak, NOW)];
    const rec = nextTraining({ games: [{ gameId: 'a', userColor: 'w', reviews: [], replyLines: {} }], dueReviews: 0, totalGames: 1, profile });
    expect(rec.kind).toBe('skill');
    expect(rec.message).toMatch(/Defesa precisa de revisão \(taxa recente \d+%; estimativa entre \d+% e \d+%, em 10 evidência/);
    expect(rec.action.to).toBe('/train?skill=defense');
  });
});
