import type {
  AnalysisSettings,
  ClassificationThresholds,
  EngineLine,
  Game,
  GameAnalysis,
  MoveReview,
  PositionAnalysis,
  Score,
} from '../../types/domain';
import { replayGame, sideToMove, terminalState, uciToSan, type PlyInfo } from '../chess/position';
import { materialSwingAlongLine } from '../chess/material';
import { classifyMove, DEFAULT_THRESHOLDS } from './classify';
import { matedScore, scoresEqual, winPercentFor } from './evaluation';
import type { AnalyzeRequest } from '../engine/UciEngine';

export interface EngineLike {
  analyze(req: AnalyzeRequest): Promise<PositionAnalysis>;
}

export interface EvalCache {
  get(fen: string, depth: number, multiPv: number): Promise<PositionAnalysis | undefined>;
  put(analysis: PositionAnalysis): Promise<void>;
}

export interface AnalyzeGameDeps {
  engine: EngineLike;
  cache?: EvalCache;
  thresholds?: ClassificationThresholds;
  /** Called after each position is evaluated, with the updated analysis. */
  onProgress?: (a: GameAnalysis) => void | Promise<void>;
  signal?: { aborted: boolean };
}

/** Key used for cache lookups: FEN without the move counters. */
export function fenKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function terminalAnalysis(fen: string): PositionAnalysis | null {
  const t = terminalState(fen);
  if (!t) return null;
  const score: Score = t === 'checkmate' ? matedScore(sideToMove(fen)) : { kind: 'cp', value: 0 };
  return {
    fen,
    depth: 99,
    multiPv: 1,
    lines: [{ multipv: 1, score, pv: [], depth: 99 }],
    complete: true,
    timeMs: 0,
    terminal: t,
  };
}

/** A stored position is reusable when it finished and meets the requested limits. */
export function isReusable(p: PositionAnalysis | null | undefined, s: AnalysisSettings): p is PositionAnalysis {
  if (!p) return false;
  if (p.terminal) return true;
  return p.complete && p.depth >= s.depth && p.multiPv >= s.multiPv && p.lines.length > 0;
}

export function emptyAnalysis(game: Game, settings: AnalysisSettings): GameAnalysis {
  const now = Date.now();
  return {
    gameId: game.id,
    status: 'pending',
    settings,
    positions: Array.from({ length: game.moves.length + 1 }, () => null),
    reviews: [],
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * Analyzes (or resumes) every position in a game, one at a time. Previously
 * computed positions that satisfy the settings are reused.
 */
export async function analyzeGame(game: Game, settings: AnalysisSettings, deps: AnalyzeGameDeps, previous?: GameAnalysis): Promise<GameAnalysis> {
  const plies = replayGame(game.moves, game.startFen);
  const fens = [game.startFen, ...plies.map((p) => p.fenAfter)];
  const base = previous && previous.positions.length === fens.length ? previous : emptyAnalysis(game, settings);
  let analysis: GameAnalysis = { ...base, settings, status: 'running', positions: [...base.positions], error: undefined };
  const thresholds = deps.thresholds ?? DEFAULT_THRESHOLDS;

  for (let i = 0; i < fens.length; i++) {
    if (deps.signal?.aborted) {
      analysis = { ...analysis, status: 'paused', updatedAt: Date.now() };
      analysis.reviews = buildReviews(plies, analysis.positions, thresholds);
      return analysis;
    }
    const fen = fens[i] as string;
    if (isReusable(analysis.positions[i], settings)) continue;
    let result = terminalAnalysis(fen) ?? (await deps.cache?.get(fen, settings.depth, settings.multiPv));
    if (!result) {
      try {
        result = await deps.engine.analyze({ fen, depth: settings.depth, multiPv: settings.multiPv });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const cancelled = typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'cancelled';
        analysis = { ...analysis, status: cancelled ? 'paused' : 'error', ...(cancelled ? {} : { error: msg }), updatedAt: Date.now() };
        analysis.reviews = buildReviews(plies, analysis.positions, thresholds);
        return analysis;
      }
      if (result.complete) await deps.cache?.put(result);
    }
    const positions = [...analysis.positions];
    positions[i] = { ...result, fen };
    analysis = { ...analysis, positions, updatedAt: Date.now() };
    analysis.reviews = buildReviews(plies, positions, thresholds);
    await deps.onProgress?.(analysis);
  }
  const allDone = analysis.positions.every((p) => p !== null && (p.complete || p.terminal));
  return { ...analysis, status: allDone ? 'complete' : 'paused', updatedAt: Date.now() };
}

function lineFor(p: PositionAnalysis, uci: string): EngineLine | undefined {
  return p.lines.find((l) => l.pv[0] === uci);
}

/** Builds move reviews for every ply whose surrounding positions are evaluated. */
export function buildReviews(plies: PlyInfo[], positions: readonly (PositionAnalysis | null)[], thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS): MoveReview[] {
  const out: MoveReview[] = [];
  plies.forEach((ply, idx) => {
    const before = positions[idx];
    const after = positions[idx + 1];
    if (!before || !after) return;
    const review = reviewMove(ply, before, after, thresholds);
    if (review) out.push(review);
  });
  return out;
}

export function reviewMove(ply: PlyInfo, before: PositionAnalysis, after: PositionAnalysis, thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS): MoveReview | null {
  const best = before.lines[0];
  const afterBest = after.lines[0];
  if (!best || !afterBest) return null;
  const playedLine = lineFor(before, ply.uci);
  // Prefer the played move's own line from the same search (same depth); otherwise use the next position's eval.
  const evalAfter = playedLine ? playedLine.score : afterBest.score;
  const playedIsBest = best.pv[0] === ply.uci || (playedLine !== undefined && scoresEqual(playedLine.score, best.score));
  const second = before.lines[1];
  const secondBestGap = second ? winPercentFor(best.score, ply.color) - winPercentFor(second.score, ply.color) : undefined;
  const depth = playedLine ? before.depth : Math.min(before.depth, after.depth);
  const complete = (before.complete || !!before.terminal) && (playedLine ? true : after.complete || !!after.terminal);

  const result = classifyMove({
    color: ply.color,
    before: best.score,
    after: evalAfter,
    playedIsBest,
    depth,
    complete,
    ply: ply.ply,
    ...(secondBestGap !== undefined ? { secondBestGap } : {}),
    thresholds,
  });

  const flags = [...result.flags];
  const serious = result.classification === 'mistake' || result.classification === 'blunder';
  if (serious || result.classification === 'inaccuracy') {
    // Material verified along the opponent's best reply line.
    const reply = afterBest.pv;
    if (reply.length > 0 && materialSwingAlongLine(ply.fenAfter, reply, ply.color, 6).delta <= -2) flags.push('material_loss');
    const bestGain = materialSwingAlongLine(ply.fenBefore, best.pv, ply.color, 6).delta;
    const playedGain = materialSwingAlongLine(ply.fenBefore, [ply.uci, ...reply], ply.color, 7).delta;
    if (bestGain >= 2 && bestGain > playedGain) flags.push('missed_tactic');
  }

  const bestUci = best.pv[0];
  const bestSan = bestUci ? uciToSan(ply.fenBefore, bestUci) : null;
  return {
    ply: ply.ply,
    san: ply.san,
    uci: ply.uci,
    color: ply.color,
    fenBefore: ply.fenBefore,
    fenAfter: ply.fenAfter,
    evalBefore: best.score,
    evalAfter,
    ...(bestUci ? { bestMoveUci: bestUci } : {}),
    ...(bestSan ? { bestMoveSan: bestSan } : {}),
    bestLine: best.pv,
    winBefore: result.winBefore,
    winAfter: result.winAfter,
    winLoss: result.winLoss,
    ...(result.cpLoss !== undefined ? { cpLoss: result.cpLoss } : {}),
    classification: result.classification,
    flags: [...new Set(flags)],
    depth,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

export interface GameSummary {
  counts: Record<string, number>;
  avgWinLoss: number | null;
  avgCpLoss: number | null;
  conclusive: number;
}

/**
 * Per-side summary. "avgWinLoss" is the mean win-expectancy loss per move — a
 * ChessQuest-specific metric, not comparable to other platforms' "accuracy".
 */
export function summarize(reviews: readonly MoveReview[], color?: 'w' | 'b'): GameSummary {
  const rs = reviews.filter((r) => !color || r.color === color);
  const counts: Record<string, number> = {};
  for (const r of rs) counts[r.classification] = (counts[r.classification] ?? 0) + 1;
  const conclusive = rs.filter((r) => r.classification !== 'inconclusive');
  const cps = conclusive.filter((r) => r.cpLoss !== undefined).map((r) => Math.min(r.cpLoss as number, 1000));
  return {
    counts,
    conclusive: conclusive.length,
    avgWinLoss: conclusive.length ? conclusive.reduce((s, r) => s + r.winLoss, 0) / conclusive.length : null,
    avgCpLoss: cps.length ? cps.reduce((a, b) => a + b, 0) / cps.length : null,
  };
}

/** Reply line (best line of the position after each ply), keyed by ply. */
export function replyLinesOf(a: GameAnalysis): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  a.positions.forEach((p, i) => {
    if (i > 0 && p?.lines[0]) out[i] = p.lines[0].pv;
  });
  return out;
}
