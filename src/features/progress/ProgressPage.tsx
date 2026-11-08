import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/database';
import { estimateProfile, SKILLS, SKILL_LABEL } from '../../services/adaptation/skills';
import { analysesOverTime, attemptStats, errorDistribution, openingResults, openingStudy, themeCounts, toAnalyzedInputs } from '../../services/stats/stats';
import { findOpening } from '../../services/openings/library';
import { isDueReview } from '../../services/scheduling/srs';
import { useMinute } from '../../hooks/useMinute';
import { SkillProfile } from './SkillProfile';
import { ClassDistributionChart, CountByDayChart, SkillHistoryChart } from './ProgressCharts';
import { RecentPerformanceChart } from '../dashboard/RecentPerformanceChart';
import type { Skill } from '../../types/domain';

export function ProgressPage() {
  const data = useLiveQuery(async () => {
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
  const [skill, setSkill] = useState<Skill>('tactics');
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  // Re-rendered every minute, like the sidebar and the dashboard (audit AI-2).
  useMinute();
  if (!data) return <div className="page muted">Carregando…</div>;
  const now = Date.now();
  const inputs = toAnalyzedInputs(data.games, data.analyses);
  const withoutColor = inputs.filter((i) => !i.userColor).length;
  const profile = estimateProfile(data.events, now);
  const st = attemptStats(data.attempts);
  const themes = themeCounts(inputs);
  const openings = openingResults(data.games);
  const study = openingStudy(data.openingAttempts);
  // Same rule as the dashboard and the sidebar: new exercises are not reviews (Sprint 4.5, N3).
  const due = data.exercises.filter((e) => isDueReview(e.srs, now)).length;
  const reviewed = data.bookmarks.filter((b) => b.reviewedAt).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Evolução</h1>
          <p>Todas as métricas abaixo são derivadas dos registros salvos: partidas analisadas, tentativas de exercícios e treinos de abertura.</p>
        </div>
      </header>

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Acerto independente</span>
          <span className="stat-value">{st.independentRate === null ? '—' : `${Math.round(st.independentRate * 100)}%`}</span>
          <span className="stat-note">{st.total} tentativa(s)</span>
        </div>
        <div className="stat">
          <span className="stat-label">Resolvidos com dicas</span>
          <span className="stat-value">{st.assisted}</span>
          <span className="stat-note">{st.revealed} com solução revelada</span>
        </div>
        <div className="stat">
          <span className="stat-label">Revisões pendentes</span>
          <span className="stat-value">{due}</span>
          <span className="stat-note">exercícios vencidos</span>
        </div>
        <div className="stat">
          <span className="stat-label">Posições revisadas</span>
          <span className="stat-value">{reviewed}</span>
          <span className="stat-note">de {data.bookmarks.length} marcadas</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Perfil de competências</h2>
          <span className="xs faint">Estimativas, não ratings oficiais</span>
        </div>
        <SkillProfile profile={profile} />
        <details style={{ marginTop: '0.9rem' }}>
          <summary className="small muted touch-link" style={{ cursor: 'pointer' }}>
            Como o perfil é calculado
          </summary>
          <div className="small muted stack" style={{ marginTop: '0.5rem' }}>
            <p>
              Cada competência é a taxa de sucesso estimada por um modelo Beta-Binomial: começa em Beta(1,1) (sem opinião) e cada evidência soma peso × resultado. Exercícios têm peso 1 (acerto com dicas vale crédito parcial); lances de partidas têm peso menor (0,2 a 0,5), porque uma partida contém poucos exemplos de cada tema.
            </p>
            <p>
              A barra mostra a estimativa e o intervalo de credibilidade de 90%. Confiança: menos de 2 de peso = poucas evidências; menos de 6 = evidências iniciais; 10+ com estimativa ≥ 75% e limite inferior ≥ 60% = domínio provisório; queda recente de 20 pontos ou 30 dias sem prática = precisa revisar.
            </p>
          </div>
        </details>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Evolução por competência</h2>
            <select className="select" value={skill} onChange={(e) => setSkill(e.target.value as Skill)} aria-label="Competência">
              {SKILLS.map((s) => (
                <option key={s} value={s}>
                  {SKILL_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <SkillHistoryChart events={data.events} skill={skill} />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Desempenho nos exercícios</h2>
          </div>
          <RecentPerformanceChart attempts={data.attempts} days={60} />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Análises feitas por dia</h2>
          </div>
          <p className="xs muted">Dia em que cada análise foi concluída, e não o dia em que a partida foi jogada.</p>
          <CountByDayChart data={analysesOverTime(data.analyses)} name="Partidas analisadas" />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Distribuição dos seus lances</h2>
          </div>
          <ClassDistributionChart dist={errorDistribution(inputs)} />
          {withoutColor > 0 && (
            <p className="xs faint" data-testid="no-color-note">
              {withoutColor} partida(s) analisada(s) sem a sua cor definida não entram aqui. Defina a cor na lista de partidas.
            </p>
          )}
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Temas recorrentes nos erros</h2>
          </div>
          {themes.length === 0 && <p className="small muted">Nenhum tema identificado com evidência verificada.</p>}
          <div className="stack" style={{ gap: '0.4rem' }}>
            {themes.map((t) => (
              <div key={t.key}>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpenTheme(openTheme === t.key ? null : t.key)} aria-expanded={openTheme === t.key}>
                  {t.label} <span className="mono">({t.count})</span>
                </button>
                {openTheme === t.key && (
                  <div className="row xs" style={{ padding: '0.3rem 0.6rem' }}>
                    {t.refs.map((r) => (
                      <Link key={`${r.gameId}-${r.ply}`} className="tag tag-info" to={`/analysis/${r.gameId}?ply=${r.ply}`}>
                        {r.san}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Evolução por abertura</h2>
          </div>
          {openings.length === 0 && study.length === 0 && <p className="small muted">Defina sua cor nas partidas ou treine aberturas para ver dados aqui.</p>}
          {openings.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Abertura (suas partidas)</th>
                  <th>Partidas</th>
                  <th>Pontuação</th>
                </tr>
              </thead>
              <tbody>
                {openings.map((o) => (
                  <tr key={o.name}>
                    <td>{o.name}</td>
                    <td className="mono">{o.games}</td>
                    <td className="mono">{Math.round(o.score * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {study.length > 0 && (
            <table className="table" style={{ marginTop: '0.8rem' }}>
              <thead>
                <tr>
                  <th>Treino de linhas</th>
                  <th>Treinos</th>
                  <th>Sem erros</th>
                </tr>
              </thead>
              <tbody>
                {study.map((o) => (
                  <tr key={o.openingId}>
                    <td>{findOpening(o.openingId, data.custom)?.name ?? o.openingId}</td>
                    <td className="mono">{o.attempts}</td>
                    <td className="mono">{Math.round(o.correctRate * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
