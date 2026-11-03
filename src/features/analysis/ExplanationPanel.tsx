import { useState } from 'react';
import { CheckCircle2, Dumbbell, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Game, MoveReview, PositionAnalysis, Settings } from '../../types/domain';
import { explainMove } from '../../services/pedagogy/explain';
import { FLAG_LABEL } from '../../services/analysis/classify';
import { formatScore } from '../../services/analysis/evaluation';
import { ClassBadge } from '../../components/feedback/ClassBadge';
import { buildExercise, checkCandidate } from '../../services/exercises/generate';
import { addExercise } from '../../db/trainingRepo';
import { useToast } from '../../components/feedback/Toast';

type Props = {
  game: Game;
  review: MoveReview | undefined;
  before: PositionAnalysis | null;
  after: PositionAnalysis | null;
  settings: Settings;
};

const SECTIONS: [keyof ReturnType<typeof explainMove>, string][] = [
  ['problem', 'Qual foi o problema'],
  ['betterAlternative', 'Alternativa melhor'],
  ['why', 'Por que era melhor'],
  ['consequence', 'Consequência'],
  ['concept', 'Conceito'],
  ['howToAvoid', 'Como evitar'],
];

export function ExplanationPanel({ game, review, before, after, settings }: Props) {
  const toast = useToast();
  const [createdId, setCreatedId] = useState<string | null>(null);
  if (!review) {
    return (
      <section className="panel">
        <h2>Explicação</h2>
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          Selecione um lance analisado para ver a avaliação e a explicação.
        </p>
      </section>
    );
  }
  const reply = after?.lines[0]?.pv ?? [];
  const e = explainMove(review, reply);
  const candidate = checkCandidate(review, before, settings.thresholds);
  const onlyNotRelevant = candidate.reasons.length === 1 && review.classification === 'inaccuracy';
  const canCreate = (candidate.ok || onlyNotRelevant) && !!before;

  const create = async () => {
    if (!before) return;
    const ex = buildExercise({ game, review, before, replyLine: reply, tolerance: settings.exerciseTolerance });
    if (!ex) {
      toast('Posição ambígua: o lance jogado está dentro da tolerância de alternativas aceitas.', 'warn');
      return;
    }
    const r = await addExercise(ex);
    setCreatedId(r.id);
    toast(r.added ? 'Exercício criado' : 'Já existe um exercício para esta posição', r.added ? 'good' : 'info');
  };

  return (
    <section className="panel fade-in" aria-labelledby="explain-title" data-testid="explanation">
      <div className="panel-head">
        <h2 id="explain-title">{e.title}</h2>
        <ClassBadge value={review.classification} />
      </div>
      <dl className="explain">
        <div>
          <dt>O que aconteceu</dt>
          <dd>{e.whatHappened}</dd>
        </div>
        {SECTIONS.map(([k, label]) => {
          const v = e[k];
          return typeof v === 'string' && v ? (
            <div key={k}>
              <dt>{label}</dt>
              <dd>{v}</dd>
            </div>
          ) : null;
        })}
      </dl>
      {review.flags.length > 0 && (
        <div className="row" style={{ marginTop: '0.75rem' }}>
          {review.flags.map((f) => (
            <span key={f} className="tag">
              {FLAG_LABEL[f]}
            </span>
          ))}
        </div>
      )}
      <hr className="divider" />
      <div className="row xs faint">
        {e.confidence === 'verified' ? <CheckCircle2 size={14} /> : <Info size={14} />}
        <span>
          {e.confidence === 'verified' ? 'Explicação baseada em fatos verificados no tabuleiro e na linha do motor.' : 'Explicação limitada: apenas a avaliação objetiva do motor está disponível.'}
        </span>
      </div>
      <div className="row xs faint" style={{ marginTop: '0.3rem' }}>
        <span className="mono">
          prof. {review.depth} · {formatScore(review.evalBefore)} → {formatScore(review.evalAfter)} · perda {review.winLoss.toFixed(1)} p.p. de expectativa
          {review.cpLoss !== undefined ? ` · ${review.cpLoss} cp` : ''}
        </span>
      </div>
      {(review.classification === 'inaccuracy' || review.classification === 'mistake' || review.classification === 'blunder') && (
        <div className="row" style={{ marginTop: '0.85rem' }}>
          <button className="btn" disabled={!canCreate} onClick={() => void create()} data-testid="create-exercise">
            <Dumbbell size={15} /> Criar exercício desta posição
          </button>
          {createdId && (
            <Link to={`/train/${createdId}`} className="small" data-testid="open-created-exercise">
              Resolver agora →
            </Link>
          )}
          {!canCreate && <span className="xs faint">{candidate.reasons.join('; ')}</span>}
        </div>
      )}
    </section>
  );
}
