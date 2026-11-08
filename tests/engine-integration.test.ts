// Runs the real Stockfish 19 WASM build (the same file the app serves) in Node.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterAll } from 'vitest';
import { UciEngine, type EngineTransport } from '../src/services/engine/UciEngine';
import { analyzeGame, reviewMove } from '../src/services/analysis/gameAnalyzer';
import { replayGame, uciLineToSan, uciToSan } from '../src/services/chess/position';
import { explainMove } from '../src/services/pedagogy/explain';
import { detectConcepts } from '../src/services/pedagogy/concepts';
import { DEFAULT_THRESHOLDS } from '../src/services/analysis/classify';
import { buildSolutionTree, goalFor, playSolverMove } from '../src/services/exercises/sequence';
import type { Exercise, ExerciseGoal, SolutionNode } from '../src/types/domain';
import { parsePgnText } from '../src/services/pgn/parsePgn';
import { OPERA_GAME, SHORT_BLUNDER_GAME } from './fixtures';
import { acceptsPlayedMove, buildExercise, withSolutionTree } from '../src/services/exercises/generate';
import { judgeOffBook, validateLine } from '../src/services/openings/practice';

const BRIDGE = fileURLToPath(new URL('./support/sf-bridge.cjs', import.meta.url));

function nodeTransport(): EngineTransport {
  const child = spawn(process.execPath, [BRIDGE], { stdio: ['pipe', 'pipe', 'inherit'] });
  const listeners: ((l: string) => void)[] = [];
  const errors: ((e: Error) => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (l) => listeners.forEach((fn) => fn(l)));
  child.on('error', (e) => errors.forEach((fn) => fn(e)));
  return {
    send: (c) => child.stdin.write(`${c}\n`),
    onLine: (fn) => listeners.push(fn),
    onError: (fn) => errors.push(fn),
    terminate: () => child.kill(),
  };
}

const engine = new UciEngine(nodeTransport);
afterAll(() => engine.terminate());

describe('Stockfish WASM (real engine)', () => {
  it('initializes and identifies itself', async () => {
    await engine.init();
    expect(engine.name).toMatch(/Stockfish/);
  }, 60_000);

  it('finds a back-rank mate in 1 for White', async () => {
    const r = await engine.analyze({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', depth: 10 });
    expect(r.complete).toBe(true);
    expect(r.lines[0]?.pv[0]).toBe('a1a8');
    expect(r.lines[0]?.score).toEqual({ kind: 'mate', value: 1 });
  }, 60_000);

  it('reports Black mates with a negative White-POV score', async () => {
    const r = await engine.analyze({ fen: 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', depth: 10 });
    expect(r.lines[0]?.pv[0]).toBe('a8a1');
    expect(r.lines[0]?.score).toEqual({ kind: 'mate', value: -1 });
  }, 60_000);

  it('returns several distinct lines with MultiPV', async () => {
    const r = await engine.analyze({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 8, multiPv: 3 });
    expect(r.lines).toHaveLength(3);
    expect(new Set(r.lines.map((l) => l.pv[0])).size).toBe(3);
  }, 60_000);

  it('analyzes a real game and flags the knight blunder', async () => {
    const game = { ...parsePgnText(SHORT_BLUNDER_GAME).games[0]!, importId: 'x', importedAt: 0 };
    const a = await analyzeGame(game, { depth: 12, multiPv: 2 }, { engine });
    expect(a.status).toBe('complete');
    const nd4 = a.reviews.find((r) => r.san === 'Nd4');
    expect(nd4 && ['mistake', 'blunder']).toBeTruthy();
    expect(['mistake', 'blunder']).toContain(nd4?.classification);
    expect(nd4?.flags).toContain('material_loss');
  }, 120_000);

  it('several near-equal first moves: playing the 2nd engine line is not labelled an error', async () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const before = await engine.analyze({ fen: start, depth: 12, multiPv: 3 });
    const second = before.lines[1]?.pv[0];
    expect(second).toBeDefined();
    const played = replayGame([sanOf(start, second as string)], start)[0]!;
    const after = await engine.analyze({ fen: played.fenAfter, depth: 12, multiPv: 1 });
    const r = reviewMove(played, before, after);
    expect(['best', 'excellent', 'good']).toContain(r?.classification);
  }, 60_000);

  it('a shallow search is reported as inconclusive, not as a verdict', async () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const played = replayGame(['a4'], start)[0]!;
    const before = await engine.analyze({ fen: start, depth: 4, multiPv: 1 });
    const after = await engine.analyze({ fen: played.fenAfter, depth: 4, multiPv: 1 });
    const r = reviewMove(played, before, after, DEFAULT_THRESHOLDS);
    expect(r?.depth).toBeLessThan(DEFAULT_THRESHOLDS.minDepth);
    expect(r?.classification).toBe('inconclusive');
  }, 60_000);

  it("fool's mate: 2.g4?? allows mate in one, scored from Black's side", async () => {
    const plies = replayGame(['f3', 'e5', 'g4']);
    const g4 = plies[2]!;
    const before = await engine.analyze({ fen: g4.fenBefore, depth: 12, multiPv: 2 });
    const after = await engine.analyze({ fen: g4.fenAfter, depth: 12, multiPv: 1 });
    expect(after.lines[0]?.score).toEqual({ kind: 'mate', value: -1 });
    const r = reviewMove(g4, before, after)!;
    expect(r.classification).toBe('blunder');
    expect(r.flags).toContain('allowed_mate');
    const c = detectConcepts(r, after.lines[0]?.pv ?? [])[0];
    expect(c).toMatchObject({ theme: 'allowed_mate', evidence: { mateMoveSan: 'Qh4#' } });
  }, 60_000);

  it('a capture that looks free (Qxd5) is detected as losing material with the real reply line', async () => {
    const fen = '4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1';
    const qxd5 = replayGame(['Qxd5'], fen)[0]!;
    const before = await engine.analyze({ fen, depth: 14, multiPv: 2 });
    const after = await engine.analyze({ fen: qxd5.fenAfter, depth: 14, multiPv: 1 });
    expect(after.lines[0]?.pv[0]).toBe('c6d5');
    const r = reviewMove(qxd5, before, after)!;
    expect(r.classification).toBe('blunder');
    expect(detectConcepts(r, after.lines[0]?.pv ?? [])[0]).toMatchObject({ theme: 'losing_capture', verified: true });
  }, 60_000);
});

describe('sequence exercises with the real engine', () => {
  const ROOKS = '6k1/8/8/8/8/8/1R6/R5K1 w - - 0 1';
  const goal: ExerciseGoal = { kind: 'mate', maxUserMoves: 2, targetWin: 100, mateIn: 2 };
  const opts = { depth: 14, multiPv: 4, tolerance: 5 };

  it('builds a tree with equivalent first moves and two opponent defenses', async () => {
    const tree = await buildSolutionTree(engine, ROOKS, goal, opts);
    const firsts = tree.accepted.map((m) => m.uci);
    // Only moves that keep a forced mate within 2 moves are accepted.
    expect(tree.accepted.every((m) => m.score.kind === 'mate' && m.score.value > 0 && m.score.value <= 2)).toBe(true);
    expect(firsts.length).toBeGreaterThanOrEqual(2);
    const expanded = Object.values(tree.replies).filter((b) => b.length > 0);
    expect(expanded.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...expanded.map((b) => b.length))).toBe(2);
  }, 120_000);

  it('solves the line move by move whichever defense the engine picks', async () => {
    const tree = await buildSolutionTree(engine, ROOKS, goal, opts);
    const ex = { id: 'e', fen: ROOKS, sideToMove: 'w', tolerance: 5, goal, tree, kind: 'mate' } as unknown as Exercise & { goal: ExerciseGoal };
    const first = tree.accepted[0]!.uci;
    for (const pick of [0, 1]) {
      const v1 = await playSolverMove(ex, { node: tree, userMoves: 0, fen: ROOKS }, first, { engine, depth: 12, tolerance: 5, choose: () => pick });
      expect(v1.kind).toBe('continue');
      if (v1.kind !== 'continue') return;
      const mateMove = v1.state.node.accepted[0]!.uci;
      const v2 = await playSolverMove(ex, v1.state, mateMove, { engine, depth: 12, tolerance: 5 });
      expect(v2.kind).toBe('solved');
    }
  }, 120_000);

  it('builds a solvable tree for a mate longer than the move limit (audit C1)', async () => {
    const fen = '8/8/8/3k4/8/8/8/K5Q1 w - - 0 1';
    const probe = await engine.analyze({ fen, depth: 18 });
    const best = probe.lines[0]!;
    expect(best.score.kind).toBe('mate');
    const long = goalFor(fen, best, 'missed_mate', 5);
    expect(long.mateIn).toBeGreaterThan(4);
    const tree = await buildSolutionTree(engine, fen, long, opts);
    expect(tree.accepted.length).toBeGreaterThanOrEqual(1);
    const ex = { id: 'm', fen, sideToMove: 'w', tolerance: 5, goal: long, tree, kind: 'mate' } as unknown as Exercise & { goal: ExerciseGoal };
    const v = await playSolverMove(ex, { node: tree, userMoves: 0, fen }, tree.accepted[0]!.uci, { engine, depth: 14, tolerance: 5, choose: () => 0 });
    expect(['continue', 'solved']).toContain(v.kind);
  }, 240_000);

  it('opponent replies in a mate tree are the longest defenses, never a faster mate (Sprint 3)', async () => {
    // Q+R vs K, mate in 7: at depth 16 every king move is "0%" for Black, so win% cannot rank them.
    const fen = '8/8/8/4k3/8/8/2Q5/1R4K1 w - - 0 1';
    const best = (await engine.analyze({ fen, depth: 16 })).lines[0]!;
    const goal = goalFor(fen, best, 'missed_mate', 5);
    const tree = await buildSolutionTree(engine, fen, goal, { depth: 16, multiPv: 3, tolerance: 5 });
    const check = (n: SolutionNode): void => {
      for (const branches of Object.values(n.replies)) {
        const distances = new Set(branches.map((b) => Math.abs(b.score.value)));
        expect(branches.every((b) => b.score.kind === 'mate')).toBe(true);
        expect(distances.size).toBeLessThanOrEqual(1);
        branches.forEach((b) => b.next && check(b.next));
      }
    };
    check(tree);
  }, 300_000);

  it('judges a move outside the stored lines with a fresh search', async () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const single: ExerciseGoal = { kind: 'single', maxUserMoves: 1, targetWin: 50 };
    const tree = await buildSolutionTree(engine, startFen, single, { depth: 12, multiPv: 1, tolerance: 5 });
    const ex = { id: 's', fen: startFen, sideToMove: 'w', tolerance: 5, goal: single, tree, kind: 'single' } as unknown as Exercise & { goal: ExerciseGoal };
    const st = { node: tree, userMoves: 0, fen: startFen };
    const alt = tree.accepted[0]!.uci === 'g1f3' ? 'd2d4' : 'g1f3';
    expect((await playSolverMove(ex, st, alt, { engine, depth: 12, tolerance: 5 })).kind).toBe('solved');
    const bad = await playSolverMove(ex, st, 'g2g4', { engine, depth: 12, tolerance: 5 });
    expect(bad.kind).toBe('rejected');
  }, 120_000);
});

function sanOf(fen: string, uci: string): string {
  return uciToSan(fen, uci) as string;
}

describe('explanation corpus from the Sprint 3 audit (real engine)', () => {
  const NEGATIONS = /sem um motivo tático|Não há perda|sem perda imediata/i;
  async function explainPlayed(fen: string, san: string) {
    const [, side, , , , fullmove] = fen.split(' ');
    // The real game ply (replayGame from a FEN counts from 1), so the phase is right.
    const played = { ...replayGame([san], fen)[0]!, ply: (Number(fullmove) - 1) * 2 + (side === 'w' ? 1 : 2) };
    const before = await engine.analyze({ fen, depth: 16, multiPv: 2 });
    const after = await engine.analyze({ fen: played.fenAfter, depth: 16, multiPv: 1 });
    const r = reviewMove(played, before, after)!;
    const reply = after.lines[0]?.pv ?? [];
    return { r, e: explainMove(r, reply), concepts: detectConcepts(r, reply), reply };
  }

  const A2: [string, string, string][] = [
    ['Légal 4…g6', 'rn1qkbnr/ppp2ppp/3p4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 3 4', 'g6'],
    ['Blackburne 4.Nxe5', 'r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'Nxe5'],
    ['Byrne 11.Bg5', 'r2q1rk1/pp2ppbp/1np2np1/2Q5/3PPBb1/2N2N2/PP3PPP/3RKB1R w K - 5 11', 'Bg5'],
    ['Opera 10…cxb5', 'rn2kb1r/p3qppp/2p2n2/1N2p1B1/2B1P3/1Q6/PPP2PPP/R3K2R b KQkq - 0 10', 'cxb5'],
  ];
  for (const [name, fen, san] of A2) {
    it(`${name}: no unproven negation, not filed under openings (A2)`, async () => {
      const { e } = await explainPlayed(fen, san);
      expect([e.whatHappened, e.why, e.consequence].join(' ')).not.toMatch(NEGATIONS);
      expect(e.skill).not.toBe('openings');
    }, 120_000);
  }

  const A3: [string, string, string][] = [
    ['Immortal 11…cxb5', 'rnb1kb1r/p2p1ppp/2p2n2/1B3Nq1/4PpP1/3P4/PPP4P/RNBQ1KR1 b kq - 2 11', 'cxb5'],
    ['Immortal 18…Bxg1', 'rnb1k1nr/p2p1ppp/3B4/1pbN1N1P/4P1P1/3P1Q2/PqP5/R4KR1 b kq - 1 18', 'Bxg1'],
  ];
  for (const [name, fen, san] of A3) {
    it(`${name}: the opponent's line is not the "why" of the better move, facts first (A3)`, async () => {
      const { e, concepts, reply } = await explainPlayed(fen, san);
      const replyStart = uciLineToSan(replayGame([san], fen)[0]!.fenAfter, reply.slice(0, 3)).join(' ');
      expect(e.why ?? '').not.toContain(replyStart);
      if (concepts.some((c) => c.verified)) expect(concepts[0]?.verified).toBe(true);
    }, 120_000);
  }
});

describe('opening deviations (audit M3, real engine)', () => {
  it('London 2.Nf3 is off-book but playable; 2.Ba6?? in the Italian is not', async () => {
    const london = validateLine(['d4', 'd5']).fens[2]!;
    expect((await judgeOffBook(engine, london, 'g1f3', 5)).playable).toBe(true);
    const italian = validateLine(['e4', 'e5']).fens[2]!;
    expect((await judgeOffBook(engine, italian, 'f1a6', 5)).playable).toBe(false);
  }, 120_000);
});

describe('quick-analysis false errors are discarded by the deeper tree (Sprint 4.5, P3-2; O1 reference case)', () => {
  // Opera game, 15.Bxd7+ (ply 29), a winning move. The depth-11 search below is frozen from the real
  // engine (identical in two fresh processes; Sprint 4.5 audit): it makes the app classify the move as a
  // blunder. Freezing it keeps that precondition deterministic; only the deeper tree uses the live engine.
  const plies = replayGame(parsePgnText(OPERA_GAME).games[0]!.moves);
  const ply = plies[28]!; // 15.Bxd7+
  const line = (multipv: number, value: number, pv: string[]) => ({ multipv, score: { kind: 'cp' as const, value }, pv, depth: 11 });
  const before = { fen: ply.fenBefore, depth: 11, multiPv: 3, complete: true, timeMs: 0, lines: [line(1, 812, ['g5f6']), line(2, 523, ['b3e6']), line(3, 342, ['c1b1'])] };
  const after = { fen: ply.fenAfter, depth: 11, multiPv: 3, complete: true, timeMs: 0, lines: [line(1, 261, ['f6d7', 'b3b7', 'f7f6']), line(2, 1019, ['e6d7', 'd1d7', 'e8d7']), line(3, 2613, ['e8e7', 'b3a3', 'e7d8'])] };

  it('a "blunder" at depth 11 that the depth-16 tree accepts gives no exercise', async () => {
    expect(ply.san).toBe('Bxd7+');
    const review = reviewMove(ply, before, after)!;
    expect(review.classification).toBe('blunder'); // the frozen quick analysis calls it a blunder
    const game = { ...parsePgnText(OPERA_GAME).games[0]!, id: 'opera', importId: 'i', importedAt: Date.now(), warnings: [], userColor: 'w' as const };
    const ex = buildExercise({ game, review, before, replyLine: after.lines[0]!.pv });
    expect(ex).not.toBeNull();

    const full = await withSolutionTree(ex!, engine, { depth: 16, multiPv: 3, tolerance: 5 });

    expect(full.tree?.depth).toBeGreaterThanOrEqual(16);
    expect(full.tree?.accepted.map((m) => m.uci)).toContain('b5d7');
    expect(acceptsPlayedMove(full, review.uci, before.depth)).toBe(true);
    // The same tree does not overrule an analysis as deep as itself (audit A5-1).
    expect(acceptsPlayedMove(full, review.uci, full.tree!.depth)).toBe(false);
  }, 180_000);
});
