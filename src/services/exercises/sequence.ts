import type { AcceptableMove, Color, Exercise, ExerciseGoal, ExerciseKind, PositionAnalysis, ReplyBranch, Score, SolutionNode, Theme } from '../../types/domain';
import { applyUci, sideToMove, terminalState, uciToSan } from '../chess/position';
import { settledSwing } from '../chess/material';
import { matedScore, winPercentFor } from '../analysis/evaluation';
import type { EngineLike } from '../analysis/gameAnalyzer';

/** Termination rules (documented in docs/METHODOLOGY.md). */
export const MAX_SEQUENCE_MOVES = 4;
export const MAX_REPLY_BRANCHES = 2;
/** Equivalent first moves expanded at the root (deeper alternatives are validated live). */
export const MAX_ROOT_EXPANSIONS = 2;

export interface TreeOptions {
  depth: number;
  multiPv: number;
  tolerance: number;
}

function stm(fen: string): Color {
  return sideToMove(fen);
}

/** Solver mate distance from a White-POV score, or null when the solver is not mating. */
function mateFor(score: Score, side: Color): number | null {
  if (score.kind !== 'mate') return null;
  if (side === 'w' ? score.value <= 0 : score.value >= 0) return null;
  return Math.ceil(Math.abs(score.value));
}

/**
 * Moves within `tolerance` win% of the best line, from the side to move's POV.
 * With `mateLimit`, only moves that keep a forced mate within that many moves
 * count (win% alone cannot tell mate in 2 from mate in 5).
 */
export function acceptedFrom(a: PositionAnalysis, tolerance: number, mateLimit?: number): AcceptableMove[] {
  const side = stm(a.fen);
  const best = a.lines[0];
  if (!best) return [];
  const bestWin = winPercentFor(best.score, side);
  return a.lines
    .filter((l) => l.pv[0] && bestWin - winPercentFor(l.score, side) <= tolerance)
    .filter((l) => mateLimit === undefined || (mateFor(l.score, side) ?? Infinity) <= mateLimit)
    .map((l) => ({ uci: l.pv[0] as string, san: uciToSan(a.fen, l.pv[0] as string) ?? (l.pv[0] as string), score: l.score }));
}

/** Score of a position without a search when the game is over (White POV). */
function terminalScore(fen: string): Score | null {
  const t = terminalState(fen);
  if (t === 'checkmate') return matedScore(stm(fen));
  if (t) return { kind: 'cp', value: 0 };
  return null;
}

/**
 * Picks the exercise kind and length from verifiable data: mate distance,
 * the user moves needed to reach a settled material gain in the best line,
 * the theme, and the win expectancy.
 */
export function goalFor(fen: string, best: { score: Score; pv: string[] }, theme: Theme, tolerance: number): ExerciseGoal {
  const me = stm(fen);
  const targetWin = winPercentFor(best.score, me);
  if (best.score.kind === 'mate' && (me === 'w' ? best.score.value > 0 : best.score.value < 0)) {
    const n = Math.ceil(Math.abs(best.score.value));
    return { kind: 'mate', maxUserMoves: Math.min(n, MAX_SEQUENCE_MOVES), targetWin, mateIn: n };
  }
  const defensive: Theme[] = ['allowed_mate', 'mate_threat', 'defense', 'ignored_threat', 'hanging_piece', 'removed_defender', 'pin'];
  if (defensive.includes(theme)) return { kind: 'defense', maxUserMoves: 1, targetWin };
  const swing = settledSwing(fen, best.pv, me);
  if (swing.settled && swing.delta >= 2) {
    const userMoves = Math.max(1, Math.min(3, Math.ceil(swing.plies / 2)));
    return { kind: userMoves > 1 ? 'sequence' : 'single', maxUserMoves: userMoves, targetWin };
  }
  if (targetWin >= 80 && targetWin - tolerance >= 70) return { kind: 'conversion', maxUserMoves: 2, targetWin };
  return { kind: 'single', maxUserMoves: 1, targetWin };
}

/**
 * Builds the solution tree with the engine: at each solver node, a MultiPV
 * search gives the accepted moves; the principal accepted move is expanded
 * into up to MAX_REPLY_BRANCHES equally good opponent defenses, recursively,
 * until the goal's move limit. Other accepted moves are validated live.
 */
export async function buildSolutionTree(engine: EngineLike, fen: string, goal: ExerciseGoal, opts: TreeOptions): Promise<SolutionNode> {
  const isMate = goal.kind === 'mate';
  const node = async (pos: string, movesLeft: number, isRoot: boolean): Promise<SolutionNode> => {
    const a = await engine.analyze({ fen: pos, depth: opts.depth, multiPv: opts.multiPv });
    const accepted = acceptedFrom(a, opts.tolerance, isMate ? movesLeft : undefined);
    const out: SolutionNode = { fen: pos, accepted, replies: {}, depth: a.depth };
    if (movesLeft <= 1) return out;
    for (const move of accepted.slice(0, isRoot ? MAX_ROOT_EXPANSIONS : 1)) {
      const afterUser = applyUci(pos, move.uci);
      if (!afterUser || terminalScore(afterUser)) {
        out.replies[move.uci] = [];
        continue;
      }
      const opp = await engine.analyze({ fen: afterUser, depth: opts.depth, multiPv: MAX_REPLY_BRANCHES });
      const branches: ReplyBranch[] = [];
      for (const r of acceptedFrom(opp, opts.tolerance).slice(0, MAX_REPLY_BRANCHES)) {
        const next = applyUci(afterUser, r.uci);
        if (!next) continue;
        branches.push({ uci: r.uci, san: r.san, score: r.score, next: terminalScore(next) ? null : await node(next, movesLeft - 1, false) });
      }
      out.replies[move.uci] = branches;
    }
    return out;
  };
  return node(fen, Math.min(goal.maxUserMoves, MAX_SEQUENCE_MOVES), true);
}

/** Converts a pre-v2 exercise (single line) into the tree representation. */
export function legacyTree(ex: Exercise): SolutionNode {
  const root: SolutionNode = { fen: ex.fen, accepted: ex.acceptableMoves, replies: {}, depth: ex.analysisDepth };
  let node = root;
  let fen = ex.fen;
  for (let i = 0; i + 2 < ex.solutionLine.length; i += 2) {
    const user = ex.solutionLine[i] as string;
    const reply = ex.solutionLine[i + 1] as string;
    const next = ex.solutionLine[i + 2] as string;
    const afterUser = applyUci(fen, user);
    const afterReply = afterUser ? applyUci(afterUser, reply) : null;
    if (!afterUser || !afterReply) break;
    const child: SolutionNode = { fen: afterReply, accepted: [{ uci: next, san: uciToSan(afterReply, next) ?? next, score: ex.bestMove.score }], replies: {}, depth: ex.analysisDepth };
    node.replies[user] = [{ uci: reply, san: uciToSan(afterUser, reply) ?? reply, score: ex.bestMove.score, next: child }];
    node = child;
    fen = afterReply;
  }
  return root;
}

export function normalizeExercise(ex: Exercise): Exercise & { kind: ExerciseKind; goal: ExerciseGoal; tree: SolutionNode } {
  const userMoves = Math.max(1, Math.ceil(ex.solutionLine.length / 2));
  const goal: ExerciseGoal = ex.goal ?? {
    kind: ex.bestMove.score.kind === 'mate' ? 'mate' : userMoves > 1 ? 'sequence' : 'single',
    maxUserMoves: userMoves,
    targetWin: winPercentFor(ex.bestMove.score, ex.sideToMove),
  };
  return { ...ex, kind: ex.kind ?? goal.kind, goal, tree: ex.tree ?? legacyTree(ex) };
}

// ---------------------------------------------------------------------------
// Solving

export interface SolveState {
  node: SolutionNode;
  userMoves: number;
  fen: string;
}

export type MoveVerdict =
  | { kind: 'illegal'; message: string }
  | { kind: 'rejected'; message: string; winLoss?: number }
  | { kind: 'unverifiable'; message: string }
  | { kind: 'solved'; message: string; fen: string }
  | { kind: 'continue'; message: string; reply: { uci: string; san: string }; state: SolveState };

export interface SolveDeps {
  engine?: EngineLike;
  /** Chooses among equally good opponent replies (default: random, for variety). */
  choose?: (options: number) => number;
  depth: number;
  tolerance: number;
  /** Set internally for mate goals: solver moves left including the current one. */
  mateMovesLeft?: number;
}

const randomPick = (n: number) => Math.floor(Math.random() * n);

/** Win% for the solver after its move, from the stored node or a fresh search. */
async function judge(state: SolveState, uci: string, after: string, solver: Color, deps: SolveDeps): Promise<{ ok: true; score: Score } | { ok: false; verdict: MoveVerdict }> {
  const known = state.node.accepted.find((m) => m.uci === uci);
  if (known) return { ok: true, score: known.score };
  const bestRef = state.node.accepted[0];
  const san = uciToSan(state.fen, uci) ?? uci;
  const term = terminalScore(after);
  const bestWin = bestRef ? winPercentFor(bestRef.score, solver) : null;
  if (term && bestWin !== null) {
    const loss = bestWin - winPercentFor(term, solver);
    return loss <= deps.tolerance ? { ok: true, score: term } : { ok: false, verdict: { kind: 'rejected', message: `${san} termina a partida sem atingir o objetivo.`, winLoss: loss } };
  }
  if (!deps.engine || bestWin === null) return { ok: false, verdict: { kind: 'unverifiable', message: `${san} não está entre os lances calculados e o motor não está disponível para verificá-lo.` } };
  let r: PositionAnalysis;
  try {
    r = await deps.engine.analyze({ fen: after, depth: deps.depth, multiPv: 1 });
  } catch {
    return { ok: false, verdict: { kind: 'unverifiable', message: `Não foi possível verificar ${san} com o motor agora.` } };
  }
  const line = r.lines[0];
  if (!line || !r.complete) return { ok: false, verdict: { kind: 'unverifiable', message: `A verificação de ${san} não terminou; tente novamente.` } };
  const loss = Math.max(0, bestWin - winPercentFor(line.score, solver));
  const movesLeftAfter = deps.mateMovesLeft !== undefined ? deps.mateMovesLeft - 1 : undefined;
  if (movesLeftAfter !== undefined && (mateFor(line.score, solver) ?? Infinity) > movesLeftAfter) {
    return { ok: false, verdict: { kind: 'rejected', message: `${san} não mantém o mate forçado dentro do limite do exercício.` } };
  }
  if (loss <= deps.tolerance) return { ok: true, score: line.score };
  return { ok: false, verdict: { kind: 'rejected', message: `${san} não resolve: a expectativa cai ${loss.toFixed(1)} p.p. em relação ao melhor lance (tolerância ${deps.tolerance}).`, winLoss: loss } };
}

/**
 * Validates one solver move and, if accepted, plays the opponent's reply.
 * Termination: checkmate; goal move limit reached; a terminal reply; or no
 * reply available without the engine (accepted, marked as not verifiable further).
 */
export async function playSolverMove(ex: Exercise & { goal: ExerciseGoal }, state: SolveState, uci: string, deps: SolveDeps): Promise<MoveVerdict> {
  const solver = ex.sideToMove;
  const san = uciToSan(state.fen, uci);
  const after = applyUci(state.fen, uci);
  if (!san || !after) return { kind: 'illegal', message: 'Lance ilegal.' };
  if (terminalState(after) === 'checkmate') return { kind: 'solved', message: `${san} — xeque-mate!`, fen: after };

  const limit = Math.min(ex.goal.maxUserMoves, MAX_SEQUENCE_MOVES);
  const judgeDeps = ex.goal.kind === 'mate' ? { ...deps, mateMovesLeft: limit - state.userMoves } : deps;
  const verdict = await judge(state, uci, after, solver, judgeDeps);
  if (!verdict.ok) return verdict.verdict;
  const userMoves = state.userMoves + 1;
  const isMain = state.node.accepted[0]?.uci === uci;
  const altNote = isMain ? '' : ' (alternativa equivalente aceita)';
  if (userMoves >= limit) {
    const done = ex.goal.kind === 'mate' ? `${san}${altNote}: o mate continua forçado dentro do limite do exercício.` : `${san}${altNote} — correto!`;
    return { kind: 'solved', message: done, fen: after };
  }

  // Opponent reply: from the tree when this move was expanded, otherwise from the engine.
  const branches = state.node.replies[uci];
  const choose = deps.choose ?? randomPick;
  if (branches && branches.length === 0) return { kind: 'solved', message: `${san}${altNote} — correto!`, fen: after };
  if (branches && branches.length > 0) {
    const b = branches[Math.min(branches.length - 1, choose(branches.length))] as ReplyBranch;
    const afterReply = applyUci(after, b.uci) as string;
    if (!b.next) return { kind: 'solved', message: `${san}${altNote} — correto! O adversário responde ${b.san} e a sequência termina.`, fen: afterReply };
    return { kind: 'continue', message: `${san}${altNote} — correto. O adversário responde ${b.san}.`, reply: { uci: b.uci, san: b.san }, state: { node: b.next, userMoves, fen: afterReply } };
  }
  if (!deps.engine) return { kind: 'solved', message: `${san}${altNote} — aceito. A continuação desta alternativa não pode ser verificada sem o motor.`, fen: after };
  try {
    const opp = await deps.engine.analyze({ fen: after, depth: deps.depth, multiPv: MAX_REPLY_BRANCHES });
    const replies = acceptedFrom(opp, deps.tolerance);
    const pick = replies[Math.min(replies.length - 1, choose(replies.length))];
    if (!pick) return { kind: 'solved', message: `${san}${altNote} — correto!`, fen: after };
    const afterReply = applyUci(after, pick.uci) as string;
    if (terminalScore(afterReply)) return { kind: 'solved', message: `${san}${altNote} — correto!`, fen: afterReply };
    const next = await deps.engine.analyze({ fen: afterReply, depth: deps.depth, multiPv: 3 });
    const node: SolutionNode = { fen: afterReply, accepted: acceptedFrom(next, deps.tolerance, ex.goal.kind === 'mate' ? limit - userMoves : undefined), replies: {}, depth: next.depth };
    return { kind: 'continue', message: `${san}${altNote} — correto. O adversário responde ${pick.san}.`, reply: { uci: pick.uci, san: pick.san }, state: { node, userMoves, fen: afterReply } };
  } catch {
    return { kind: 'solved', message: `${san}${altNote} — aceito. Não foi possível calcular a resposta do adversário agora.`, fen: after };
  }
}

/** Principal line of the tree (first accepted move, first reply), for "show solution". */
export function mainLine(tree: SolutionNode): string[] {
  const out: string[] = [];
  let node: SolutionNode | null = tree;
  while (node && node.accepted[0]) {
    const u: string = node.accepted[0].uci;
    out.push(u);
    const b: ReplyBranch | undefined = node.replies[u]?.[0];
    if (!b) break;
    out.push(b.uci);
    node = b.next;
  }
  return out;
}
