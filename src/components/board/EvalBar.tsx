import type { Score } from '../../types/domain';
import { evalBarFraction, formatScore } from '../../services/analysis/evaluation';

type Props = {
  score?: Score | undefined;
  orientation: 'white' | 'black';
  isPending?: boolean;
};

/** Vertical bar: White's share is the win expectancy from the engine score. */
export function EvalBar({ score, orientation, isPending = false }: Props) {
  const white = evalBarFraction(score);
  const label = score ? formatScore(score) : isPending ? '…' : '—';
  const whiteOnBottom = orientation === 'white';
  return (
    <div className="evalbar" role="meter" aria-label={`Avaliação ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(white * 100)} data-flipped={!whiteOnBottom}>
      <div className="evalbar-white" style={{ height: `${white * 100}%` }} />
      <span className="evalbar-label mono" data-side={white >= 0.5 ? 'w' : 'b'}>
        {label}
      </span>
    </div>
  );
}
