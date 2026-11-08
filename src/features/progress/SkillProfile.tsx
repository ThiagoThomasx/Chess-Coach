import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { HistoricalDiagnosis, SkillEstimate } from '../../types/domain';
import { CONFIDENCE_LABEL, hasHistoricalPoint, hasPointEstimate, SKILL_LABEL } from '../../services/adaptation/skills';

type Props = { profile: readonly SkillEstimate[] };

const CONF_CLASS: Record<SkillEstimate['confidence'], string> = {
  insufficient: 'tag',
  initial: 'tag tag-info',
  consistent: 'tag tag-info',
  provisional_mastery: 'tag tag-good',
  needs_review: 'tag tag-warn',
  no_recent: 'tag',
};

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/** Month and year in UTC: game evidence carries the game's calendar date (stored at 00:00 UTC). */
const monthYear = (t: number) => new Date(t).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric', timeZone: 'UTC' });

/** All-time diagnosis (no age decay): what the evidence, old games included, shows about the skill. */
function HistoryLine({ h }: { h: HistoricalDiagnosis }) {
  const span = monthYear(h.from) === monthYear(h.to) ? monthYear(h.from) : `${monthYear(h.from)} a ${monthYear(h.to)}`;
  const value = hasHistoricalPoint(h) ? `${pct(h.level)} (${pct(h.interval[0])}–${pct(h.interval[1])})` : `entre ${pct(h.interval[0])} e ${pct(h.interval[1])}`;
  return (
    <div className="xs faint" style={{ marginTop: '0.2rem' }} data-testid="skill-history">
      Diagnóstico histórico: <span className="mono">{value}</span> · {h.events} evidência(s) de {span}
    </div>
  );
}

export function SkillProfile({ profile }: Props) {
  return (
    <div data-testid="skill-profile">
      {profile.map((s) => (
        <div key={s.skill} className="skill-row" data-testid={`skill-${s.skill}`}>
          <div>
            <div className="small" style={{ fontWeight: 600 }}>
              {SKILL_LABEL[s.skill]}
            </div>
            <div className="xs faint">
              {s.events} evidência(s) · peso {s.evidence.toFixed(1)} · nível-alvo {s.targetDifficulty}/5
            </div>
          </div>
          <div>
            {s.level === null || !s.interval ? (
              <span className="xs faint">Sem dados</span>
            ) : (
              <>
                <div
                  className="skill-meter"
                  title={hasPointEstimate(s) ? `Estimativa ${pct(s.level)}; intervalo de 90%: ${pct(s.interval[0])}–${pct(s.interval[1])}` : `Poucas evidências para uma estimativa; intervalo de 90%: ${pct(s.interval[0])}–${pct(s.interval[1])}`}
                >
                  <span className="ci" style={{ left: `${s.interval[0] * 100}%`, width: `${(s.interval[1] - s.interval[0]) * 100}%` }} />
                  {hasPointEstimate(s) && <span className="pt" style={{ left: `${s.level * 100}%` }} />}
                </div>
                <div className="row xs muted" style={{ marginTop: '0.3rem' }}>
                  <span className="mono">
                    {hasPointEstimate(s) ? `${pct(s.level)} (${pct(s.interval[0])}–${pct(s.interval[1])})` : `entre ${pct(s.interval[0])} e ${pct(s.interval[1])}`}
                  </span>
                  <span>recente {pct(s.recentRate)}</span>
                  {s.independentRate !== null && <span>sem dica {pct(s.independentRate)}</span>}
                  {s.assistedRate !== null && <span>com dica {pct(s.assistedRate)}</span>}
                  {s.trend === 'up' && (
                    <span className="row" style={{ color: 'var(--good)', gap: 2 }}>
                      <TrendingUp size={13} /> subindo
                    </span>
                  )}
                  {s.trend === 'down' && (
                    <span className="row" style={{ color: 'var(--bad)', gap: 2 }}>
                      <TrendingDown size={13} /> caindo
                    </span>
                  )}
                  {s.trend === 'stable' && (
                    <span className="row" style={{ gap: 2 }}>
                      <Minus size={13} /> estável
                    </span>
                  )}
                </div>
                {s.history && <HistoryLine h={s.history} />}
              </>
            )}
          </div>
          <span className={CONF_CLASS[s.confidence]}>{CONFIDENCE_LABEL[s.confidence]}</span>
        </div>
      ))}
    </div>
  );
}
