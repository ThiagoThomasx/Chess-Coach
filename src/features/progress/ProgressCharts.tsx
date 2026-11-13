import { Bar, BarChart, Cell, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MoveClass, Skill, SkillEvent } from '../../types/domain';
import { estimateSkill, isMeasurableEvidence } from '../../services/adaptation/skills';
import { CLASS_LABEL } from '../../services/analysis/classify';
import { evidenceDayKey } from '../../services/stats/stats';

const tooltip = { contentStyle: { background: 'var(--surface-3)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12 } };
const tick = { fontSize: 11, fill: 'var(--text-faint)' };

const CLASS_COLOR: Partial<Record<MoveClass, string>> = {
  best: 'var(--best)',
  excellent: 'var(--good)',
  good: 'var(--good)',
  inaccuracy: 'var(--warn)',
  mistake: 'var(--mistake)',
  blunder: 'var(--bad)',
  inconclusive: 'var(--inconclusive)',
};

export function ClassDistributionChart({ dist }: { dist: Record<MoveClass, number> }) {
  const data = (Object.keys(CLASS_COLOR) as MoveClass[]).map((c) => ({ name: CLASS_LABEL[c], value: dist[c], fill: CLASS_COLOR[c] }));
  if (data.every((d) => d.value === 0)) return <p className="small muted">Analise partidas para ver a distribuição dos seus lances.</p>;
  return (
    <div className="chart-box">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 24 }}>
          <XAxis type="number" allowDecimals={false} tick={tick} />
          <YAxis type="category" dataKey="name" width={90} tick={tick} />
          <Tooltip {...tooltip} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar dataKey="value" name="Lances" radius={[0, 3, 3, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Posterior estimate of a skill recomputed at the end of each day with evidence. */
export function SkillHistoryChart({ events, skill }: { events: readonly SkillEvent[]; skill: Skill }) {
  const own = events.filter((e) => e.skill === skill && isMeasurableEvidence(e)).sort((a, b) => a.at - b.at);
  const days = [...new Set(own.map((e) => evidenceDayKey(e)))].sort();
  const data = days.map((d) => {
    const upto = own.filter((e) => evidenceDayKey(e) <= d);
    const end = (upto[upto.length - 1]?.at ?? 0) + 1;
    const s = estimateSkill(skill, upto, end);
    return { day: d.slice(5).split('-').reverse().join('/'), level: s.level === null ? null : Math.round(s.level * 100), lo: s.interval ? Math.round(s.interval[0] * 100) : null, hi: s.interval ? Math.round(s.interval[1] * 100) : null };
  });
  if (data.length < 2) return <p className="small muted">É preciso evidência em pelo menos dois dias diferentes para mostrar a evolução.</p>;
  return (
    <div className="chart-box">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" tick={tick} />
          <YAxis domain={[0, 100]} unit="%" tick={tick} />
          <Tooltip {...tooltip} />
          <Line dataKey="hi" name="Limite superior (90%)" stroke="var(--text-faint)" strokeDasharray="3 3" dot={false} />
          <Line dataKey="level" name="Estimativa" stroke="var(--info)" strokeWidth={2} />
          <Line dataKey="lo" name="Limite inferior (90%)" stroke="var(--text-faint)" strokeDasharray="3 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
