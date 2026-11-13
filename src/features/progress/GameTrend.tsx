import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { TREND_MIN_GAMES, TREND_THRESHOLD, type SeriousErrorTrend } from '../../services/stats/stats';

type Props = { trend: SeriousErrorTrend };

const DIRECTION = {
  better: { text: 'Menos erros graves por partida.', cls: 'tag tag-good', Icon: TrendingDown },
  worse: { text: 'Mais erros graves por partida.', cls: 'tag tag-bad', Icon: TrendingUp },
  stable: { text: 'Estável em relação às partidas anteriores.', cls: 'tag', Icon: Minus },
} as const;

const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Minhas partidas estão melhorando?": serious errors per game, recent games against the ones before (Sprint 4.6, B3). */
export function GameTrend({ trend }: Props) {
  return (
    <section className="panel" aria-labelledby="game-trend-title" data-testid="game-trend">
      <div className="panel-head">
        <h2 id="game-trend-title">Minhas partidas estão melhorando?</h2>
        <span className="xs faint">Erros graves por partida</span>
      </div>
      <p className="xs muted">Conta os seus lances classificados como Erro ou Erro grave, por partida analisada com a sua cor definida, na ordem da data da partida.</p>
      {trend.kind === 'insufficient' ? (
        <p className="small muted" style={{ marginTop: '0.6rem' }} data-testid="game-trend-insufficient">
          Sem partidas suficientes: a comparação precisa de pelo menos {TREND_MIN_GAMES} partidas analisadas com a sua cor definida (há {trend.games}).
        </p>
      ) : (
        <TrendComparison trend={trend} />
      )}
    </section>
  );
}

function TrendComparison({ trend }: { trend: Extract<SeriousErrorTrend, { kind: 'compared' }> }) {
  const d = DIRECTION[trend.direction];
  // With 3 games per group one error decides the direction, and undated games may be misplaced in time:
  // in both cases the direction is shown without the good/bad color, and said so.
  const tagClass = trend.singleErrorDecides || trend.undatedGames > 0 ? 'tag' : d.cls;
  return (
    <div className="stack" style={{ gap: '0.6rem', marginTop: '0.6rem' }}>
      <div className="trend-compare">
        {/* In time order: the earlier games first, the recent ones on the right. */}
        <div className="stat">
          <span className="stat-label">{trend.previousGames} partidas anteriores</span>
          <span className="stat-value" data-testid="game-trend-previous">{fmt(trend.previous)}</span>
          <span className="stat-note">erros graves por partida</span>
        </div>
        <div className="stat">
          <span className="stat-label">Últimas {trend.recentGames} partidas</span>
          <span className="stat-value" data-testid="game-trend-recent">{fmt(trend.recent)}</span>
          <span className="stat-note">erros graves por partida</span>
        </div>
      </div>
      <p className="row small" style={{ gap: '0.5rem' }}>
        <span className={tagClass} data-testid="game-trend-direction">
          <d.Icon size={14} aria-hidden="true" /> {d.text}
        </span>
      </p>
      {trend.singleErrorDecides && (
        <p className="xs muted" data-testid="game-trend-small-sample">
          Amostra pequena: com {trend.window} partidas em cada grupo, um único erro a mais ou a menos já muda a média em {(1 / trend.window).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}. Importe e analise mais partidas para uma comparação mais firme.
        </p>
      )}
      {trend.undatedGames > 0 && (
        <p className="xs muted" data-testid="game-trend-undated">
          {trend.undatedGames} {trend.undatedGames === 1 ? 'partida comparada não tem data' : 'partidas comparadas não têm data'} no PGN e {trend.undatedGames === 1 ? 'entra' : 'entram'} como as mais antigas. Se foram jogadas há pouco, a direção pode estar invertida.
        </p>
      )}
      <p className="xs faint" data-testid="game-trend-sample">
        Comparação: últimas {trend.recentGames} vs. {trend.previousGames} partidas anteriores. Diferenças menores que {TREND_THRESHOLD.toLocaleString('pt-BR')} erro por partida contam como estáveis. Mostra uma tendência das suas partidas, não a causa dela.
      </p>
    </div>
  );
}
