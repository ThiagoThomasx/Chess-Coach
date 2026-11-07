import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Color, Opening, OpeningLine } from '../../types/domain';
import { ChessBoard } from '../../components/board/ChessBoard';
import { isUserTurn, judgeOffBook, practiceOpponentMove, practiceUserMove, startPractice, type PracticeState } from '../../services/openings/practice';
import { recordOpeningAttempt } from '../../db/openingsRepo';
import { useSettings } from '../../hooks/useSettings';
import { getEngine } from '../../services/engine/engineService';
import { uciToSan } from '../../services/chess/position';

type Props = { opening: Opening; line: OpeningLine; side: Color };

const OPPONENT_DELAY_MS = 400;

/** Continuation drill: the app plays the opponent's moves, the user must find each of theirs. */
export function OpeningPractice({ opening, line, side }: Props) {
  const settings = useSettings();
  const [state, setState] = useState<PracticeState>(() => startPractice(line));
  const [result, setResult] = useState<{ kind: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [isOver, setIsOver] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userTurn = isUserTurn(state, side);
  const lineEnded = state.ply >= line.moves.length && !state.owed;

  useEffect(() => {
    if (isOver || userTurn || lineEnded) return;
    timer.current = setTimeout(() => setState((s) => practiceOpponentMove(line, s)), OPPONENT_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, isOver, userTurn, lineEnded, line]);

  const finish = (correct: boolean, errorPly?: number) => {
    setIsOver(true);
    void recordOpeningAttempt({ openingId: opening.id, lineId: line.id, at: Date.now(), correct, ...(errorPly !== undefined ? { errorPly } : {}) }, settings.srsIntervalsDays);
  };

  /** A move outside the line: playable ones end the drill without a failure; otherwise it counts as an error. */
  const handleDeviation = (uci: string, san: string, expected: string) => {
    const fenBefore = state.fen;
    const errorPly = state.ply + 1;
    setIsChecking(true);
    setResult({ kind: 'info', text: `${san} não é o lance da linha. Verificando com o motor…` });
    judgeOffBook(getEngine(), fenBefore, uci, settings.exerciseTolerance)
      .then((j) => {
        if (j.playable) {
          setIsOver(true);
          setResult({ kind: 'info', text: `${san} está fora do repertório, mas é jogável segundo o motor. A linha segue com ${expected}. Nenhum erro foi registrado.` });
        } else {
          setResult({ kind: 'bad', text: `${san} não é o lance da linha e perde ${Math.round(j.loss)} p.p. segundo o motor. O esperado era ${expected}. Esta linha será revisada mais cedo.` });
          finish(false, errorPly);
        }
      })
      .catch(() => {
        setResult({ kind: 'bad', text: `${san} não é o lance da linha. O esperado era ${expected}. Esta linha será revisada mais cedo.` });
        finish(false, errorPly);
      })
      .finally(() => setIsChecking(false));
  };

  const onMove = (uci: string): boolean => {
    if (isOver || isChecking || !userTurn) return false;
    const san = uciToSan(state.fen, uci) ?? uci;
    const { verdict, state: next } = practiceUserMove(line, state, san);
    if (verdict.kind === 'wrong') {
      handleDeviation(uci, san, verdict.expected);
      return false;
    }
    setState(next);
    if (verdict.kind === 'transposed') setResult({ kind: 'good', text: `${san} ✓ — transposição: a linha continua, e ${verdict.postponed} ainda deve ser jogado.` });
    else if (verdict.done) {
      setResult({ kind: 'good', text: 'Linha completa sem erros!' });
      finish(true);
    } else setResult({ kind: 'good', text: `${san} ✓` });
    return true;
  };

  const restart = () => {
    setState(startPractice(line));
    setResult(null);
    setIsOver(false);
  };

  const status = isOver ? 'Treino encerrado.' : isChecking ? 'Verificando o lance…' : userTurn ? 'Sua vez: jogue o próximo lance da linha.' : 'Adversário jogando…';
  return (
    <div className="stack">
      <ChessBoard fen={state.fen} orientation={side === 'w' ? 'white' : 'black'} onMove={onMove} lastMove={state.lastMove} id="opening-practice-board" />
      <div className="row">
        <span className="small muted">{status}</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={restart}>
          <RotateCcw size={14} /> Recomeçar
        </button>
      </div>
      {result && (
        <p className={`callout callout-${result.kind} small`} data-testid="opening-feedback">
          {result.text}
        </p>
      )}
    </div>
  );
}
