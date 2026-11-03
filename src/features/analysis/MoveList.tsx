import { useEffect, useRef } from 'react';
import type { MoveReview } from '../../types/domain';
import type { PlyInfo } from '../../services/chess/position';
import { CLASS_LABEL, CLASS_SYMBOL } from '../../services/analysis/classify';

type Props = {
  plies: readonly PlyInfo[];
  reviews: ReadonlyMap<number, MoveReview>;
  currentPly: number;
  isInVariation: boolean;
  startsWithBlack: boolean;
  firstMoveNumber: number;
  onSelect: (ply: number) => void;
};

const MARKED = new Set(['inaccuracy', 'mistake', 'blunder']);

/** Main-line notation in SAN, grouped in move pairs, with classification marks. */
export function MoveList({ plies, reviews, currentPly, isInVariation, startsWithBlack, firstMoveNumber, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [currentPly]);

  const cells = startsWithBlack ? [null, ...plies] : [...plies];
  const rows: (PlyInfo | null)[][] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push([cells[i] ?? null, cells[i + 1] ?? null]);

  const cell = (p: PlyInfo | null, key: string) => {
    if (!p) return <span key={key} className="moves-empty" />;
    const r = reviews.get(p.ply);
    const showMark = r && MARKED.has(r.classification);
    return (
      <button key={key} aria-current={!isInVariation && currentPly === p.ply} onClick={() => onSelect(p.ply)} data-testid={`move-${p.ply}`}>
        <span>{p.san}</span>
        {showMark && r && (
          <span className={`mark mark-${r.classification}`} title={CLASS_LABEL[r.classification]}>
            {CLASS_SYMBOL[r.classification]}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="moves" ref={ref} role="list" aria-label="Lances da partida">
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'contents' }} role="listitem">
          <span className="num">{firstMoveNumber + i}.</span>
          {cell(row[0] ?? null, 'w')}
          {cell(row[1] ?? null, 'b')}
        </div>
      ))}
    </div>
  );
}
