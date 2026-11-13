import type { AcceptableMove, Color, Exercise, ExerciseGoal, ExerciseKind, PositionAnalysis, ReplyBranch, Score, SolutionNode, Theme } from '../../types/domain';
import { applyUci, sideToMove, terminalState, uciToSan } from '../chess/position';
import { gainPlies, settledSwing } from '../chess/material';
import { matedScore, winPercentFor } from '../analysis/evaluation';
import type { EngineLike } from '../analysis/gameAnalyzer';
import { consequenceOf, refutationLine, type Refutation } from './refutation';

/** Termination rules (documented in docs/METHODOLOGY.md). */
export const MAX_SEQUENCE_MOVES = 4;
export const MAX_REPLY_BRANCHES = 2;
/** Equivalent first moves expanded at the root (deeper alternatives are validated live). */
export const MAX_ROOT_EXPANSIONS = 2;
/**
 * Defender replies count as equally good only within this many centipawns of
 * the best defense: win% saturates in lost positions, so a reply that drops a
 * piece (or speeds up the mate) would otherwise look "equivalent".
 */
export const DEFENSE_CP_MARGIN = 50;
/**
 * Above the tolerance, a loss up to this many points is too close to call
 * with a depth-limited search: the move is re-checked deeper and, if it stays
 * in this band, the verdict is "uncertain" instead of "wrong".
 */
export const UNCERTAIN_MARGIN = 3;
/** Extra depth for the re-check of a borderline move. */
const RECHECK_EXTRA_DEPTH = 4;

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

/**
 * The opponent's best defenses: the longest mate when being mated, otherwise
 * replies within DEFENSE_CP_MARGIN (and the win% tolerance) of the best one.
 */
export function defenseRepliesFrom(a: PositionAnalysis, tolerance: number): AcceptableMove[] {
  const side = stm(a.fen);
  const best = a.lines[0];
  if (!best) return [];
  const bestPov = povValue(best.score, side);
  return acceptedFrom(a, tolerance).filter((m) => {
    if (best.score.kind === 'mate' || m.score.kind === 'mate') return m.score.kind === best.score.kind && povValue(m.score, side) === bestPov;
    return bestPov - povValue(m.score, side) <= DEFENSE_CP_MARGIN;
  });
}

/** Score value from `side`'s point of view (mates keep their signed distance). */
function povValue(score: Score, side: Color): number {
  return side === 'w' ? score.value : -score.value;
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
export function goalFor(fen: string, best: { score: Score; pv: string[] }, theme: Theme, tolerance: number, motifSide?: 'own' | 'opponent'): ExerciseGoal {
  const me = stm(fen);
  const targetWin = winPercentFor(best.score, me);
  if (best.score.kind === 'mate' && (me === 'w' ? best.score.value > 0 : best.score.value < 0)) {
    const n = Math.ceil(Math.abs(best.score.value));
    return { kind: 'mate', maxUserMoves: Math.min(n, MAX_SEQUENCE_MOVES), targetWin, mateIn: n };
  }
  const defensive: Theme[] = ['allowed_mate', 'mate_threat', 'defense', 'ignored_threat', 'hanging_piece', 'removed_defender', 'pin'];
  // The opponent's tactic is something to prevent: the task is the defense.
  if (motifSide === 'opponent' || defensive.includes(theme)) return { kind: 'defense', maxUserMoves: 1, targetWin };
  const swing = settledSwing(fen, best.pv, me);
  const toGain = gainPlies(fen, best.pv, me);
  if (swing.settled && swing.delta >= 2 && toGain !== null) {
    // Length up to where the gain happens, not the measuring horizon.
    const userMoves = Math.max(1, Math.min(3, Math.ceil(toGain / 2)));
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
export async function buildSolutionTree(engine: EngineLike, fen: string, goal: ExerciseGoal, opts: TreeOptions, preferredFirst?: string): Promise<SolutionNode> {
  const isMate = goal.kind === 'mate';
  const limit = Math.min(goal.maxUserMoves, MAX_SEQUENCE_MOVES);
  // Mate budget can exceed the move limit (mate in 6 is played for 4 moves).
  const firstBudget = mateBudget(goal, 0);
  const node = async (pos: string, movesLeft: number, budget: number, isRoot: boolean): Promise<SolutionNode> => {
    const a = await engine.analyze({ fen: pos, depth: opts.depth, multiPv: opts.multiPv });
    const found = acceptedFrom(a, opts.tolerance, isMate ? budget : undefined);
    // Tied moves can come back reordered: keep the analysis main move first when it is still accepted.
    const accepted = isRoot && preferredFirst ? preferFirst(found, preferredFirst) : found;
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
      for (const r of defenseRepliesFrom(opp, opts.tolerance).slice(0, MAX_REPLY_BRANCHES)) {
        const next = applyUci(afterUser, r.uci);
        if (!next) continue;
        branches.push({ uci: r.uci, san: r.san, score: r.score, next: terminalScore(next) ? null : await node(next, movesLeft - 1, budget - 1, false) });
      }
      out.replies[move.uci] = branches;
    }
    return out;
  };
  return node(fen, limit, firstBudget, true);
}

function preferFirst(moves: AcceptableMove[], uci: string): AcceptableMove[] {
  const i = moves.findIndex((m) => m.uci === uci);
  return i <= 0 ? moves : [moves[i] as AcceptableMove, ...moves.slice(0, i), ...moves.slice(i + 1)];
}

/** Solver moves within which a mate goal must still force mate, after `userMoves` moves. */
export function mateBudget(goal: ExerciseGoal, userMoves: number): number {
  return (goal.mateIn ?? Math.min(goal.maxUserMoves, MAX_SEQUENCE_MOVES)) - userMoves;
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
  const tree = ex.tree ?? legacyTree(ex);
  // Trees stored before the mate-budget fix can have an empty root (mate in 5+).
  const safeTree = tree.accepted.length || !ex.acceptableMoves.length ? tree : { ...tree, accepted: ex.acceptableMoves };
  return { ...ex, kind: ex.kind ?? goal.kind, goal, tree: safeTree };
}

// ---------------------------------------------------------------------------
// Solving

export interface SolveState {
  node: SolutionNode;
  userMoves: number;
  fen: string;
}

/** White-POV scores of the reference move and of the user's move, from one comparison (feeds the move badge). */
export interface MoveAssessment {
  reference: Score;
  played: Score;
  depth: number;
}

export type MoveVerdict =
  | { kind: 'illegal'; message: string }
  /**
   * `consequence`: the loss in words (docs/METHODOLOGY.md); `refutation`: the opponent's line
   * from the same search that judged the move, absent when that search gave none.
   */
  | { kind: 'rejected'; message: string; winLoss?: number; assessment?: MoveAssessment; consequence?: string; refutation?: Refutation }
  | { kind: 'unverifiable'; message: string }
  /** Too close to the tolerance to call: nothing is recorded. */
  | { kind: 'uncertain'; message: string; winLoss: number }
  /** `reply`: the opponent move already applied in `fen`, when the line ended with one. */
  | { kind: 'solved'; message: string; fen: string; assessment?: MoveAssessment; reply?: { uci: string; san: string } }
  | { kind: 'continue'; message: string; reply: { uci: string; san: string }; state: SolveState; assessment?: MoveAssessment };

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

/** Score of the best move in the current position: stored, or searched when the node has none. */
async function referenceScore(state: SolveState, deps: SolveDeps): Promise<Score | null> {
  const stored = state.node.accepted[0];
  if (stored) return stored.score;
  if (!deps.engine) return null;
  try {
    const r = await deps.engine.analyze({ fen: state.fen, depth: deps.depth, multiPv: 1 });
    const line = r.lines[0];
    return line && r.complete ? line.score : null;
  } catch {
    return null;
  }
}

/** Loss of the user's move against the best one, and the solver's mate distance after it (root-move count). */
interface Measured {
  loss: number;
  /** Depth of the search the scores come from (the deeper recheck included; audit AC-6). */
  depth: number;
  score: Score;
  /** Score of the reference move in the same comparison. */
  reference: Score;
  /** Solver moves to mate counting the user's move, or null when not mating. */
  mateMoves: number | null;
  /** Lines of the user's move and of the reference move, only when both come from one comparable search. */
  pv?: string[];
  referencePv?: string[];
}

/**
 * Comparable measurement: one search from the current position restricted to
 * the reference move and the user's move (UCI searchmoves), so both scores
 * come from the same search at the same depth. Null when the engine did not
 * return the user's line (the caller falls back to searching the position after it).
 */
async function measureSameSearch(state: SolveState, uci: string, solver: Color, deps: SolveDeps & { engine: EngineLike }, depth: number): Promise<Measured | null> {
  const ref = state.node.accepted[0]?.uci;
  if (!ref) return null;
  const r = await deps.engine.analyze({ fen: state.fen, depth, multiPv: 2, searchMoves: [ref, uci] });
  if (!r.complete) return null;
  const mine = r.lines.find((l) => l.pv[0] === uci);
  const theirs = r.lines.find((l) => l.pv[0] === ref);
  if (!mine || !theirs) return null;
  const bestWin = winPercentFor(theirs.score, solver);
  return { loss: Math.max(0, bestWin - winPercentFor(mine.score, solver)), depth, score: mine.score, reference: theirs.score, mateMoves: mateFor(mine.score, solver), pv: mine.pv, referencePv: theirs.pv };
}

/** Fallback measurement: search the position after the move and compare with the stored reference. */
async function measureAfter(after: string, reference: Score, solver: Color, deps: SolveDeps & { engine: EngineLike }): Promise<Measured | null> {
  const bestWin = winPercentFor(reference, solver);
  const r = await deps.engine.analyze({ fen: after, depth: deps.depth, multiPv: 1 });
  const line = r.lines[0];
  if (!line || !r.complete) return null;
  const m = mateFor(line.score, solver);
  return { loss: Math.max(0, bestWin - winPercentFor(line.score, solver)), depth: deps.depth, score: line.score, reference, mateMoves: m === null ? null : m + 1 };
}

/** Win% for the solver after its move, from the stored node or a fresh search. */
async function judge(state: SolveState, uci: string, after: string, solver: Color, deps: SolveDeps): Promise<{ ok: true; score: Score; assessment: MoveAssessment } | { ok: false; verdict: MoveVerdict }> {
  const known = state.node.accepted.find((m) => m.uci === uci);
  const best = state.node.accepted[0];
  if (known && best) return { ok: true, score: known.score, assessment: { reference: best.score, played: known.score, depth: state.node.depth } };
  const san = uciToSan(state.fen, uci) ?? uci;
  const term = terminalScore(after);
  const reference = await referenceScore(state, deps);
  const bestWin = reference === null ? null : winPercentFor(reference, solver);
  if (term && reference !== null && bestWin !== null) {
    const loss = bestWin - winPercentFor(term, solver);
    const assessment = { reference, played: term, depth: deps.depth };
    return loss <= deps.tolerance ? { ok: true, score: term, assessment } : { ok: false, verdict: { kind: 'rejected', message: `${san} termina a partida sem atingir o objetivo.`, winLoss: loss, assessment } };
  }
  if (!deps.engine) return { ok: false, verdict: { kind: 'unverifiable', message: `${san} não está entre os lances calculados e o motor não está disponível para verificá-lo.` } };
  if (reference === null) return { ok: false, verdict: { kind: 'unverifiable', message: `Não foi possível calcular a referência desta posição para verificar ${san}; tente novamente.` } };
  const engineDeps = { ...deps, engine: deps.engine };
  const measure = async (depth: number): Promise<Measured | null> => (await measureSameSearch(state, uci, solver, engineDeps, depth)) ?? (await measureAfter(after, reference, solver, engineDeps));
  let m: Measured | null;
  try {
    m = await measure(deps.depth);
    // Borderline: re-check deeper before calling a reasonable move wrong.
    if (m && m.loss > deps.tolerance && m.loss <= deps.tolerance + UNCERTAIN_MARGIN) m = (await measure(deps.depth + RECHECK_EXTRA_DEPTH)) ?? m;
  } catch {
    return { ok: false, verdict: { kind: 'unverifiable', message: `Não foi possível verificar ${san} com o motor agora.` } };
  }
  if (!m) return { ok: false, verdict: { kind: 'unverifiable', message: `A verificação de ${san} não terminou; tente novamente.` } };
  const assessment: MoveAssessment = { reference: m.reference, played: m.score, depth: m.depth };
  if (deps.mateMovesLeft !== undefined && (m.mateMoves ?? Infinity) > deps.mateMovesLeft) {
    return { ok: false, verdict: { kind: 'rejected', message: `${san} não mantém o mate forçado dentro do limite do exercício.`, assessment } };
  }
  if (m.loss <= deps.tolerance) return { ok: true, score: m.score, assessment };
  if (m.loss <= deps.tolerance + UNCERTAIN_MARGIN) {
    return {
      ok: false,
      verdict: {
        kind: 'uncertain',
        message: `${san} fica ${m.loss.toFixed(1)} p.p. abaixo do melhor lance, perto do limite de ${deps.tolerance} p.p.: o motor não dá confiança suficiente para considerá-lo certo ou errado. A tentativa não será registrada.`,
        winLoss: m.loss,
      },
    };
  }
  return { ok: false, verdict: rejectedVerdict(state.fen, san, solver, m, assessment) };
}

/**
 * Rejection explained by its consequence (Sprint 4.6, B1). The refutation line comes only from
 * the comparable search; after the fallback search the text says it is the engine's estimate.
 */
function rejectedVerdict(fen: string, san: string, solver: Color, m: Measured, assessment: MoveAssessment): MoveVerdict {
  const consequence = consequenceOf({ fen, solver, played: m.score, reference: m.reference, ...(m.pv ? { pv: m.pv } : {}), ...(m.referencePv ? { referencePv: m.referencePv } : {}) });
  const line = m.pv ? refutationLine(fen, m.pv) : undefined;
  const reply = line?.[0];
  const message = m.pv ? `${san} não resolve: ${consequence}.${reply ? ` O adversário responde ${reply.san}.` : ''}` : `${san} não resolve: o motor avalia que ${consequence}.`;
  return { kind: 'rejected', message, winLoss: m.loss, assessment, consequence, ...(line ? { refutation: { line } } : {}) };
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
  if (terminalState(after) === 'checkmate') {
    const mated = terminalScore(after) as Score;
    return { kind: 'solved', message: `${san} — xeque-mate!`, fen: after, assessment: { reference: mated, played: mated, depth: deps.depth } };
  }

  const limit = Math.min(ex.goal.maxUserMoves, MAX_SEQUENCE_MOVES);
  const isMate = ex.goal.kind === 'mate';
  const judgeDeps = isMate ? { ...deps, mateMovesLeft: mateBudget(ex.goal, state.userMoves) } : deps;
  const verdict = await judge(state, uci, after, solver, judgeDeps);
  if (!verdict.ok) return verdict.verdict;
  const { assessment } = verdict;
  const userMoves = state.userMoves + 1;
  const isMain = state.node.accepted[0]?.uci === uci;
  const altNote = isMain ? '' : ' (alternativa equivalente aceita)';
  if (userMoves >= limit) {
    const done = isMate ? `${san}${altNote}: o mate continua forçado dentro do limite do exercício.` : `${san}${altNote} — correto!`;
    return { kind: 'solved', assessment, message: done, fen: after };
  }

  // Opponent reply: from the tree when this move was expanded, otherwise from the engine.
  const branches = state.node.replies[uci];
  const choose = deps.choose ?? randomPick;
  if (branches && branches.length === 0) return { kind: 'solved', assessment, message: `${san}${altNote} — correto!`, fen: after };
  if (branches && branches.length > 0) {
    const b = branches[Math.min(branches.length - 1, choose(branches.length))] as ReplyBranch;
    const afterReply = applyUci(after, b.uci) as string;
    if (!b.next) return { kind: 'solved', assessment, message: `${san}${altNote} — correto! O adversário responde ${b.san} e a sequência termina.`, fen: afterReply, reply: { uci: b.uci, san: b.san } };
    return { kind: 'continue', assessment, message: `${san}${altNote} — correto. O adversário responde ${b.san}.`, reply: { uci: b.uci, san: b.san }, state: { node: b.next, userMoves, fen: afterReply } };
  }
  if (!deps.engine) return { kind: 'solved', assessment, message: `${san}${altNote} — aceito. A continuação desta alternativa não pode ser verificada sem o motor.`, fen: after };
  try {
    const opp = await deps.engine.analyze({ fen: after, depth: deps.depth, multiPv: MAX_REPLY_BRANCHES });
    const replies = defenseRepliesFrom(opp, deps.tolerance);
    const pick = replies[Math.min(replies.length - 1, choose(replies.length))];
    if (!pick) return { kind: 'solved', assessment, message: `${san}${altNote} — correto!`, fen: after };
    const afterReply = applyUci(after, pick.uci) as string;
    if (terminalScore(afterReply)) return { kind: 'solved', assessment, message: `${san}${altNote} — correto!`, fen: afterReply, reply: { uci: pick.uci, san: pick.san } };
    const next = await deps.engine.analyze({ fen: afterReply, depth: deps.depth, multiPv: 3 });
    const node: SolutionNode = { fen: afterReply, accepted: acceptedFrom(next, deps.tolerance, isMate ? mateBudget(ex.goal, userMoves) : undefined), replies: {}, depth: next.depth };
    return { kind: 'continue', assessment, message: `${san}${altNote} — correto. O adversário responde ${pick.san}.`, reply: { uci: pick.uci, san: pick.san }, state: { node, userMoves, fen: afterReply } };
  } catch {
    return { kind: 'solved', assessment, message: `${san}${altNote} — aceito. Não foi possível calcular a resposta do adversário agora.`, fen: after };
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
