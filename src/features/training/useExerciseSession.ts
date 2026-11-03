import { useEffect, useMemo, useRef, useState } from 'react';
import type { Exercise, Settings } from '../../types/domain';
import { applyUci } from '../../services/chess/position';
import { hintForNode, MAX_HINTS } from '../../services/exercises/validate';
import { mainLine, normalizeExercise, playSolverMove, type SolveState } from '../../services/exercises/sequence';
import { recordAttempt } from '../../db/trainingRepo';
import { getEngine } from '../../services/engine/engineService';

export type SessionStatus = 'playing' | 'checking' | 'solved' | 'failed' | 'revealed';

export interface Feedback {
  kind: 'good' | 'bad' | 'info' | 'warn';
  text: string;
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
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [moves, setMoves] = useState<string[]>([]);
  const [nextDue, setNextDue] = useState<number | null>(null);
  const [retries, setRetries] = useState(0);
  const [practice, setPractice] = useState(false);
  const startedAt = useRef(Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const show = (pos: string, uci: string) => {
    setFen(pos);
    setLastMove({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  };

  const finish = async (correct: boolean, revealed: boolean, played: string[]) => {
    // A retry after a failure in the same session counts as assistance.
    const recorded = await recordAttempt(
      raw,
      { exerciseId: raw.id, at: Date.now(), correct, hintsUsed: hints + retries, revealed, timeMs: Date.now() - startedAt.current, moves: played },
      settings.srsIntervalsDays,
    );
    setPractice(recorded.practice);
    setNextDue(recorded.practice ? null : recorded.exercise.srs.dueAt);
  };

  const onMove = (uci: string): boolean => {
    if (status !== 'playing') return false;
    const after = applyUci(solve.fen, uci);
    if (!after) return false;
    const before = solve.fen;
    show(after, uci);
    setStatus('checking');
    const played = [...moves, uci];
    setMoves(played);
    const inTree = solve.node.accepted.some((m) => m.uci === uci);
    if (!inTree) setFeedback({ kind: 'info', text: 'Verificando o lance com o motor…' });
    void playSolverMove(ex, solve, uci, { engine: getEngine(), depth: Math.min(ex.analysisDepth, settings.analysisDepth), tolerance: ex.tolerance }).then((v) => {
      switch (v.kind) {
        case 'illegal':
        case 'unverifiable':
          setFen(before);
          setLastMove(null);
          setMoves(moves);
          setStatus('playing');
          setFeedback({ kind: 'warn', text: v.message });
          return;
        case 'rejected':
          setStatus('failed');
          setFeedback({ kind: 'bad', text: v.message });
          void finish(false, false, played);
          return;
        case 'solved':
          setFen(v.fen);
          setStatus('solved');
          setFeedback({ kind: 'good', text: v.message });
          void finish(true, false, played);
          return;
        case 'continue':
          setFeedback({ kind: 'good', text: v.message });
          setHintSquare(null);
          timers.current.push(
            setTimeout(() => {
              show(v.state.fen, v.reply.uci);
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
    setFeedback({ kind: 'info', text: h.text });
  };

  const reveal = () => {
    if (status === 'solved' || status === 'revealed' || status === 'checking') return;
    const wasPlaying = status === 'playing';
    const line = mainLine(ex.tree);
    setStatus('revealed');
    setFeedback({ kind: 'warn', text: `Solução: ${ex.tree.accepted.map((m) => m.san).join(' ou ')}. Demonstrando a sequência calculada…` });
    let cur = ex.fen;
    setFen(cur);
    setLastMove(null);
    line.forEach((uci, i) => {
      timers.current.push(
        setTimeout(() => {
          const next = applyUci(cur, uci);
          if (!next) return;
          cur = next;
          show(next, uci);
        }, DEMO_STEP_MS * (i + 1)),
      );
    });
    if (wasPlaying) void finish(false, true, moves);
  };

  const retry = () => {
    timers.current.forEach(clearTimeout);
    setRetries((r) => (status === 'failed' || status === 'revealed' ? r + 1 : 0));
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
    startedAt.current = Date.now();
  };

  return {
    fen,
    status,
    hints,
    hintSquare,
    feedback,
    lastMove,
    nextDue,
    practice,
    onMove,
    hint,
    reveal,
    retry,
    progress: { done: solve.userMoves, total: ex.goal.maxUserMoves, kind: ex.goal.kind },
  };
}
