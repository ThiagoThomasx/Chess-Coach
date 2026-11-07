import type { Color, ExerciseKind } from '../../types/domain';
import type { SessionStatus } from './useExerciseSession';

const KIND_LABEL: Record<ExerciseKind, string> = { single: 'Lance único', sequence: 'Sequência forçada', mate: 'Mate', conversion: 'Conversão', defense: 'Defesa' };
const SIDE: Record<Color, string> = { w: 'Brancas', b: 'Pretas' };

type Props = {
  status: SessionStatus;
  side: Color;
  objective: string;
  progress: { done: number; total: number; kind: ExerciseKind };
  hints: number;
  maxHints: number;
};

/** What the screen is about right now: one headline, the goal, and the single next step. */
function copyFor(status: SessionStatus, side: Color): { title: string; next: string } {
  switch (status) {
    case 'playing':
      return { title: `Sua vez · ${SIDE[side]} jogam`, next: 'Mova uma peça no tabuleiro: arraste, ou toque na peça e depois na casa.' };
    case 'checking':
      return { title: 'Verificando seu lance…', next: 'Aguarde o veredito.' };
    case 'solved':
      return { title: 'Resolvido', next: 'Confira a solução de referência e siga em frente.' };
    case 'failed':
      return { title: 'Não foi dessa vez', next: 'Veja a solução ou tente de novo.' };
    case 'revealed':
      return { title: 'Solução mostrada', next: 'Acompanhe a sequência no tabuleiro e tente de novo depois.' };
    case 'uncertain':
      return { title: 'Sem veredito', next: 'O motor não teve confiança suficiente; nada foi registrado.' };
  }
}

export function TaskPrompt({ status, side, objective, progress, hints, maxHints }: Props) {
  const { title, next } = copyFor(status, side);
  const step = Math.min(progress.done + 1, progress.total);
  return (
    <section className="task-prompt" data-status={status} aria-live="polite" data-testid="task-prompt">
      <div className="task-prompt-head">
        <span className={`turn-dot turn-dot-${side}`} aria-hidden="true" />
        <h2 data-testid="task-title">{title}</h2>
      </div>
      <p className="task-goal" data-testid="task-goal">
        {objective}
      </p>
      <p className="task-next small">{next}</p>
      <div className="task-meta xs" data-testid="sequence-progress">
        <span>{KIND_LABEL[progress.kind]} · lance {step} de {progress.total}</span>
        <span aria-label={`Dicas usadas: ${hints} de ${maxHints}`}>
          dicas {hints}/{maxHints}
        </span>
      </div>
    </section>
  );
}
