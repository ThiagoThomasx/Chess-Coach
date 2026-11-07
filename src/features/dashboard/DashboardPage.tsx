import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ArrowRight, Bookmark, ChevronDown, Crown, FileUp, ListChecks } from 'lucide-react';
import { getDb } from '../../db/database';
import { useSettings } from '../../hooks/useSettings';
import { EmptyState } from '../../components/feedback/EmptyState';
import { nextTraining } from '../../services/recommendations/recommend';
import { estimateProfile } from '../../services/adaptation/skills';
import { attemptStats, openingStudy, themeCounts, themePerformance, toAnalyzedInputs } from '../../services/stats/stats';
import { THEME_LABEL } from '../../services/pedagogy/concepts';
import { findOpening } from '../../services/openings/library';
import { isDueReview } from '../../services/scheduling/srs';
import { RecentPerformanceChart } from './RecentPerformanceChart';
import { SkillStates } from './SkillStates';

function useDashboardData() {
  return useLiveQuery(async () => {
    const db = getDb();
    const [games, analyses, exercises, attempts, events, bookmarks, openingAttempts, custom] = await Promise.all([
      db.games.toArray(),
      db.analyses.toArray(),
      db.exercises.toArray(),
      db.attempts.orderBy('at').toArray(),
      db.skillEvents.toArray(),
      db.bookmarks.toArray(),
      db.openingAttempts.toArray(),
      db.customOpenings.toArray(),
    ]);
    return { games, analyses, exercises, attempts, events, bookmarks, openingAttempts, custom };
  }, []);
}

export function DashboardPage() {
  const settings = useSettings();
  const data = useDashboardData();
  if (!data) return <div className="page muted">Carregando…</div>;
  const now = Date.now();
  const { games, analyses, exercises, attempts, events, bookmarks, openingAttempts, custom } = data;

  if (games.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Bem-vindo ao ChessQuest</h1>
            <p>Seu treinador pessoal: analisa suas partidas com o Stockfish, explica seus erros e transforma-os em exercícios. Tudo roda neste dispositivo.</p>
          </div>
        </header>
        <section className="panel">
          <EmptyState icon={<Crown size={40} />} title="Comece importando uma partida" action={<Link className="btn btn-primary" to="/games"><FileUp size={16} /> Importar PGN</Link>}>
            Ainda não há dados. O painel mostrará estatísticas reais assim que você importar e analisar suas partidas — nenhum número é inventado.
          </EmptyState>
        </section>
      </div>
    );
  }

  const inputs = toAnalyzedInputs(games, analyses);
  const profile = estimateProfile(events, now);
  // Reviews only: a never-attempted exercise is new material, not a pending review.
  const due = exercises.filter((e) => isDueReview(e.srs, now)).length;
  const rec = nextTraining({ games: inputs, dueReviews: due, totalGames: games.length, profile, exercises, attempts });
  const st = attemptStats(attempts);
  const solved = new Set(attempts.filter((a) => a.correct && !a.revealed).map((a) => a.exerciseId)).size;
  const today = attempts.filter((a) => new Date(a.at).toDateString() === new Date(now).toDateString()).length;
  const topErrors = themeCounts(inputs).slice(0, 5);
  const bestThemes = themePerformance(exercises, attempts).filter((t) => t.attempts >= 3).slice(0, 3);
  const studied = openingStudy(openingAttempts).slice(0, 4);
  const pendingBookmarks = bookmarks.filter((b) => !b.reviewedAt).slice(0, 5);
  const maxErr = topErrors[0]?.count ?? 1;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Resumo do seu treino, calculado a partir dos registros salvos neste dispositivo.</p>
        </div>
        <div className="stack" style={{ gap: '0.3rem', minWidth: 200 }}>
          <span className="xs muted">
            Meta diária: {Math.min(today, settings.dailyGoal)}/{settings.dailyGoal} exercícios
          </span>
          <div className="progress">
            <span style={{ width: `${Math.min(100, (today / Math.max(1, settings.dailyGoal)) * 100)}%` }} />
          </div>
        </div>
      </header>

      <section className="next-training" aria-labelledby="next-title" data-testid="next-training">
        <h3>Seu próximo treino</h3>
        <h2 id="next-title">{rec.title}</h2>
        <p>{rec.message}</p>
        {rec.evidence.length > 0 && (
          <div className="row xs">
            <span className="faint">Baseado em:</span>
            {rec.evidence.slice(0, 6).map((e) => (
              <Link key={`${e.gameId}-${e.ply}`} to={`/analysis/${e.gameId}?ply=${e.ply}`} className="tag tag-info">
                {e.san}
              </Link>
            ))}
          </div>
        )}
        <div className="row">
          {exercises.length > 0 && (
            <Link className="btn btn-primary" to="/train/session" data-testid="start-session-link">
              <ListChecks size={15} /> Sessão guiada de hoje
            </Link>
          )}
          <Link className={exercises.length > 0 ? 'btn' : 'btn btn-primary'} to={rec.action.to}>
            {rec.action.label} <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Partidas analisadas</span>
          <span className="stat-value" data-testid="stat-analyzed">{inputs.length}</span>
          <span className="stat-note">
            de <span data-testid="stat-games">{games.length}</span> importada(s)
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Exercícios resolvidos</span>
          <span className="stat-value">{solved}</span>
          <span className="stat-note">de {exercises.length} disponíveis</span>
        </div>
        <div className="stat">
          <span className="stat-label">Acerto independente</span>
          <span className="stat-value">{st.independentRate === null ? '—' : `${Math.round(st.independentRate * 100)}%`}</span>
          <span className="stat-note" title="Tentativas resolvidas sem dica e sem ver a solução ÷ todas as tentativas">
            {st.total ? `${st.independent} de ${st.total} tentativas, sem dicas` : 'Sem tentativas ainda'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Revisões pendentes</span>
          <span className="stat-value">{due + pendingBookmarks.length}</span>
          <span className="stat-note">
            {due} exercício(s) · {bookmarks.filter((b) => !b.reviewedAt).length} posição(ões) marcada(s)
          </span>
        </div>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Desempenho recente</h2>
            <span className="xs faint">% de acerto independente por dia</span>
          </div>
          <RecentPerformanceChart attempts={attempts} />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Erros mais frequentes</h2>
            <Link to="/progress" className="xs">
              Detalhes
            </Link>
          </div>
          {topErrors.length === 0 ? (
            <p className="small muted">Nenhum erro com causa verificada nas partidas analisadas{inputs.some((i) => i.userColor) ? '' : ' (defina sua cor nas partidas)'}.</p>
          ) : (
            <div className="bar-list">
              {topErrors.map((t) => (
                <div key={t.key} className="item">
                  <span>{t.label}</span>
                  <span className="mono muted">{t.count}</span>
                  <div className="bar">
                    <span style={{ width: `${(t.count / maxErr) * 100}%`, background: 'var(--mistake)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <SkillStates profile={profile} />

      <details className="panel details-panel dash-more" data-testid="dash-more">
        <summary>
          <span className="details-title">Mais detalhes</span>
          <span className="xs faint">temas fortes, aberturas estudadas{pendingBookmarks.length > 0 ? ` · ${pendingBookmarks.length} posição(ões) marcada(s)` : ''}</span>
          <ChevronDown size={16} className="details-chevron" aria-hidden="true" />
        </summary>
        <div className="grid-3" style={{ marginTop: '0.8rem' }}>
          <section className="panel">
            <h2>Temas com melhor desempenho</h2>
            <div className="bar-list" style={{ marginTop: '0.75rem' }}>
              {bestThemes.length === 0 && <p className="small muted">É preciso ao menos 3 tentativas em um tema.</p>}
              {bestThemes.map((t) => (
                <div key={t.theme} className="item">
                  <span>{THEME_LABEL[t.theme]}</span>
                  <span className="mono muted">{Math.round(t.independentRate * 100)}%</span>
                  <div className="bar">
                    <span style={{ width: `${t.independentRate * 100}%`, background: 'var(--good)' }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Aberturas mais estudadas</h2>
            <div className="bar-list" style={{ marginTop: '0.75rem' }}>
              {studied.length === 0 && <p className="small muted">Nenhum treino de abertura ainda.</p>}
              {studied.map((o) => (
                <div key={o.openingId} className="item">
                  <span>{findOpening(o.openingId, custom)?.name ?? o.openingId}</span>
                  <span className="mono muted">{o.attempts}×</span>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Posições marcadas</h2>
            <div className="stack" style={{ marginTop: '0.75rem', gap: '0.4rem' }}>
              {pendingBookmarks.length === 0 && <p className="small muted">Marque posições na análise para revisá-las depois.</p>}
              {pendingBookmarks.map((b) => (
                <Link key={b.id} to={`/analysis/${b.gameId}?ply=${b.ply}`} className="small row">
                  <Bookmark size={13} /> Meia-jogada {b.ply}
                  <span className="faint xs">{new Date(b.createdAt).toLocaleDateString('pt-BR')}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}
