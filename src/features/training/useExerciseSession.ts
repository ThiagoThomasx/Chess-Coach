import { useEffect, useRef, useState } from 'react';
import type { Exercise, Settings } from '../../types/domain';
import { applyUci, uciToSan } from '../../services/chess/position';
import { hintFor, judgeWithEngine, MAX_HINTS, validateStep } from '../../services/exercises/validate';
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
 * Drives one solving session: validates moves, plays forced replies, offers
 * progressive hints, reveals/demonstrates the solution and persists the result.
 */
export function useExerciseSession(ex: Exercise, settings: Settings) {
  const [fen, setFen] = useState(ex.fen);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<SessionStatus>('playing');
  const [hints, setHints] = useState(0);
  const [hintSquare, setHintSquare] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [moves, setMoves] = useState<string[]>([]);
  const [nextDue, setNextDue] = useState<number | null>(null);
  const [retries, setRetries] = useState(0);
  const startedAt = useRef(Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const play = (from: string, uci: string): string => {
    const next = applyUci(from, uci) ?? from;
    setFen(next);
    setLastMove({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    return next;
  };

  const finish = async (correct: boolean, revealed: boolean, played: string[]) => {
    // A retry after a failure in the same session counts as assistance.
    const updated = await recordAttempt(
      ex,
      { exerciseId: ex.id, at: Date.now(), correct, hintsUsed: hints + retries, revealed, timeMs: Date.now() - startedAt.current, moves: played },
      settings.srsIntervalsDays,
    );
    setNextDue(updated.srs.dueAt);
  };

  const onMove = (uci: string): boolean => {
    if (status !== 'playing') return false;
    const verdict = validateStep(ex, step, fen, uci);
    const played = [...moves, uci];
    if (verdict.kind === 'incorrect') {
      setStatus('failed');
      setMoves(played);
      setFeedback({ kind: 'bad', text: verdict.message });
      void finish(false, false, played);
      return false;
    }
    if (verdict.kind === 'unknown') {
      void checkWithEngine(uci, played);
      return true;
    }
    const after = play(fen, uci);
    setMoves(played);
    setFeedback({ kind: 'good', text: verdict.message });
    if (verdict.kind === 'solved') {
      setStatus('solved');
      void finish(true, false, played);
    } else {
      setStep((s) => s + 1);
      timers.current.push(setTimeout(() => play(after, verdict.opponentMove), REPLY_DELAY_MS));
    }
    return true;
  };

  const checkWithEngine = async (uci: string, played: string[]) => {
    const san = uciToSan(fen, uci) ?? uci;
    const after = play(fen, uci);
    setStatus('checking');
    setFeedback({ kind: 'info', text: `Verificando ${san} com o motor…` });
    try {
      const r = await getEngine().analyze({ fen: after, depth: Math.min(ex.analysisDepth, settings.analysisDepth), multiPv: 1 });
      const j = judgeWithEngine(ex, r);
      setMoves(played);
      if (j.accepted) {
        setStatus('solved');
        setFeedback({ kind: 'good', text: `${san} também funciona: o motor avalia a posição dentro da tolerância (${j.winLoss.toFixed(1)} p.p. abaixo do melhor).` });
        void finish(true, false, played);
      } else {
        setStatus('failed');
        setFeedback({ kind: 'bad', text: `${san} não resolve: a expectativa cai ${Number.isFinite(j.winLoss) ? j.winLoss.toFixed(1) : '?'} p.p. em relação ao melhor lance.` });
        void finish(false, false, played);
      }
    } catch {
      setFen(fen);
      setStatus('playing');
      setFeedback({ kind: 'warn', text: `${san} não está entre os lances analisados e o motor não pôde verificá-lo agora. Tente outro lance.` });
    }
  };

  const hint = () => {
    if (status !== 'playing' || hints >= MAX_HINTS) return;
    const level = hints + 1;
    const h = hintFor(ex, level);
    setHints(level);
    setHintSquare(h.square ?? null);
    setFeedback({ kind: 'info', text: h.text });
  };

  const reveal = () => {
    if (status === 'solved' || status === 'revealed') return;
    const wasPlaying = status === 'playing';
    setStatus('revealed');
    setFeedback({ kind: 'warn', text: `Solução: ${ex.bestMove.san}. Demonstrando a sequência calculada…` });
    let cur = ex.fen;
    setFen(cur);
    ex.solutionLine.forEach((uci, i) => {
      timers.current.push(
        setTimeout(() => {
          cur = play(cur, uci);
        }, DEMO_STEP_MS * (i + 1)),
      );
    });
    if (wasPlaying) void finish(false, true, moves);
  };

  const retry = () => {
    timers.current.forEach(clearTimeout);
    setRetries((r) => (status === 'failed' || status === 'revealed' ? r + 1 : 0));
    setHints(0);
    setFen(ex.fen);
    setStep(0);
    setStatus('playing');
    setHintSquare(null);
    setFeedback(null);
    setLastMove(null);
    setMoves([]);
    setNextDue(null);
    startedAt.current = Date.now();
  };

  return { fen, status, hints, hintSquare, feedback, lastMove, nextDue, onMove, hint, reveal, retry };
}
