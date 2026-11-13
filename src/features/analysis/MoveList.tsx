import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { MoveReview } from '../../types/domain';
import type { PlyInfo } from '../../services/chess/position';
import { CLASS_LABEL, CLASS_SYMBOL } from '../../services/analysis/classify';
import { exerciseHref } from '../../services/exercises/origin';

type Props = {
  plies: readonly PlyInfo[];
  reviews: ReadonlyMap<number, MoveReview>;
  currentPly: number;
  isInVariation: boolean;
  startsWithBlack: boolean;
  firstMoveNumber: number;
  /** Exercise derived from a move, by ply (Sprint 4.6, B2). */
  exercises?: ReadonlyMap<number, string>;
  onSelect: (ply: number) => void;
};

const MARKED = new Set(['inaccuracy', 'mistake', 'blunder']);

/** Main-line notation in SAN, grouped in move pairs, with classification marks and links to derived exercises. */
export function MoveList({ plies, reviews, currentPly, isInVariation, startsWithBlack, firstMoveNumber, exercises, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [currentPly]);

  const cells = startsWithBlack ? [null, ...plies] : [...plies];
  const rows: (PlyInfo | null)[][] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push([cells[i] ?? null, cells[i + 1] ?? null]);

  const cell = (p: PlyInfo | null, key: string, moveNumber: number) => {
    if (!p) return <span key={key} className="moves-empty" />;
    const r = reviews.get(p.ply);
    const showMark = r && MARKED.has(r.classification);
    const button = (
      <button key={key} aria-current={!isInVariation && currentPly === p.ply} onClick={() => onSelect(p.ply)} data-testid={`move-${p.ply}`}>
        <span>{p.san}</span>
        {showMark && r && (
          <span className={`mark mark-${r.classification}`} title={CLASS_LABEL[r.classification]}>
            {CLASS_SYMBOL[r.classification]}
          </span>
        )}
      </button>
    );
    const exerciseId = exercises?.get(p.ply);
    if (!exerciseId) return button;
    // A link cannot live inside the move button: both sit in one grid cell.
    const label = `${moveNumber}${p.color === 'w' ? '.' : '…'} ${p.san}`;
    return (
      <span key={key} className="move-cell">
        {button}
        <Link to={exerciseHref(exerciseId)} className="exercise-badge" aria-label={`Ex.: abrir o exercício do lance ${label}`} title="Este lance tem um exercício" data-testid={`move-exercise-${p.ply}`}>
          Ex.
        </Link>
      </span>
    );
  };

  return (
    <>
      <div className="moves" ref={ref} role="list" aria-label="Lances da partida">
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'contents' }} role="listitem">
            <span className="num">{firstMoveNumber + i}.</span>
            {cell(row[0] ?? null, 'w', firstMoveNumber + i)}
            {cell(row[1] ?? null, 'b', firstMoveNumber + i)}
          </div>
        ))}
      </div>
      {exercises && exercises.size > 0 && (
        <p className="xs faint moves-legend" data-testid="moves-exercise-legend">
          <span className="exercise-badge exercise-badge-static" aria-hidden="true">
            Ex.
          </span>{' '}
          lance com exercício criado a partir dele ({exercises.size})
        </p>
      )}
    </>
  );
}
