import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Library, Trash2 } from 'lucide-react';
import { getDb } from '../../db/database';
import { deleteGame } from '../../db/gamesRepo';
import { changeUserColor, derivationMessage } from '../../services/analysis/analysisRunner';
import { getEngine } from '../../services/engine/engineService';
import { useSettings } from '../../hooks/useSettings';
import { useToast } from '../../components/feedback/Toast';
import { ImportPanel } from './ImportPanel';
import { EmptyState } from '../../components/feedback/EmptyState';
import { matchOpening } from '../../services/openings/library';
import type { AnalysisStatus, Color, Game } from '../../types/domain';

const STATUS: Record<AnalysisStatus | 'none', { label: string; cls: string }> = {
  none: { label: 'Não analisada', cls: 'tag' },
  pending: { label: 'Pendente', cls: 'tag' },
  running: { label: 'Analisando', cls: 'tag tag-info' },
  paused: { label: 'Incompleta', cls: 'tag tag-warn' },
  complete: { label: 'Analisada', cls: 'tag tag-good' },
  error: { label: 'Erro', cls: 'tag tag-bad' },
};

function openingName(g: Game): string {
  return matchOpening(g.moves)?.opening.name ?? g.headers.opening ?? (g.headers.eco ? `ECO ${g.headers.eco}` : '—');
}

export function GamesPage() {
  const navigate = useNavigate();
  const games = useLiveQuery(() => getDb().games.orderBy('importedAt').reverse().toArray(), [], undefined);
  const statuses = useLiveQuery(async () => new Map((await getDb().analyses.toArray()).map((a) => [a.gameId, a.status])), [], new Map<string, AnalysisStatus>());
  const imports = useLiveQuery(() => getDb().imports.orderBy('importedAt').reverse().limit(10).toArray(), [], []);
  const settings = useSettings();
  const toast = useToast();

  /** Saves the color; an analyzed game gets its exercises and evidence right away. */
  const onColor = async (gameId: string, color: Color | undefined) => {
    try {
      const d = await changeUserColor(gameId, color, settings, getEngine);
      if (!d) {
        if (color && statuses.get(gameId) === 'running') toast('Cor salva. Os exercícios serão gerados quando a análise terminar.', 'info');
        return;
      }
      if (d.hasUserColor) toast(derivationMessage(d, 'Cor salva.'), 'good');
      else toast('Cor removida. Os lances desta partida deixam de contar no seu perfil.', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível salvar a cor.', 'bad');
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Partidas</h1>
          <p>Importe suas partidas em PGN. Elas ficam armazenadas neste navegador e podem ser analisadas lance a lance.</p>
        </div>
      </header>
      <div className="games-layout">
        <div className="stack">
          <ImportPanel />
          <section className="panel">
            <div className="panel-head">
              <h2>Histórico de importações</h2>
            </div>
            {imports.length === 0 ? (
              <p className="small muted">Nenhuma importação ainda.</p>
            ) : (
              <ul className="history">
                {imports.map((i) => (
                  <li key={i.id} className="small">
                    <span>{i.fileName}</span>
                    <span className="faint mono xs">{new Date(i.importedAt).toLocaleString('pt-BR')}</span>
                    <span className="muted xs">
                      {i.imported}/{i.totalFound} importadas{i.duplicates ? ` · ${i.duplicates} duplicadas` : ''}
                      {i.failures.length ? ` · ${i.failures.length} erros` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <section className="panel" aria-labelledby="games-title">
          <div className="panel-head">
            <h2 id="games-title">Suas partidas</h2>
            <span className="xs faint">{games?.length ?? 0} no total</span>
          </div>
          {games && games.length === 0 && (
            <EmptyState icon={<Library size={34} />} title="Nenhuma partida importada">
              Importe um arquivo PGN para começar. Você pode exportar suas partidas de qualquer plataforma de xadrez.
            </EmptyState>
          )}
          {games && games.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Partida</th>
                    <th>Resultado</th>
                    <th>Abertura</th>
                    <th>Você</th>
                    <th>Análise</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => {
                    const st = STATUS[statuses.get(g.id) ?? 'none'];
                    return (
                      <tr key={g.id} className="clickable" data-testid="game-row" onClick={() => navigate(`/analysis/${g.id}`)}>
                        <td>
                          {/* The row is clickable for the mouse; the link makes it reachable by keyboard and screen readers (audit M8). */}
                          <Link to={`/analysis/${g.id}`} className="game-link" data-testid="game-link" onClick={(e) => e.stopPropagation()}>
                            {g.headers.white} <span className="faint">×</span> {g.headers.black}
                          </Link>
                          <div className="xs faint">
                            {[g.headers.event, g.headers.date, g.headers.timeControl].filter(Boolean).join(' · ') || 'Sem metadados'}
                            {(g.headers.whiteElo || g.headers.blackElo) && ` · Elo PGN ${g.headers.whiteElo ?? '?'}/${g.headers.blackElo ?? '?'}`}
                          </div>
                        </td>
                        <td className="mono">{g.headers.result}</td>
                        <td className="small">{openingName(g)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <select
                            className="select"
                            aria-label="Cor usada por você"
                            value={g.userColor ?? ''}
                            onChange={(e) => void onColor(g.id, (e.target.value || undefined) as Color | undefined)}
                          >
                            <option value="">?</option>
                            <option value="w">Brancas</option>
                            <option value="b">Pretas</option>
                          </select>
                        </td>
                        <td>
                          <span className={st.cls}>{st.label}</span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            className="btn btn-ghost btn-icon"
                            aria-label="Excluir partida"
                            onClick={() => {
                              if (confirm('Excluir esta partida, sua análise e os exercícios derivados?')) void deleteGame(g.id);
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
