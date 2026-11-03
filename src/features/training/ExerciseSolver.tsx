import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Eye, Lightbulb, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import { getDb } from '../../db/database';
import { deleteExercise } from '../../db/trainingRepo';
import { useSettings } from '../../hooks/useSettings';
import { ChessBoard } from '../../components/board/ChessBoard';
import { THEME_LABEL } from '../../services/pedagogy/concepts';
import { SKILL_LABEL } from '../../services/adaptation/skills';
import { formatScore } from '../../services/analysis/evaluation';
import { uciLineToSan } from '../../services/chess/position';
import { MAX_HINTS } from '../../services/exercises/validate';
import { Difficulty } from './Difficulty';
import { useExerciseSession } from './useExerciseSession';
import type { Exercise, Settings } from '../../types/domain';

const KIND_LABEL = { single: 'Lance único', sequence: 'Sequência forçada', mate: 'Mate', conversion: 'Conversão', defense: 'Defesa' } as const;

export function ExerciseSolver() {
  const { exerciseId = '' } = useParams();
  const settings = useSettings();
  const ex = useLiveQuery(() => getDb().exercises.get(exerciseId), [exerciseId], null);
  if (ex === null) return <div className="page muted">Carregando…</div>;
  if (!ex) {
    return (
      <div className="page">
        <p className="callout callout-warn">Exercício não encontrado.</p>
        <Link to="/train">Voltar ao treino</Link>
      </div>
    );
  }
  return <Solver key={ex.id} ex={ex} settings={settings} />;
}

function Solver({ ex, settings }: { ex: Exercise; settings: Settings }) {
  const navigate = useNavigate();
  const s = useExerciseSession(ex, settings);
  const attempts = useLiveQuery(() => getDb().attempts.where('exerciseId').equals(ex.id).sortBy('at'), [ex.id], []);
  const nextDue = useLiveQuery(async () => (await getDb().exercises.where('srs.dueAt').belowOrEqual(Date.now()).toArray()).filter((e) => e.id !== ex.id).sort((a, b) => a.srs.dueAt - b.srs.dueAt)[0]?.id, [ex.id, s.nextDue]);
  const orientation = ex.sideToMove === 'w' ? 'white' : 'black';
  const done = s.status === 'solved' || s.status === 'failed' || s.status === 'revealed';
  const highlights = s.hintSquare ? { [s.hintSquare]: { boxShadow: 'inset 0 0 0 4px rgba(217,178,106,0.95)' } } : {};

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link to="/train" className="small row">
            <ArrowLeft size={14} /> Treino
          </Link>
          <h1 style={{ marginTop: '0.3rem' }}>{THEME_LABEL[ex.theme]}</h1>
          <p>{ex.objective}</p>
        </div>
        <div className="row">
          <span className="tag">{SKILL_LABEL[ex.skill]}</span>
          <Difficulty value={ex.difficulty} />
        </div>
      </header>
      <div className="solver">
        <div className="stack">
          <ChessBoard fen={s.fen} orientation={orientation} onMove={s.onMove} lastMove={s.lastMove} highlights={highlights} id="exercise-board" />
          <div className="xs faint">{ex.sideToMove === 'w' ? 'Brancas' : 'Pretas'} jogam. Arraste a peça ou clique na origem e no destino.</div>
        </div>
        <div className="stack">
          <section className="panel" aria-live="polite">
            <div className="panel-head">
              <h2>{s.status === 'checking' ? 'Verificando…' : 'Sua vez'}</h2>
              <span className="xs faint" data-testid="sequence-progress">
                {KIND_LABEL[s.progress.kind]} · lance {Math.min(s.progress.done + 1, s.progress.total)} de {s.progress.total} · dicas {s.hints}/{MAX_HINTS}
              </span>
            </div>
            {s.feedback ? (
              <p className={`callout callout-${s.feedback.kind} fade-in`} data-testid="exercise-feedback">
                {s.feedback.text}
              </p>
            ) : (
              <p className="small muted">Encontre o melhor lance. Você pode pedir dicas progressivas; elas são registradas separadamente do acerto independente.</p>
            )}
            {ex.ambiguous && <p className="xs faint" style={{ marginTop: '0.6rem' }}>Esta posição admite mais de uma solução dentro da tolerância de {ex.tolerance} p.p.; todas são aceitas, e lances fora da lista são verificados pelo motor.</p>}
            <div className="row" style={{ marginTop: '0.9rem' }}>
              <button className="btn" onClick={s.hint} disabled={s.status !== 'playing' || s.hints >= MAX_HINTS} data-testid="hint">
                <Lightbulb size={15} /> Dica
              </button>
              <button className="btn" onClick={s.reveal} disabled={s.status === 'solved' || s.status === 'revealed' || s.status === 'checking'} data-testid="reveal">
                <Eye size={15} /> Ver solução
              </button>
              <button className="btn" onClick={s.retry} disabled={!done}>
                <RotateCcw size={15} /> Resolver de novo
              </button>
              {nextDue && (
                <button className="btn btn-ghost" onClick={() => navigate(`/train/${nextDue}`)}>
                  <SkipForward size={15} /> Próximo pendente
                </button>
              )}
            </div>
            {s.nextDue && (
              <p className="xs muted" style={{ marginTop: '0.75rem' }} data-testid="next-review">
                Resultado salvo. Próxima revisão: {new Date(s.nextDue).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            )}
          </section>
          {done && (
            <section className="panel fade-in">
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
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>Origem e histórico</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (confirm('Excluir este exercício e seu histórico?')) void deleteExercise(ex.id).then(() => navigate('/train'));
                }}
              >
                <Trash2 size={14} /> Excluir
              </button>
            </div>
            {ex.gameId ? (
              <Link to={`/analysis/${ex.gameId}`} className="small">
                Partida de origem · meia-jogada {ex.ply}
              </Link>
            ) : (
              <span className="small muted">Exercício de abertura</span>
            )}
            <ul className="history" style={{ marginTop: '0.6rem' }}>
              {attempts.length === 0 && <li className="small muted">Nenhuma tentativa registrada.</li>}
              {attempts.map((a) => (
                <li key={a.id} className="small row">
                  {a.correct && !a.revealed ? <span className="tag tag-good">✓ acerto</span> : <span className="tag tag-bad">✗ {a.revealed ? 'solução vista' : 'erro'}</span>}
                  <span className="muted">{a.hintsUsed ? `${a.hintsUsed} dica(s)` : 'sem dica'}</span>
                  <span className="faint xs mono">
                    {Math.round(a.timeMs / 1000)}s · {new Date(a.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
