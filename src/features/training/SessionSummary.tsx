import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { SKILL_LABEL } from '../../services/adaptation/skills';
import type { Recommendation } from '../../services/recommendations/recommend';
import type { SessionSummary as Summary } from '../../services/training/session';

type Props = {
  summary: Summary;
  next: Recommendation;
  onFinish: () => void;
  onContinue: (() => void) | null;
};

/** End-of-session report: raw counts of this session only, no percentages from a handful of attempts. */
export function SessionSummary({ summary, next, onFinish, onContinue }: Props) {
  const s = summary;
  return (
    <section className="panel fade-in session-summary" aria-labelledby="summary-title" data-testid="session-summary">
      <div className="panel-head">
        <h2 id="summary-title">Resumo da sessão</h2>
        <span className="xs faint">
          {s.done} de {s.planned} exercício(s) feitos
        </span>
      </div>
      <dl className="summary-counts">
        <div>
          <dt>Exercícios realizados</dt>
          <dd data-testid="sum-done">{s.done}</dd>
        </div>
        <div>
          <dt>Acertos sem ajuda</dt>
          <dd data-testid="sum-independent">{s.independent}</dd>
        </div>
        <div>
          <dt>Acertos com dicas</dt>
          <dd data-testid="sum-assisted">{s.assisted}</dd>
        </div>
        <div>
          <dt>Erros ou solução vista</dt>
          <dd data-testid="sum-failed">{s.failed}</dd>
        </div>
        <div>
          <dt>Revisões concluídas</dt>
          <dd data-testid="sum-reviews">{s.reviewsDone}</dd>
        </div>
        <div>
          <dt>Pulados</dt>
          <dd>{s.skipped}</dd>
        </div>
      </dl>
      <p className="small" style={{ marginTop: '0.75rem' }}>
        <span className="muted">Competências trabalhadas: </span>
        <span data-testid="sum-skills">{s.skills.length ? s.skills.map((k) => SKILL_LABEL[k]).join(', ') : 'nenhuma'}</span>
      </p>
      {s.pending > 0 && (
        <p className="xs muted" data-testid="sum-pending">
          Ainda falta(m) {s.pending} exercício(s). A sessão foi encerrada: para fazê-los nela, use "Continuar exercícios" antes de sair desta tela.
        </p>
      )}
      <hr className="divider" />
      <div className="stack" style={{ gap: '0.4rem' }} data-testid="session-next">
        <span className="xs faint">Próxima recomendação, já com os resultados desta sessão</span>
        <strong>{next.title}</strong>
        <p className="small muted" data-testid="session-next-message">
          {next.message}
        </p>
        <div className="row">
          <button className="btn btn-primary" onClick={onFinish} data-testid="finish-session">
            Concluir sessão
          </button>
          {onContinue && (
            <button className="btn" onClick={onContinue}>
              Continuar exercícios
            </button>
          )}
          <Link className="btn btn-ghost" to={next.action.to}>
            {next.action.label} <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  );
}
