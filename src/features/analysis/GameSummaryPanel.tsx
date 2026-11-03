import type { Game, MoveClass, MoveReview } from '../../types/domain';
import { summarize } from '../../services/analysis/gameAnalyzer';
import { ClassBadge } from '../../components/feedback/ClassBadge';

type Props = {
  game: Game;
  reviews: readonly MoveReview[];
};

const ORDER: MoveClass[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'inconclusive'];

export function GameSummaryPanel({ game, reviews }: Props) {
  const w = summarize(reviews, 'w');
  const b = summarize(reviews, 'b');
  const fmt = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));
  return (
    <section className="panel" aria-labelledby="summary-title">
      <div className="panel-head">
        <h2 id="summary-title">Resumo da partida</h2>
      </div>
      <div className="summary-grid">
        <span />
        <span className="xs faint">{game.headers.white}</span>
        <span className="xs faint">{game.headers.black}</span>
        {ORDER.map((c) => (
          <div key={c} style={{ display: 'contents' }}>
            <ClassBadge value={c} />
            <span className="num">{w.counts[c] ?? 0}</span>
            <span className="num">{b.counts[c] ?? 0}</span>
          </div>
        ))}
        <span className="small">Perda média de expectativa (p.p.)</span>
        <span className="num">{fmt(w.avgWinLoss)}</span>
        <span className="num">{fmt(b.avgWinLoss)}</span>
        <span className="small">Perda média em centipawns</span>
        <span className="num">{fmt(w.avgCpLoss, 0)}</span>
        <span className="num">{fmt(b.avgCpLoss, 0)}</span>
      </div>
      <p className="xs faint" style={{ marginTop: '0.75rem' }}>
        "Perda média de expectativa" é a média, por lance, da queda na expectativa de vitória (modelo logístico sobre a avaliação do motor). É uma métrica própria do ChessQuest e não equivale à "precisão" de outras plataformas.
      </p>
    </section>
  );
}
