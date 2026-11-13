import { useState } from 'react';
import { CheckCircle2, Dumbbell, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Game, MoveReview, PositionAnalysis, Settings } from '../../types/domain';
import { ERROR_KIND_LABEL, explainMove } from '../../services/pedagogy/explain';
import { FLAG_LABEL } from '../../services/analysis/classify';
import { formatScore } from '../../services/analysis/evaluation';
import { ClassBadge } from '../../components/feedback/ClassBadge';
import { acceptsPlayedMove, buildExercise, checkCandidate } from '../../services/exercises/generate';
import { addExercise } from '../../db/trainingRepo';
import { useToast } from '../../components/feedback/Toast';
import { completeExercise } from '../../services/analysis/analysisRunner';
import { getEngine } from '../../services/engine/engineService';
import { exerciseHref } from '../../services/exercises/origin';

type Props = {
  game: Game;
  review: MoveReview | undefined;
  before: PositionAnalysis | null;
  after: PositionAnalysis | null;
  settings: Settings;
  /**
   * Exercise already derived from this move (Sprint 4.6, B2): the action opens it instead of creating one.
   * `null`: none; `undefined`: not known yet (no action is shown until it is).
   */
  linkedExerciseId?: string | null | undefined;
};

/** The six questions of an explanation, in reading order; empty sections are omitted. */
const SECTIONS: [keyof ReturnType<typeof explainMove>, string][] = [
  ['threat', 'Qual era a ameaça do adversário'],
  ['consequence', 'Por que o lance não funcionou'],
  ['betterAlternative', 'Melhor alternativa encontrada'],
  ['afterAlternative', 'O que acontece depois da alternativa'],
  ['why', 'Por que ela é superior'],
  ['concept', 'Conceito'],
  ['recognize', 'Como reconhecer situações semelhantes'],
];

const isError = (r: MoveReview) => r.classification === 'inaccuracy' || r.classification === 'mistake' || r.classification === 'blunder';

export function ExplanationPanel({ game, review, before, after, settings, linkedExerciseId }: Props) {
  const toast = useToast();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
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
    setIsCreating(true);
    try {
      const full = await completeExercise(ex, settings, getEngine());
      if (acceptsPlayedMove(full, review.uci, before.depth)) {
        toast('Numa verificação mais profunda, o lance jogado está entre os aceitos: não há erro a treinar nesta posição.', 'warn');
        return;
      }
      const r = await addExercise(full);
      setCreatedId(r.id);
      toast(r.added ? 'Exercício criado' : 'Já existe um exercício para esta posição', r.added ? 'good' : 'info');
    } catch {
      // Engine or storage failure: the transaction in addExercise rolled back, so nothing was stored.
      toast('Não foi possível salvar o exercício. Nada foi gravado; tente novamente.', 'bad');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className="panel fade-in" aria-labelledby="explain-title" data-testid="explanation">
      <div className="panel-head">
        <h2 id="explain-title">{e.title}</h2>
        <div className="row">
          <span className="tag" data-testid="error-kind">
            {ERROR_KIND_LABEL[e.kind]}
          </span>
          <ClassBadge value={review.classification} />
        </div>
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
          {e.confidence === 'verified'
            ? 'Explicação baseada em lances legais verificados e na linha do motor medida em posição estável.'
            : 'Explicação limitada: a causa não pôde ser verificada com segurança; vale a avaliação objetiva do motor.'}
        </span>
      </div>
      <div className="row xs faint" style={{ marginTop: '0.3rem' }}>
        <span className="mono">
          prof. {review.depth} · {formatScore(review.evalBefore)} → {formatScore(review.evalAfter)} · perda {review.winLoss.toFixed(1)} p.p. de expectativa
          {review.cpLoss !== undefined ? ` · ${review.cpLoss} cp` : ''}
        </span>
      </div>
      {linkedExerciseId ? (
        <div className="row" style={{ marginTop: '0.85rem' }}>
          <Link to={exerciseHref(linkedExerciseId)} className="btn" data-testid="open-exercise">
            <Dumbbell size={15} /> Abrir exercício
          </Link>
          <span className="xs faint">Esta posição já virou um exercício.</span>
        </div>
      ) : (
        linkedExerciseId === null &&
        isError(review) && (
          <div className="row" style={{ marginTop: '0.85rem' }}>
            <button className="btn" disabled={!canCreate || isCreating} onClick={() => void create()} data-testid="create-exercise">
              <Dumbbell size={15} /> {isCreating ? 'Calculando a sequência…' : 'Criar exercício desta posição'}
            </button>
            {/* Only when the stored exercise is not linked to this move: the same position already trained from another game. */}
            {createdId && (
              <Link to={exerciseHref(createdId)} className="small" data-testid="open-created-exercise">
                Resolver agora →
              </Link>
            )}
            {!canCreate && <span className="xs faint">{candidate.reasons.join('; ')}</span>}
          </div>
        )
      )}
    </section>
  );
}
