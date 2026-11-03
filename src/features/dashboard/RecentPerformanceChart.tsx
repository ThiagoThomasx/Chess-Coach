import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Attempt } from '../../types/domain';
import { dailyPerformance } from '../../services/stats/stats';

type Props = { attempts: readonly Attempt[]; days?: number };

export function RecentPerformanceChart({ attempts, days = 14 }: Props) {
  const data = dailyPerformance(attempts).slice(-days).map((d) => ({ ...d, label: d.day.slice(5).split('-').reverse().join('/') }));
  if (data.length === 0) return <p className="small muted">Resolva exercícios para acompanhar sua evolução diária.</p>;
  return (
    <div className="chart-box">
      <ResponsiveContainer>
        <BarChart data={data} maxBarSize={36} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-faint)' }} />
          <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: 'var(--text-faint)' }} />
          <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'var(--surface-2)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="independentRate" name="Sem dicas" stackId="a" fill="var(--good)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="assistedRate" name="Com dicas" stackId="a" fill="var(--warn)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
