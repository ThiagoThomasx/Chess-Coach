import { ClassBadge } from '../../components/feedback/ClassBadge';
import type { MoveReview } from '../../types/domain';

type Props = {
  /** Displayed game move as "12. Nf3" / "12… Nc6"; undefined at the start position. */
  label: string | undefined;
  review: MoveReview | undefined;
  isInVariation: boolean;
  /** The better move drawn as a green arrow, if any. */
  betterSan: string | undefined;
};

/** One line saying what the board shows right now, and what its marks mean. */
export function CurrentMoveStrip({ label, review, isInVariation, betterSan }: Props) {
  if (isInVariation) {
    return (
      <div className="move-strip" data-testid="move-strip">
        <strong>Explorando uma variante</strong>
        <span className="faint">fora da partida; volte à linha principal para ver a avaliação dos lances jogados.</span>
      </div>
    );
  }
  if (!label) {
    return (
      <div className="move-strip" data-testid="move-strip">
        <strong>Posição inicial</strong>
        <span className="faint">avance com → ou toque em um lance da lista.</span>
      </div>
    );
  }
  return (
    <div className="move-strip" data-testid="move-strip">
      <strong className="mono">
        {label}
      </strong>
      {review ? <ClassBadge value={review.classification} /> : <span className="faint">sem avaliação ainda</span>}
      {betterSan && (
        <span className="move-strip-hint">
          <span className="swatch swatch-better" aria-hidden="true" /> seta verde: melhor era <strong className="mono">{betterSan}</strong>
        </span>
      )}
    </div>
  );
}
