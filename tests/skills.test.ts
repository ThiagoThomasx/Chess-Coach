import { describe, expect, it } from 'vitest';
import { estimateSkill, estimateProfile, exerciseOutcome, eventsFromAttempt, targetDifficulty, eventsFromGame } from '../src/services/adaptation/skills';
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
    const events = Array.from({ length: 16 }, (_, i) => ev(1, i, { ref: { exerciseId: `ex${i}` } }));
    const s = estimateSkill('tactics', events, NOW);
    expect(s.level).toBeGreaterThan(0.85);
    expect(s.confidence).toBe('provisional_mastery');
    expect(s.independentRate).toBe(1);
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
});
