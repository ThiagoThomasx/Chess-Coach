import type { Color } from '../../types/domain';
import type { PlacedMoveBadge } from '../../services/analysis/moveBadge';

export interface LegendMove {
  from: string;
  to: string;
  /** Who played the highlighted move. */
  by: 'you' | 'opponent' | 'solution';
  san?: string;
}

type Props = {
  move: LegendMove | null;
  badge: PlacedMoveBadge | null;
  side: Color;
};

/** Explains what the board highlights mean, so the colors are never left to interpretation. */
export function BoardLegend({ move, badge, side }: Props) {
  const who = move?.by === 'you' ? 'Seu lance' : move?.by === 'solution' ? 'Lance da solução' : 'Último lance do adversário';
  const notation = move ? (move.san ?? `${move.from}→${move.to}`) : '';
  return (
    <div className="board-legend xs" data-testid="board-legend">
      {move ? (
        <span className="row" style={{ gap: '0.4rem' }}>
          <span className="swatch swatch-last" aria-hidden="true" />
          <span data-testid="legend-last-move">
            {who}: <strong className="mono">{notation}</strong>
          </span>
          {badge && move.by === 'you' && (
            <span className={`cls cls-${badge.cls}`} data-testid="legend-badge">
              <span aria-hidden="true">{badge.symbol}</span> {badge.label}
            </span>
          )}
        </span>
      ) : (
        <span className="faint">Posição inicial do exercício.</span>
      )}
      <span className="faint">Tabuleiro do lado das {side === 'w' ? 'Brancas' : 'Pretas'}.</span>
    </div>
  );
}
