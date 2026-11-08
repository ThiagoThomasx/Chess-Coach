import { Link } from 'react-router-dom';
import type { SkillEstimate } from '../../types/domain';
import { SKILL_LABEL } from '../../services/adaptation/skills';

type Props = { profile: readonly SkillEstimate[] };

type State = 'review' | 'developing' | 'consolidated' | 'no_recent' | 'insufficient';

/** The states the player acts on, in decision order: what to review first, what is still forming, what has no recent data. */
const STATES: { id: State; title: string; hint: string; tag: string }[] = [
  { id: 'review', title: 'Precisam revisar', hint: 'Queda recente ou claramente abaixo de 50%.', tag: 'tag tag-warn' },
  { id: 'developing', title: 'Em desenvolvimento', hint: 'Há evidências, mas ainda sem domínio.', tag: 'tag tag-info' },
  { id: 'consolidated', title: 'Consolidadas', hint: 'Domínio provisório: acertos sem dica em exercícios distintos.', tag: 'tag tag-good' },
  { id: 'no_recent', title: 'Sem evidência recente', hint: 'Só há evidências com mais de 30 dias. O perfil completo mostra o diagnóstico histórico.', tag: 'tag' },
  { id: 'insufficient', title: 'Evidências insuficientes', hint: 'Resolva exercícios ou analise partidas para medir.', tag: 'tag' },
];

function stateOf(s: SkillEstimate): State {
  if (s.confidence === 'needs_review') return 'review';
  if (s.confidence === 'provisional_mastery') return 'consolidated';
  if (s.confidence === 'insufficient') return 'insufficient';
  if (s.confidence === 'no_recent') return 'no_recent';
  return 'developing';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Competences grouped by state, so the dashboard says where to focus without a fictitious rating. */
export function SkillStates({ profile }: Props) {
  return (
    <section className="panel" aria-labelledby="skill-states-title" data-testid="skill-states">
      <div className="panel-head">
        <h2 id="skill-states-title">Competências</h2>
        <Link to="/progress" className="xs">
          Perfil completo
        </Link>
      </div>
      <div className="skill-states">
        {STATES.map((st) => {
          const skills = profile.filter((s) => stateOf(s) === st.id);
          return (
            <div key={st.id} className="skill-state" data-testid={`skill-state-${st.id}`}>
              <div className="row">
                <span className={st.tag}>{st.title}</span>
                <span className="mono xs muted">{skills.length}</span>
              </div>
              <p className="xs faint">{st.hint}</p>
              <ul className="stack" style={{ gap: '0.2rem' }}>
                {skills.map((s) => (
                  <li key={s.skill} className="small row">
                    <span>{SKILL_LABEL[s.skill]}</span>
                    {s.interval && st.id !== 'insufficient' && st.id !== 'no_recent' && <span className="xs faint mono">{`${pct(s.interval[0])}–${pct(s.interval[1])}`}</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="xs faint" style={{ marginTop: '0.6rem' }}>
        Faixas: intervalo de 90% da taxa de acerto estimada em cada competência — não é um rating de xadrez.
      </p>
    </section>
  );
}
