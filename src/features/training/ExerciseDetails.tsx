import { useNavigate } from 'react-router-dom';
import { ChevronDown, Trash2 } from 'lucide-react';
import { deleteExercise } from '../../db/trainingRepo';
import type { Attempt, Exercise } from '../../types/domain';
import { gameRef } from '../../services/exercises/origin';

type Props = {
  ex: Exercise;
  attempts: Attempt[];
  canDelete: boolean;
};

const when = (at: number) => new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function AttemptTag({ a }: { a: Attempt }) {
  return a.correct && !a.revealed ? <span className="tag tag-good">✓ acerto</span> : <span className="tag tag-bad">✗ {a.revealed ? 'solução vista' : 'erro'}</span>;
}

/** Secondary information (origin, history, tolerance): collapsed so it never competes with the task. */
export function ExerciseDetails({ ex, attempts, canDelete }: Props) {
  const navigate = useNavigate();
  const last = attempts.at(-1);
  return (
    <details className="panel details-panel" data-testid="exercise-details">
      <summary>
        <span className="details-title">Origem e histórico</span>
        <span className="xs faint" data-testid="last-attempt">
          {last ? (
            <>
              {attempts.length} tentativa(s) · última: <AttemptTag a={last} />
            </>
          ) : (
            'nenhuma tentativa ainda'
          )}
        </span>
        <ChevronDown size={16} className="details-chevron" aria-hidden="true" />
      </summary>
      <div className="stack" style={{ gap: '0.6rem', marginTop: '0.8rem' }}>
        {/* Plain text: the link back to the game's move is in the origin section, shown once the attempt is solved or revealed (B2). */}
        <span className="small muted" data-testid="details-origin">
          {gameRef(ex) ? `Exercício de uma partida sua · meia-jogada ${ex.ply}` : ex.source === 'opening' ? 'Exercício de abertura' : 'Exercício sem partida de origem'}
        </span>
        {ex.ambiguous && (
          <p className="xs faint">
            Esta posição admite mais de uma solução dentro da tolerância de {ex.tolerance} p.p.; todas são aceitas, e lances fora da lista são verificados pelo motor.
          </p>
        )}
        <p className="xs faint">As dicas são registradas separadamente do acerto independente.</p>
        <ul className="history">
          {attempts.length === 0 && <li className="small muted">Nenhuma tentativa registrada.</li>}
          {attempts.map((a) => (
            <li key={a.id} className="small row">
              <AttemptTag a={a} />
              <span className="muted">{a.hintsUsed ? `${a.hintsUsed} dica(s)` : 'sem dica'}</span>
              <span className="faint xs mono">
                {Math.round(a.timeMs / 1000)}s · {when(a.at)}
              </span>
            </li>
          ))}
        </ul>
        {canDelete && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              if (confirm('Excluir este exercício e seu histórico?')) void deleteExercise(ex.id).then(() => navigate('/train'));
            }}
          >
            <Trash2 size={14} /> Excluir exercício
          </button>
        )}
      </div>
    </details>
  );
}
