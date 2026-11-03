import type { MoveClass } from '../../types/domain';
import { CLASS_LABEL, CLASS_SYMBOL } from '../../services/analysis/classify';

type Props = {
  value: MoveClass;
  isCompact?: boolean;
};

/** Classification shown with symbol + text, never color alone. */
export function ClassBadge({ value, isCompact = false }: Props) {
  return (
    <span className={`cls cls-${value}`} title={CLASS_LABEL[value]}>
      <span aria-hidden="true">{CLASS_SYMBOL[value]}</span>
      {isCompact ? <span className="sr-only">{CLASS_LABEL[value]}</span> : <span>{CLASS_LABEL[value]}</span>}
    </span>
  );
}
