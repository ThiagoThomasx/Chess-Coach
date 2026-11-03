import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PositionAnalysis } from '../../types/domain';
import { formatScore, winPercentWhite } from '../../services/analysis/evaluation';

type Props = {
  positions: readonly (PositionAnalysis | null)[];
  currentPly: number;
  onSelect: (ply: number) => void;
};

/** White's win expectancy per ply. Missing positions are left as gaps, never interpolated. */
export function EvalGraph({ positions, currentPly, onSelect }: Props) {
  const data = positions.map((p, ply) => {
    const s = p?.lines[0]?.score;
    return { ply, win: s ? Math.round(winPercentWhite(s)) : null, label: s ? formatScore(s) : '—' };
  });
  return (
    <div className="chart-box" style={{ height: 130 }} aria-label="Gráfico de avaliação ao longo da partida">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -28 }} onClick={(e) => typeof e?.activeLabel === 'number' && onSelect(e.activeLabel)}>
          <defs>
            <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ecebe6" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#ecebe6" stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="ply" tick={{ fontSize: 10, fill: 'var(--text-faint)' }} interval="preserveStartEnd" />
          <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 10, fill: 'var(--text-faint)' }} />
          <Tooltip
            contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12 }}
            formatter={(_v, _n, item) => [(item.payload as { label: string }).label, 'Avaliação']}
            labelFormatter={(l) => `Meia-jogada ${String(l)}`}
          />
          <ReferenceLine y={50} stroke="var(--text-faint)" strokeDasharray="3 3" />
          <ReferenceLine x={currentPly} stroke="var(--info)" />
          <Area type="monotone" dataKey="win" stroke="#d6d4cd" fill="url(#evalFill)" connectNulls={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
