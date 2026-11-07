import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ListChecks, Pause, SkipForward, Square, Target } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';
import { useToast } from '../../components/feedback/Toast';
import { EmptyState } from '../../components/feedback/EmptyState';
import { buildQueue, isPlanCurrent, newPlan, nextPending, REASON_LABEL, sessionResults, summarize, withSkipped, type QueueReason, type SessionPlan } from '../../services/training/session';
import { Solver } from './ExerciseSolver';
import { SessionSummary } from './SessionSummary';
import { clearPlan, loadPlan, savePlan } from './sessionStore';
import { useTrainingLoop, type TrainingLoop } from './useTrainingLoop';

function initialPlan(): SessionPlan | null {
  const p = loadPlan();
  if (p && isPlanCurrent(p, Date.now())) return p;
  if (p) clearPlan();
  return null;
}

export function SessionPage() {
  const loop = useTrainingLoop();
  const [plan, setPlan] = useState<SessionPlan | null>(initialPlan);
  if (!loop) return <div className="page muted">Carregando…</div>;
  if (!plan) return <SessionStart loop={loop} onStart={setPlan} />;
  return <ActiveSession loop={loop} plan={plan} onChange={setPlan} />;
}

function SessionStart({ loop, onStart }: { loop: TrainingLoop; onStart: (p: SessionPlan) => void }) {
  const settings = useSettings();
  const toast = useToast();
  const queue = useMemo(
    () => buildQueue({ exercises: loop.exercises, attempts: loop.attempts, recommendation: loop.recommendation, targets: loop.targets, dailyGoal: settings.dailyGoal, now: Date.now() }),
    [loop, settings.dailyGoal],
  );
  const counts = (r: QueueReason) => queue.filter((i) => i.reason === r).length;
  const start = () => {
    const plan = newPlan(queue, Date.now());
    if (!savePlan(plan)) toast('Não foi possível guardar a sessão neste navegador; ela vale até fechar a página.', 'warn');
    onStart(plan);
  };
  const rec = loop.recommendation;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link to="/train" className="small row touch-link">
            Treino
          </Link>
          <h1 style={{ marginTop: '0.3rem' }}>Sessão guiada</h1>
          <p>Uma fila curta, montada a partir da sua recomendação atual: primeiro as revisões vencidas, depois o foco recomendado e exercícios no seu nível.</p>
        </div>
      </header>
      <section className="panel" data-testid="session-plan">
        <h3>Recomendação atual</h3>
        <h2 style={{ marginTop: '0.2rem' }}>{rec.title}</h2>
        <p className="small muted" data-testid="session-rec-message">
          {rec.message}
        </p>
        <hr className="divider" />
        {queue.length === 0 ? (
          <EmptyState icon={<Target size={32} />} title="Não há exercícios para uma sessão agora" action={<Link className="btn" to="/train">Ver exercícios</Link>}>
            Nenhum exercício está vencido, no foco recomendado ou no seu nível sem ter sido resolvido. Analise mais partidas para gerar exercícios novos.
          </EmptyState>
        ) : (
          <>
            <ul className="session-plan-list">
              {(['due', 'focus', 'level'] as const).map((r) => (
                <li key={r}>
                  <span className="mono">{counts(r)}</span> {REASON_LABEL[r].toLowerCase()}
                </li>
              ))}
            </ul>
            {queue.length < settings.dailyGoal && (
              <p className="callout callout-info small" data-testid="session-shortfall">
                Há {queue.length} exercício(s) adequado(s) agora; sua meta diária é {settings.dailyGoal}. Nenhum exercício é repetido para completar a fila. <Link to="/train">Ver todos os exercícios</Link>
              </p>
            )}
            <div className="row" style={{ marginTop: '0.75rem' }}>
              <button className="btn btn-primary" onClick={start} data-testid="start-session">
                <ListChecks size={16} /> Iniciar sessão ({queue.length})
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ActiveSession({ loop, plan, onChange }: { loop: TrainingLoop; plan: SessionPlan; onChange: (p: SessionPlan | null) => void }) {
  const settings = useSettings();
  const navigate = useNavigate();
  const byId = useMemo(() => new Map(loop.exercises.map((e) => [e.id, e])), [loop.exercises]);
  // An exercise deleted after the plan was built simply leaves the session.
  const results = sessionResults(plan, loop.attempts).filter((r) => byId.has(r.exerciseId));
  const pending = nextPending(results);
  const [viewing, setViewing] = useState<string | null>(pending ?? null);
  const [showSummary, setShowSummary] = useState(!pending);
  const current = viewing && byId.get(viewing) && results.some((r) => r.exerciseId === viewing) ? viewing : pending;

  const update = (p: SessionPlan) => {
    savePlan(p);
    onChange(p);
  };
  const finish = () => {
    clearPlan();
    onChange(null);
    navigate('/');
  };
  // "Encerrar" ends the session: it is no longer stored, so leaving the summary any other
  // way never brings it back as active. "Continuar" from the summary stores it again.
  const end = () => {
    clearPlan();
    setShowSummary(true);
  };
  const resume = (id: string) => {
    savePlan(plan);
    setViewing(id);
    setShowSummary(false);
  };

  if (showSummary || !current) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Sessão guiada</h1>
            <p>Resultados registrados nesta sessão.</p>
          </div>
        </header>
        <SessionSummary
          summary={summarize(results, loop.exercises)}
          next={loop.recommendation}
          onFinish={finish}
          onContinue={pending ? () => resume(pending) : null}
        />
      </div>
    );
  }

  const ex = byId.get(current)!;
  const index = results.findIndex((r) => r.exerciseId === current);
  const result = results[index]!;
  const finished = results.filter((r) => r.outcome !== null || r.skipped).length;
  const advance = (p: SessionPlan) => {
    const next = nextPending(sessionResults(p, loop.attempts).filter((r) => byId.has(r.exerciseId) && r.exerciseId !== current));
    if (next) setViewing(next);
    else end();
  };
  const skip = () => {
    const p = withSkipped(plan, current);
    update(p);
    advance(p);
  };

  const header = (
    <div className="session-bar" data-testid="session-bar">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small">
          <strong data-testid="session-position">
            Exercício {index + 1} de {results.length}
          </strong>{' '}
          <span className="tag tag-info">{REASON_LABEL[result.reason]}</span>
        </span>
        <span className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/train')} title="A sessão fica guardada para hoje" data-testid="pause-session">
            <Pause size={14} /> Interromper
          </button>
          <button className="btn btn-ghost btn-sm" onClick={end} data-testid="end-session">
            <Square size={14} /> Encerrar
          </button>
        </span>
      </div>
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${(finished / Math.max(1, results.length)) * 100}%` }} />
      </div>
    </div>
  );
  const controls = (
    <div className="row" style={{ marginTop: '0.6rem' }}>
      {result.outcome !== null ? (
        <button className="btn btn-primary" onClick={() => advance(plan)} data-testid="session-next-exercise">
          <SkipForward size={15} /> {nextPending(results) ? 'Próximo exercício' : 'Ver resumo'}
        </button>
      ) : (
        <button className="btn btn-ghost" onClick={skip} data-testid="session-skip">
          <SkipForward size={15} /> Pular
        </button>
      )}
    </div>
  );
  return <Solver key={ex.id} ex={ex} settings={settings} session={{ header, controls }} />;
}
