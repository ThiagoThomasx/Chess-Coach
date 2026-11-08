import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Eye, Lightbulb, RotateCcw, SkipForward } from 'lucide-react';
import { getDb } from '../../db/database';
import { useSettings } from '../../hooks/useSettings';
import { ChessBoard } from '../../components/board/ChessBoard';
import { THEME_LABEL } from '../../services/pedagogy/concepts';
import { SKILL_LABEL } from '../../services/adaptation/skills';
import { sideToMove } from '../../services/chess/position';
import { lastMoveBefore } from '../../services/exercises/context';
import { MAX_HINTS } from '../../services/exercises/validate';
import { Difficulty } from './Difficulty';
import { TaskPrompt } from './TaskPrompt';
import { BoardLegend, type LegendMove } from './BoardLegend';
import { ReferenceSolution } from './ReferenceSolution';
import { ExerciseDetails } from './ExerciseDetails';
import { useExerciseSession, type SessionStatus } from './useExerciseSession';
import type { Exercise, Settings } from '../../types/domain';

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

type SolverProps = {
  ex: Exercise;
  settings: Settings;
  /** Inside a guided session: replaces the back link, and the session drives navigation. */
  session?: { header: ReactNode; controls: ReactNode };
};

const ENDED: readonly SessionStatus[] = ['solved', 'failed', 'revealed', 'uncertain'];

export function Solver({ ex, settings, session }: SolverProps) {
  const navigate = useNavigate();
  const s = useExerciseSession(ex, settings);
  const attempts = useLiveQuery(() => getDb().attempts.where('exerciseId').equals(ex.id).sortBy('at'), [ex.id], []);
  const nextDue = useLiveQuery(async () => (await getDb().exercises.where('srs.dueAt').belowOrEqual(Date.now()).toArray()).filter((e) => e.id !== ex.id).sort((a, b) => a.srs.dueAt - b.srs.dueAt)[0]?.id, [ex.id, s.nextDue]);
  const game = useLiveQuery(() => (ex.gameId ? getDb().games.get(ex.gameId) : undefined), [ex.gameId]);
  const orientation = ex.sideToMove === 'w' ? 'white' : 'black';
  const done = ENDED.includes(s.status);
  const highlights = s.hintSquare ? { [s.hintSquare]: { boxShadow: 'inset 0 0 0 4px rgba(217,178,106,0.95)' } } : {};

  // Before the first move, the highlight shows the opponent move that led here (only when the game confirms it).
  const previous = s.lastMove === null && s.fen === ex.fen ? lastMoveBefore(game, ex.ply, ex.fen) : null;
  const shownMove = s.lastMove ?? (previous ? { from: previous.from, to: previous.to } : null);
  const mover = sideToMove(s.fen) === 'w' ? 'b' : 'w';
  const moverRole: LegendMove['by'] = mover !== ex.sideToMove ? 'opponent' : s.status === 'revealed' ? 'solution' : 'you';
  const legendMove: LegendMove | null = previous ? { from: previous.from, to: previous.to, by: 'opponent', san: previous.san } : s.lastMove ? { ...s.lastMove, by: moverRole } : null;

  const needsSolution = s.status === 'failed' || s.status === 'uncertain';
  const showNextPending = !session && !!nextDue && done;
  const retryClass = session || showNextPending || needsSolution ? 'btn btn-ghost' : 'btn btn-primary';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          {session ? (
            session.header
          ) : (
            <Link to="/train" className="small row touch-link">
              <ArrowLeft size={14} /> Treino
            </Link>
          )}
          {/* The theme gives the motif away: it is shown only once an attempt has ended. */}
          <h1 style={{ marginTop: '0.3rem' }} data-testid="exercise-title">
            {done || attempts.length > 0 ? THEME_LABEL[ex.theme] : 'Exercício'}
          </h1>
        </div>
        <div className="row">
          <span className="tag">{SKILL_LABEL[ex.skill]}</span>
          <Difficulty value={ex.difficulty} />
        </div>
      </header>
      <div className="solver">
        <div className="solver-prompt">
          <TaskPrompt status={s.status} side={ex.sideToMove} objective={ex.objective} progress={s.progress} hints={s.hints} maxHints={MAX_HINTS} />
        </div>
        <div className="solver-board stack" style={{ gap: '0.5rem' }}>
          <ChessBoard fen={s.fen} orientation={orientation} onMove={s.onMove} lastMove={shownMove} highlights={highlights} badge={s.badge} id="exercise-board" />
          <BoardLegend move={legendMove} badge={s.badge} side={ex.sideToMove} />
        </div>
        <div className="solver-side stack">
          <section className="panel action-panel" aria-label="Ações do exercício">
            {s.feedback && (
              <p className={`callout callout-${s.feedback.kind} fade-in`} role="status" aria-live="polite" data-testid="exercise-feedback">
                {s.feedback.text}
              </p>
            )}
            <div className="row action-row">
              {s.status === 'playing' && (
                <>
                  <button
                    className="btn"
                    onClick={s.hint}
                    disabled={s.hints >= MAX_HINTS}
                    data-testid="hint"
                    title={s.hints === MAX_HINTS - 1 ? 'A última dica mostra o lance: a tentativa passa a contar como solução revelada.' : undefined}
                  >
                    <Lightbulb size={15} /> {s.hints === 0 ? 'Pedir dica' : s.hints === MAX_HINTS - 1 ? 'Mostrar o lance (conta como revelada)' : `Mais uma dica (${s.hints}/${MAX_HINTS})`}
                  </button>
                  <button className="btn btn-ghost" onClick={s.reveal} data-testid="reveal">
                    <Eye size={15} /> Ver solução
                  </button>
                </>
              )}
              {needsSolution && (
                <button className={session ? 'btn' : 'btn btn-primary'} onClick={s.reveal} data-testid="reveal">
                  <Eye size={15} /> Ver solução
                </button>
              )}
              {showNextPending && (
                <button className={needsSolution ? 'btn' : 'btn btn-primary'} onClick={() => navigate(`/train/${nextDue}`)} data-testid="next-pending">
                  <SkipForward size={15} /> Próximo pendente
                </button>
              )}
              {done && (
                <button className={retryClass} onClick={s.retry} data-testid="retry">
                  <RotateCcw size={15} /> Resolver de novo
                </button>
              )}
            </div>
            {session?.controls}
            {s.nextDue && (
              <p className="xs muted" style={{ marginTop: '0.75rem' }} data-testid="next-review">
                Resultado salvo. Próxima revisão: {new Date(s.nextDue).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            )}
            {s.practice && (
              <p className="xs muted" style={{ marginTop: '0.75rem' }} data-testid="practice-note">
                Repetição de prática: feita logo após a tentativa anterior, não altera a revisão nem o perfil.
              </p>
            )}
          </section>
          {done && <ReferenceSolution ex={ex} />}
          <ExerciseDetails ex={ex} attempts={attempts} canDelete={!session} />
        </div>
      </div>
    </div>
  );
}
