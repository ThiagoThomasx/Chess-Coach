import { useEffect, useMemo, useRef, useState } from 'react';
import type { Exercise, Settings } from '../../types/domain';
import { applyUci, uciToSan } from '../../services/chess/position';
import { attemptResult, hintForNode, MAX_HINTS } from '../../services/exercises/validate';
import { mainLine, normalizeExercise, playSolverMove, type SolveState } from '../../services/exercises/sequence';
import { recordAttempt } from '../../db/trainingRepo';
import { getEngine } from '../../services/engine/engineService';
import { badgeForClass, solverMoveClass, type PlacedMoveBadge } from '../../services/analysis/moveBadge';
import type { MoveVerdict } from '../../services/exercises/sequence';
import { numberedLine, type RefutationMove } from '../../services/exercises/refutation';

/** 'uncertain': the engine could not judge the move with confidence; nothing is recorded. */
export type SessionStatus = 'playing' | 'checking' | 'solved' | 'failed' | 'revealed' | 'uncertain';

export interface Feedback {
  kind: 'good' | 'bad' | 'info' | 'warn';
  text: string;
  /** Rejected move: the opponent's line that punishes it, numbered SAN. */
  line?: string;
  /** Engine figures kept out of the main text (loss in p.p., tolerance, depth). */
  detail?: string;
}

/** A rejected move's refutation, replayable on the board from the position after the move. */
interface RefutationReplay {
  before: string;
  userUci: string;
  after: string;
  moves: RefutationMove[];
}

type RejectedVerdict = Extract<MoveVerdict, { kind: 'rejected' }>;

function rejectedFeedback(v: RejectedVerdict, after: string, tolerance: number): Feedback {
  const line = v.refutation ? numberedLine(after, v.refutation.line.map((m) => m.san)) : undefined;
  const depth = v.assessment ? `, profundidade ${v.assessment.depth}` : '';
  const detail = v.winLoss !== undefined ? `A expectativa cai ${v.winLoss.toFixed(1)} p.p. em relação ao melhor lance (tolerância ${tolerance} p.p.${depth}).` : undefined;
  return { kind: 'bad', text: v.message, ...(line ? { line } : {}), ...(detail ? { detail } : {}) };
}

const REPLY_DELAY_MS = 450;
const DEMO_STEP_MS = 700;

/**
 * Drives one solving session over the exercise's solution tree: validates each
 * move (stored lines or a fresh engine check), plays the opponent's reply,
 * continues until a termination rule, and persists the result.
 */
export function useExerciseSession(raw: Exercise, settings: Settings) {
  const ex = useMemo(() => normalizeExercise(raw), [raw]);
  const initial: SolveState = { node: ex.tree, userMoves: 0, fen: ex.fen };
  const [solve, setSolve] = useState<SolveState>(initial);
  const [fen, setFen] = useState(ex.fen);
  const [status, setStatus] = useState<SessionStatus>('playing');
  const [hints, setHints] = useState(0);
  const [hintSquare, setHintSquare] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string; san?: string } | null>(null);
  const [moves, setMoves] = useState<string[]>([]);
  const [nextDue, setNextDue] = useState<number | null>(null);
  const [retries, setRetries] = useState(0);
  const [practice, setPractice] = useState(false);
  const [badge, setBadge] = useState<PlacedMoveBadge | null>(null);
  const [refutation, setRefutation] = useState<RefutationReplay | null>(null);
  const [refutationShown, setRefutationShown] = useState(false);
  const startedAt = useRef(Date.now());
  /** This run already recorded a revealed attempt (solution shown, or the move named by the last hint). */
  const revealedRun = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** Shows the position after `uci` was played from `from`, highlighting that move. */
  const show = (from: string, pos: string, uci: string) => {
    const san = uciToSan(from, uci) ?? undefined;
    setFen(pos);
    setLastMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(san ? { san } : {}) });
  };

  /** Grades the user's move with the analysis rules, from the scores the verdict measured. */
  const gradeMove = (v: MoveVerdict, uci: string) => {
    const assessment = 'assessment' in v ? v.assessment : undefined;
    if (!assessment) return setBadge(null);
    const accepted = v.kind === 'solved' || v.kind === 'continue';
    const cls = solverMoveClass({ accepted, color: ex.sideToMove, ...assessment }, settings.thresholds);
    const b = cls ? badgeForClass(cls) : null;
    setBadge(b ? { ...b, square: uci.slice(2, 4) } : null);
  };

  /** The last hint names the move: from then on the attempt is a revealed solution, not a success. */
  const moveGiven = hints >= MAX_HINTS;

  const finish = async (correct: boolean, revealed: boolean, played: string[], hintsShown = hints) => {
    // Once the run is recorded as revealed, its end (solved, failed, solution shown) records nothing more.
    if (revealedRun.current) return;
    const result = attemptResult(correct, revealed, hintsShown);
    if (result.revealed) revealedRun.current = true;
    // A retry after a failure in the same session counts as assistance.
    const recorded = await recordAttempt(
      raw,
      { exerciseId: raw.id, at: Date.now(), ...result, hintsUsed: hintsShown + retries, timeMs: Date.now() - startedAt.current, moves: played },
      settings.srsIntervalsDays,
    );
    if (recorded.removed) {
      setNextDue(null);
      setFeedback({ kind: 'warn', text: 'Este exercício foi removido (troca de lado ou exclusão da partida). A tentativa não foi gravada.' });
      return;
    }
    setPractice(recorded.practice);
    setNextDue(recorded.practice ? null : recorded.exercise.srs.dueAt);
  };

  const onMove = (uci: string): boolean => {
    if (status !== 'playing') return false;
    const after = applyUci(solve.fen, uci);
    if (!after) return false;
    const before = solve.fen;
    show(before, after, uci);
    setStatus('checking');
    const played = [...moves, uci];
    setMoves(played);
    const inTree = solve.node.accepted.some((m) => m.uci === uci);
    setBadge(null);
    if (!inTree) setFeedback({ kind: 'info', text: 'Verificando o lance com o motor…' });
    void playSolverMove(ex, solve, uci, { engine: getEngine(), depth: Math.min(ex.analysisDepth, settings.analysisDepth), tolerance: ex.tolerance }).then((v) => {
      gradeMove(v, uci);
      switch (v.kind) {
        case 'illegal':
        case 'unverifiable':
          setFen(before);
          setLastMove(null);
          setMoves(moves);
          setStatus('playing');
          setFeedback({ kind: 'warn', text: v.message });
          return;
        case 'uncertain':
          setStatus('uncertain');
          setFeedback({ kind: 'warn', text: v.message });
          return;
        case 'rejected':
          setStatus('failed');
          setFeedback(rejectedFeedback(v, after, ex.tolerance));
          if (v.refutation) setRefutation({ before, userUci: uci, after, moves: v.refutation.line });
          void finish(false, false, played);
          return;
        case 'solved':
          if (v.reply) {
            // The line ended with the opponent's reply: highlight it, like a 'continue'.
            show(after, v.fen, v.reply.uci);
            if (v.reply.uci.slice(2, 4) === uci.slice(2, 4)) setBadge(null);
          } else {
            setFen(v.fen);
          }
          setStatus('solved');
          setFeedback(moveGiven ? { kind: 'warn', text: `${v.message} Como a dica mostrou o lance, esta tentativa conta como solução revelada.` } : { kind: 'good', text: v.message });
          void finish(true, false, played);
          return;
        case 'continue':
          setFeedback({ kind: 'good', text: v.message });
          setHintSquare(null);
          timers.current.push(
            setTimeout(() => {
              show(after, v.state.fen, v.reply.uci);
              // The reply may capture on the graded square: the badge would then mark the wrong piece.
              if (v.reply.uci.slice(2, 4) === uci.slice(2, 4)) setBadge(null);
              setSolve(v.state);
              setMoves([...played, v.reply.uci]);
              setStatus('playing');
            }, REPLY_DELAY_MS),
          );
      }
    });
    return true;
  };

  const hint = () => {
    if (status !== 'playing' || hints >= MAX_HINTS) return;
    const level = hints + 1;
    const h = hintForNode(solve.fen, ex.objective, solve.node.accepted, level);
    setHints(level);
    setHintSquare(h.square ?? null);
    setFeedback({ kind: 'info', text: level >= MAX_HINTS ? `${h.text} A partir de agora, esta tentativa conta como solução revelada.` : h.text });
    // Recorded when the move is shown, not when it is played: leaving or reloading the screen
    // afterwards must not turn the named move into an independent success (audit A2-1).
    if (level >= MAX_HINTS) void finish(false, true, moves, level);
  };

  const reveal = () => {
    if (status === 'solved' || status === 'revealed' || status === 'checking') return;
    const wasPlaying = status === 'playing';
    const line = mainLine(ex.tree);
    setStatus('revealed');
    setBadge(null);
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRefutationShown(false);
    setFeedback({ kind: 'warn', text: `Solução: ${ex.tree.accepted.map((m) => m.san).join(' ou ')}. Demonstrando a sequência calculada…` });
    let cur = ex.fen;
    setFen(cur);
    setLastMove(null);
    line.forEach((uci, i) => {
      timers.current.push(
        setTimeout(() => {
          const next = applyUci(cur, uci);
          if (!next) return;
          show(cur, next, uci);
          cur = next;
        }, DEMO_STEP_MS * (i + 1)),
      );
    });
    if (wasPlaying) void finish(false, true, moves);
  };

  /** Plays the refutation on the board after a rejected move. Display only: nothing is recorded. */
  const showRefutation = () => {
    if (status !== 'failed' || !refutation) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRefutationShown(true);
    // The line may move or capture the graded piece: the badge would then mark the wrong square.
    setBadge(null);
    show(refutation.before, refutation.after, refutation.userUci);
    let cur = refutation.after;
    refutation.moves.forEach((m, i) => {
      timers.current.push(
        setTimeout(() => {
          const next = applyUci(cur, m.uci);
          if (!next) return;
          show(cur, next, m.uci);
          cur = next;
        }, DEMO_STEP_MS * (i + 1)),
      );
    });
  };

  const retry = () => {
    timers.current.forEach(clearTimeout);
    setRefutation(null);
    setRefutationShown(false);
    // A run that saw the solution (or the move named by the last hint) makes the retry assisted (audit A2-2).
    setRetries((r) => (status === 'failed' || status === 'revealed' || revealedRun.current ? r + 1 : 0));
    revealedRun.current = false;
    setHints(0);
    setSolve(initial);
    setFen(ex.fen);
    setStatus('playing');
    setHintSquare(null);
    setFeedback(null);
    setLastMove(null);
    setMoves([]);
    setNextDue(null);
    setPractice(false);
    setBadge(null);
    startedAt.current = Date.now();
  };

  return {
    fen,
    status,
    hints,
    hintSquare,
    feedback,
    lastMove,
    badge,
    nextDue,
    practice,
    onMove,
    hint,
    reveal,
    retry,
    /** True when the failed move has a refutation line that can be shown on the board. */
    canShowRefutation: status === 'failed' && refutation !== null,
    showRefutation,
    refutationShown,
    /** Position after the rejected move while its refutation is on the board, else null. */
    refutationStart: refutationShown && refutation ? refutation.after : null,
    progress: { done: solve.userMoves, total: ex.goal.maxUserMoves, kind: ex.goal.kind },
  };
}
