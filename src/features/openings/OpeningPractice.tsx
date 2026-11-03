import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { RotateCcw } from 'lucide-react';
import type { Color, Opening, OpeningLine } from '../../types/domain';
import { ChessBoard } from '../../components/board/ChessBoard';
import { checkPracticeMove, firstUserPly, validateLine } from '../../services/openings/practice';
import { recordOpeningAttempt } from '../../db/openingsRepo';
import { useSettings } from '../../hooks/useSettings';
import { uciToSan } from '../../services/chess/position';

type Props = { opening: Opening; line: OpeningLine; side: Color };

const OPPONENT_DELAY_MS = 400;

/** Continuation drill: the app plays the opponent's moves, the user must find each of theirs. */
export function OpeningPractice({ opening, line, side }: Props) {
  const settings = useSettings();
  const fens = validateLine(line.moves).fens;
  const [ply, setPly] = useState(0);
  const [result, setResult] = useState<{ kind: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [isOver, setIsOver] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isUserTurn = (p: number) => (p - firstUserPly(side)) % 2 === 0;

  useEffect(() => {
    if (isOver || ply >= line.moves.length || (ply - firstUserPly(side)) % 2 === 0) return;
    timer.current = setTimeout(() => setPly((p) => p + 1), OPPONENT_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [ply, isOver, line.moves.length, side]);

  const finish = (correct: boolean, errorPly?: number) => {
    setIsOver(true);
    void recordOpeningAttempt({ openingId: opening.id, lineId: line.id, at: Date.now(), correct, ...(errorPly !== undefined ? { errorPly } : {}) }, settings.srsIntervalsDays);
  };

  const onMove = (uci: string): boolean => {
    if (isOver || !isUserTurn(ply)) return false;
    const fen = fens[ply] as string;
    const san = uciToSan(fen, uci) ?? uci;
    const v = checkPracticeMove(line, ply, san);
    if (v.kind === 'wrong') {
      setResult({ kind: 'bad', text: `${san} não é o lance da linha. O esperado era ${v.expected}. Esta linha será revisada mais cedo.` });
      finish(false, ply + 1);
      return false;
    }
    setPly(ply + 1);
    if (v.done) {
      setResult({ kind: 'good', text: 'Linha completa sem erros!' });
      finish(true);
    } else setResult({ kind: 'good', text: `${san} ✓` });
    return true;
  };

  const restart = () => {
    setPly(0);
    setResult(null);
    setIsOver(false);
  };

  const fen = fens[Math.min(ply, fens.length - 1)] as string;
  const last = ply > 0 ? new Chess(fens[ply - 1]).move(line.moves[ply - 1] as string) : null;
  return (
    <div className="stack">
      <ChessBoard fen={fen} orientation={side === 'w' ? 'white' : 'black'} onMove={onMove} lastMove={last ? { from: last.from, to: last.to } : null} id="opening-practice-board" />
      <div className="row">
        <span className="small muted">
          {isOver ? 'Treino encerrado.' : isUserTurn(ply) ? 'Sua vez: jogue o próximo lance da linha.' : 'Adversário jogando…'}
        </span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={restart}>
          <RotateCcw size={14} /> Recomeçar
        </button>
      </div>
      {result && <p className={`callout callout-${result.kind} small`} data-testid="opening-feedback">{result.text}</p>}
    </div>
  );
}
