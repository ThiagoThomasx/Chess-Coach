import { formatScore } from '../../services/analysis/evaluation';
import { uciLineToSan } from '../../services/chess/position';
import type { Exercise } from '../../types/domain';

/** Engine lines behind the exercise, shown only once the attempt has ended. */
export function ReferenceSolution({ ex }: { ex: Exercise }) {
  return (
    <section className="panel fade-in" data-testid="reference-solution">
      <h2>Solução de referência</h2>
      <div className="stack" style={{ gap: '0.4rem', marginTop: '0.6rem' }}>
        {ex.referenceLines.slice(0, 3).map((l) => (
          <div key={l.multipv} className="engine-line" style={{ cursor: 'default' }}>
            <span className="score mono">{formatScore(l.score)}</span>
            <span className="line-chip">{uciLineToSan(ex.fen, l.pv.slice(0, 8)).join(' ')}</span>
          </div>
        ))}
      </div>
      <p className="xs faint" style={{ marginTop: '0.6rem' }}>
        Lances aceitos: {ex.acceptableMoves.map((m) => m.san).join(', ')} · análise com profundidade {ex.analysisDepth}
      </p>
    </section>
  );
}
