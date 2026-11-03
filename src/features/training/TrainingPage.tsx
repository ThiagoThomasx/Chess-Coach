import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Target } from 'lucide-react';
import { getDb } from '../../db/database';
import { EmptyState } from '../../components/feedback/EmptyState';
import { THEME_LABEL } from '../../services/pedagogy/concepts';
import { Difficulty } from './Difficulty';
import { MiniBoard } from './MiniBoard';
import type { Attempt, Exercise, Skill, Theme } from '../../types/domain';
import { estimateProfile, SKILL_LABEL } from '../../services/adaptation/skills';

type Status = 'all' | 'due' | 'new' | 'failed' | 'mastered' | 'recommended';

const STATUS_LABEL: Record<Status, string> = {
  all: 'Todos',
  due: 'Revisões pendentes',
  new: 'Novos',
  failed: 'Errados na última tentativa',
  mastered: 'Resolvidos sem dica',
  recommended: 'No meu nível',
};

function lastAttempt(list: Attempt[] | undefined): Attempt | undefined {
  return list?.[list.length - 1];
}

export function TrainingPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const exercises = useLiveQuery(() => getDb().exercises.toArray(), [], undefined);
  const attempts = useLiveQuery(() => getDb().attempts.orderBy('at').toArray(), [], []);
  const events = useLiveQuery(() => getDb().skillEvents.toArray(), [], []);

  const status = (params.get('filter') as Status | null) ?? 'all';
  const theme = (params.get('theme') as Theme | null) ?? '';
  const difficulty = Number(params.get('difficulty') ?? 0);
  const source = params.get('source') ?? '';
  const skill = (params.get('skill') as Skill | null) ?? '';
  const now = Date.now();

  const byExercise = useMemo(() => {
    const m = new Map<string, Attempt[]>();
    for (const a of attempts) m.set(a.exerciseId, [...(m.get(a.exerciseId) ?? []), a]);
    return m;
  }, [attempts]);
  const targets = useMemo(() => new Map(estimateProfile(events, now).map((s) => [s.skill, s.targetDifficulty])), [events, now]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const matches = (e: Exercise): boolean => {
    const last = lastAttempt(byExercise.get(e.id));
    if (theme && e.theme !== theme) return false;
    if (difficulty && e.difficulty !== difficulty) return false;
    if (source && e.source !== source) return false;
    if (skill && e.skill !== skill) return false;
    switch (status) {
      case 'due':
        return e.srs.dueAt <= now;
      case 'new':
        return !byExercise.has(e.id);
      case 'failed':
        return !!last && (!last.correct || last.revealed);
      case 'mastered':
        return !!last && last.correct && last.hintsUsed === 0 && !last.revealed;
      case 'recommended':
        return Math.abs(e.difficulty - (targets.get(e.skill) ?? 1)) <= 1;
      default:
        return true;
    }
  };

  const list = (exercises ?? []).filter(matches).sort((a, b) => a.srs.dueAt - b.srs.dueAt);
  const due = (exercises ?? []).filter((e) => e.srs.dueAt <= now).sort((a, b) => a.srs.dueAt - b.srs.dueAt);
  const dueCount = due.length;
  const themes = [...new Set((exercises ?? []).map((e) => e.theme))];
  const skills = [...new Set((exercises ?? []).map((e) => e.skill))];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Treinar</h1>
          <p>Exercícios criados a partir das suas próprias partidas. Erros voltam mais cedo; acertos sem dica ganham intervalos maiores.</p>
        </div>
        <button className="btn btn-primary" disabled={dueCount === 0} onClick={() => due[0] && navigate(`/train/${due[0].id}`)}>
          <Target size={16} /> Revisar pendentes ({dueCount})
        </button>
      </header>
      <section className="panel">
        <div className="filters">
          <label className="field">
            <span>Situação</span>
            <select className="select" value={status} onChange={(e) => set('filter', e.target.value === 'all' ? '' : e.target.value)} data-testid="filter-status">
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Tema</span>
            <select className="select" value={theme} onChange={(e) => set('theme', e.target.value)}>
              <option value="">Todos</option>
              {themes.map((t) => (
                <option key={t} value={t}>
                  {THEME_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Competência</span>
            <select className="select" value={skill} onChange={(e) => set('skill', e.target.value)} data-testid="filter-skill">
              <option value="">Todas</option>
              {skills.map((k) => (
                <option key={k} value={k}>
                  {SKILL_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Dificuldade</span>
            <select className="select" value={difficulty || ''} onChange={(e) => set('difficulty', e.target.value)}>
              <option value="">Todas</option>
              {[1, 2, 3, 4, 5].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Origem</span>
            <select className="select" value={source} onChange={(e) => set('source', e.target.value)}>
              <option value="">Todas</option>
              <option value="game">Minhas partidas</option>
              <option value="opening">Aberturas</option>
            </select>
          </label>
          <span className="spacer" />
          <span className="small muted">{list.length} exercício(s)</span>
        </div>
      </section>
      {exercises && exercises.length === 0 && (
        <EmptyState icon={<Target size={36} />} title="Nenhum exercício ainda">
          Analise uma partida em que sua cor esteja definida: os erros relevantes viram exercícios automaticamente. Você também pode criar um exercício a partir de qualquer erro na tela de análise.
        </EmptyState>
      )}
      <div className="ex-grid">
        {list.map((e) => {
          const hist = byExercise.get(e.id) ?? [];
          const last = lastAttempt(hist);
          return (
            <button key={e.id} className="ex-card" onClick={() => navigate(`/train/${e.id}`)} data-testid="exercise-card">
              <MiniBoard fen={e.fen} orientation={e.sideToMove === 'w' ? 'white' : 'black'} />
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong className="small">{THEME_LABEL[e.theme]}</strong>
                <Difficulty value={e.difficulty} />
              </div>
              <div className="row xs">
                {e.srs.dueAt <= now ? <span className="tag tag-info">Pendente</span> : <span className="tag">Próxima: {new Date(e.srs.dueAt).toLocaleDateString('pt-BR')}</span>}
                {last && (last.correct && !last.revealed ? <span className="tag tag-good">✓ {last.hintsUsed ? 'com dica' : 'sem dica'}</span> : <span className="tag tag-bad">✗ errou</span>)}
                <span className="faint">{hist.length} tentativa(s)</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
