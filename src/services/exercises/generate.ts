import { Chess } from 'chess.js';
import type { AcceptableMove, ClassificationThresholds, EngineLine, Exercise, Game, MoveReview, PositionAnalysis, Theme } from '../../types/domain';
import { applyUci, legalMoveCount, parseUci, uciToSan } from '../chess/position';
import { enPrise, seeCapture } from '../chess/tactics';
import { winPercentFor } from '../analysis/evaluation';
import { DEFAULT_THRESHOLDS } from '../analysis/classify';
import { detectConcepts, skillOf } from '../pedagogy/concepts';
import { newId } from '../../utils/hash';
import { fenKey, type EngineLike } from '../analysis/gameAnalyzer';
import { buildSolutionTree, goalFor, keepWinOf, mainLine, type TreeOptions } from './sequence';

export const DEFAULT_TOLERANCE = 5; // win% points

export interface CandidateCheck {
  ok: boolean;
  reasons: string[];
}

const TACTICAL: readonly Theme[] = ['missed_mate', 'missed_capture', 'fork', 'missed_check'];
/** Themes whose objective text already describes a defense. */
const DEFENSIVE_OBJECTIVE: readonly Theme[] = ['allowed_mate', 'mate_threat', 'defense', 'hanging_piece', 'ignored_threat', 'removed_defender'];

/** Minimum quality criteria a position must pass to become an exercise. */
export function checkCandidate(review: MoveReview, before: PositionAnalysis | null, thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS): CandidateCheck {
  const reasons: string[] = [];
  if (!before || before.lines.length === 0) reasons.push('Posição sem análise do motor');
  else {
    if (!before.complete) reasons.push('Análise da posição incompleta');
    if (before.depth < thresholds.minDepth) reasons.push(`Profundidade insuficiente (${before.depth})`);
  }
  if (review.classification === 'inconclusive') reasons.push('Classificação inconclusiva');
  const relevant =
    review.classification === 'mistake' ||
    review.classification === 'blunder' ||
    (review.classification === 'inaccuracy' && (review.flags.includes('mate_missed') || review.flags.includes('missed_tactic')));
  if (!relevant) reasons.push('Lance sem erro relevante');
  if (legalMoveCount(review.fenBefore) < 2) reasons.push('Apenas um lance legal');
  return { ok: reasons.length === 0, reasons };
}

export function acceptableMovesFrom(before: PositionAnalysis, tolerance: number): AcceptableMove[] {
  const stm = before.fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const best = before.lines[0];
  if (!best) return [];
  const bestWin = winPercentFor(best.score, stm);
  return before.lines
    .filter((l) => l.pv[0] && bestWin - winPercentFor(l.score, stm) <= tolerance)
    .map((l) => ({ uci: l.pv[0] as string, san: uciToSan(before.fen, l.pv[0] as string) ?? (l.pv[0] as string), score: l.score }));
}

/** Estimated difficulty 1–5 from verifiable features of the solution. */
export function estimateDifficulty(fen: string, solution: readonly string[], theme: Theme, alternatives: number): number {
  const first = solution[0];
  if (!first) return 1;
  const chess = new Chess(fen);
  const { to } = parseUci(first);
  const isCapture = !!chess.get(to);
  chess.move(parseUci(first));
  const isCheck = chess.inCheck();
  let d = 2;
  if (!isCapture && !isCheck) d += 1; // quiet moves are harder to find
  if (isSacrifice(fen, first)) d += 1; // giving material away is counter-intuitive
  const userMoves = Math.ceil(solution.length / 2);
  if (userMoves >= 3) d += 1;
  if (userMoves >= 2 && theme !== 'missed_capture') d += 0.5;
  if (theme === 'missed_capture' && userMoves === 1) d -= 1;
  if (alternatives > 1) d -= 0.5;
  return Math.max(1, Math.min(5, Math.round(d)));
}

/** The move gives material: a losing capture by SEE, or the moved piece left capturable with gain. */
export function isSacrifice(fen: string, uci: string): boolean {
  const see = seeCapture(fen, uci);
  if (see !== null && see < 0) return true;
  const after = applyUci(fen, uci);
  if (!after) return false;
  const mover = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  return enPrise(after, mover).some((e) => e.square === parseUci(uci).to);
}

function objectiveFor(theme: Theme, mateIn?: number, motifSide?: 'own' | 'opponent'): string {
  if (motifSide === 'opponent' && !DEFENSIVE_OBJECTIVE.includes(theme)) return 'Encontre um lance que evite a tática do adversário.';
  switch (theme) {
    case 'missed_mate':
      return mateIn ? `Encontre o mate em ${mateIn}.` : 'Encontre o mate forçado.';
    case 'missed_capture':
    case 'fork':
    case 'missed_check':
      return 'Encontre o lance que ganha material.';
    case 'allowed_mate':
    case 'mate_threat':
    case 'defense':
      return 'Encontre a defesa necessária: evite a ameaça do adversário.';
    case 'hanging_piece':
    case 'ignored_threat':
    case 'removed_defender':
      return 'Encontre um lance seguro que não deixe material desprotegido.';
    default:
      return 'Encontre o melhor lance nesta posição.';
  }
}

/** Solution line validated move by move: forcing lines keep up to 3 user moves; others only the first. */
function solutionLineFor(best: EngineLine, theme: Theme): string[] {
  if (best.score.kind === 'mate') {
    const n = Math.ceil(Math.abs(best.score.value));
    if (n <= 3) return best.pv.slice(0, 2 * n - 1);
  }
  if (TACTICAL.includes(theme)) return best.pv.slice(0, Math.min(best.pv.length, 3));
  return best.pv.slice(0, 1);
}

export interface BuildExerciseInput {
  game: Game;
  review: MoveReview;
  before: PositionAnalysis;
  replyLine: readonly string[];
  tolerance?: number;
  now?: number;
}

export function buildExercise({ game, review, before, replyLine, tolerance = DEFAULT_TOLERANCE, now = Date.now() }: BuildExerciseInput): Exercise | null {
  const best = before.lines[0];
  if (!best || !best.pv[0]) return null;
  const concepts = detectConcepts(review, replyLine);
  // From the solver's view, an error that lost material becomes "find the safe move".
  const theme: Theme = concepts[0]?.theme ?? 'positional';
  const motifSide = concepts[0]?.side;
  const acceptable = acceptableMovesFrom(before, tolerance);
  const bestMove = acceptable[0];
  if (!bestMove) return null;
  // Reject positions where the played (wrong) move would itself be accepted.
  if (acceptable.some((a) => a.uci === review.uci)) return null;
  const solutionLine = solutionLineFor(best, theme);
  const mateIn = best.score.kind === 'mate' ? Math.ceil(Math.abs(best.score.value)) : undefined;
  return {
    id: newId(),
    fen: review.fenBefore,
    source: 'game',
    gameId: game.id,
    ply: review.ply,
    sideToMove: review.color,
    objective: objectiveFor(theme, mateIn, motifSide),
    theme,
    ...(motifSide ? { motifSide } : {}),
    skill: concepts[0] ? skillOf(concepts[0]) : skillOf({ theme }),
    bestMove,
    acceptableMoves: acceptable,
    solutionLine,
    referenceLines: before.lines,
    difficulty: estimateDifficulty(review.fenBefore, solutionLine, theme, acceptable.length),
    ambiguous: acceptable.length > 1 || before.lines.length < 2,
    tolerance,
    createdAt: now,
    srs: { box: 0, dueAt: now },
    analysisDepth: before.depth,
  };
}

/** Picks the most instructive positions of a game, capped at `max`, ranked by win% loss. */
export function selectExercisePositions(
  game: Game,
  reviews: readonly MoveReview[],
  positions: readonly (PositionAnalysis | null)[],
  opts: { max: number; thresholds?: ClassificationThresholds; existingFens?: Set<string> },
): MoveReview[] {
  // Positions are compared without move counters: the same position reached at another move number is a repeat.
  const seen = new Set([...(opts.existingFens ?? [])].map(fenKey));
  const picked: MoveReview[] = [];
  const candidates = reviews
    .filter((r) => game.userColor === undefined || r.color === game.userColor)
    .filter((r) => checkCandidate(r, positions[r.ply - 1] ?? null, opts.thresholds).ok)
    .sort((a, b) => b.winLoss - a.winLoss);
  for (const r of candidates) {
    if (picked.length >= opts.max) break;
    if (seen.has(fenKey(r.fenBefore))) continue;
    seen.add(fenKey(r.fenBefore));
    picked.push(r);
  }
  return picked;
}

const OBJECTIVE_BY_KIND = {
  mate: (n: number | undefined, moves: number) =>
    !n ? 'Encontre o mate forçado.' : n > moves ? `Há mate em ${n}: jogue os próximos ${moves} lances mantendo o mate forçado.` : `Encontre o mate em ${n}.`,
  sequence: (n: number) => `Encontre a sequência que ganha material (até ${n} lances seus; o adversário responde).`,
  conversion: (n: number) => `Mantenha a vantagem decisiva pelos próximos ${n} lances.`,
  defense: () => 'Encontre a defesa: não deixe material ou o rei desprotegidos.',
  single: () => 'Encontre o melhor lance nesta posição.',
} as const;

/**
 * Adds the engine-built solution tree and goal to an exercise. Sequences,
 * equivalent alternatives and multiple opponent replies all come from the tree.
 */
export async function withSolutionTree(ex: Exercise, engine: EngineLike, opts: TreeOptions): Promise<Exercise> {
  const best = ex.referenceLines[0];
  if (!best) return ex;
  const goal = goalFor(ex.fen, best, ex.theme, opts.tolerance, ex.motifSide);
  const built = await buildSolutionTree(engine, ex.fen, goal, opts, ex.bestMove.uci);
  const accepted = built.accepted.length ? built.accepted : ex.acceptableMoves;
  // A tree with an empty root cannot be solved; fall back to the review's accepted moves.
  const tree = built.accepted.length ? built : { ...built, accepted };
  const line = mainLine(tree);
  const objective =
    goal.kind === 'mate' ? OBJECTIVE_BY_KIND.mate(goal.mateIn, goal.maxUserMoves) : goal.kind === 'single' ? (goal.maxUserMoves === 1 && ex.theme !== 'positional' ? ex.objective : OBJECTIVE_BY_KIND.single()) : OBJECTIVE_BY_KIND[goal.kind](goal.maxUserMoves);
  return {
    ...ex,
    kind: goal.kind,
    goal,
    tree,
    acceptableMoves: accepted,
    bestMove: accepted[0] ?? ex.bestMove,
    solutionLine: line.length ? line : ex.solutionLine,
    objective,
    ambiguous: accepted.length > 1,
    difficulty: estimateDifficulty(ex.fen, line.length ? line : ex.solutionLine, ex.theme, accepted.length),
    analysisDepth: tree.depth,
  };
}

/**
 * A deeper search (the solution tree) accepts the move played in the game:
 * a move flagged as an error at low depth can turn out fine, and then there
 * is no error to train (e.g. 15.Bxd7+ of the Opera game, a "blunder" at
 * depth 11, accepted at 16). Only a tree searched DEEPER than the analysis of
 * the position overrules it: a shallower tree (analysis set above the tree
 * cap of 16) must not discard an error the deeper analysis found (audit A5-1).
 */
export function acceptsPlayedMove(ex: Pick<Exercise, 'tree'>, playedUci: string, analysedDepth: number): boolean {
  if (!ex.tree || ex.tree.depth <= analysedDepth) return false;
  return ex.tree.accepted.some((m) => m.uci === playedUci);
}

/**
 * The move played already meets the exercise's goal, judged by the goal's own floor: a conversion
 * built from a move that kept the decisive advantage would accept that very move (Sprint 4.7, PD-2).
 * Goals without a floor (a hanging piece, a missed tactic) train a concrete fact and are kept.
 */
export function playedMeetsGoal(ex: Pick<Exercise, 'goal'>, playedWin: number): boolean {
  const floor = ex.goal ? keepWinOf(ex.goal) : undefined;
  return floor !== undefined && playedWin >= floor;
}

/**
 * Why the move played is no error to train from this exercise, or null when it is one: a deeper
 * search accepts it ('tree', Sprint 4.4) or it already meets the goal ('goal', Sprint 4.7, PD-2).
 * The same rule for the automatic derivation and the manual "create exercise" (review M1).
 */
export function noErrorToTrain(ex: Pick<Exercise, 'goal' | 'tree'>, played: Pick<MoveReview, 'uci' | 'winAfter'>, analysedDepth: number): 'tree' | 'goal' | null {
  if (acceptsPlayedMove(ex, played.uci, analysedDepth)) return 'tree';
  if (playedMeetsGoal(ex, played.winAfter)) return 'goal';
  return null;
}
