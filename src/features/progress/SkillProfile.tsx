import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { SkillEstimate } from '../../types/domain';
import { CONFIDENCE_LABEL, SKILL_LABEL } from '../../services/adaptation/skills';

type Props = { profile: readonly SkillEstimate[] };

const CONF_CLASS: Record<SkillEstimate['confidence'], string> = {
  insufficient: 'tag',
  initial: 'tag tag-info',
  consistent: 'tag tag-good',
  provisional_mastery: 'tag tag-good',
  needs_review: 'tag tag-warn',
};

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

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
                <div className="skill-meter" title={`Estimativa ${pct(s.level)}; intervalo de 90%: ${pct(s.interval[0])}–${pct(s.interval[1])}`}>
                  <span className="ci" style={{ left: `${s.interval[0] * 100}%`, width: `${(s.interval[1] - s.interval[0]) * 100}%` }} />
                  <span className="pt" style={{ left: `${s.level * 100}%` }} />
                </div>
                <div className="row xs muted" style={{ marginTop: '0.3rem' }}>
                  <span className="mono">
                    {pct(s.level)} ({pct(s.interval[0])}–{pct(s.interval[1])})
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
              </>
            )}
          </div>
          <span className={CONF_CLASS[s.confidence]}>{CONFIDENCE_LABEL[s.confidence]}</span>
        </div>
      ))}
    </div>
  );
}
