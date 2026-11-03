import { useState, type ReactNode } from 'react';
import { saveSettings } from '../../db/settings';
import { useSettings } from '../../hooks/useSettings';
import { DataPanel } from './DataPanel';
import type { Settings } from '../../types/domain';
import { DEFAULT_THRESHOLDS } from '../../services/analysis/classify';

function NumberField({ label, hint, value, min, max, step = 1, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel stack">
      <h2>{title}</h2>
      <div className="grid-2">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const [names, setNames] = useState<string | null>(null);
  const set = (patch: Partial<Settings>) => void saveSettings(patch);
  const t = s.thresholds;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Configurações</h1>
          <p>Todas as opções abaixo têm efeito imediato e ficam salvas localmente.</p>
        </div>
      </header>

      <Section title="Jogador">
        <label className="field">
          <span>Seus nomes nos arquivos PGN</span>
          <input
            className="input"
            value={names ?? s.playerNames.join(', ')}
            onChange={(e) => setNames(e.target.value)}
            onBlur={() => {
              if (names === null) return;
              set({ playerNames: names.split(',').map((n) => n.trim()).filter(Boolean) });
              setNames(null);
            }}
            placeholder="ex.: meu_usuario, Meu Nome"
            data-testid="player-names"
          />
          <small>Separe por vírgulas. Usado para detectar sua cor em novas importações.</small>
        </label>
        <NumberField label="Meta diária de exercícios" value={s.dailyGoal} min={1} max={100} onChange={(v) => set({ dailyGoal: v })} />
      </Section>

      <Section title="Motor e análise">
        <NumberField label="Profundidade da análise completa" hint="Maior = mais confiável e mais lenta (recomendado 14–20)." value={s.analysisDepth} min={8} max={30} onChange={(v) => set({ analysisDepth: v })} />
        <NumberField label="Profundidade da análise rápida" value={s.quickDepth} min={6} max={20} onChange={(v) => set({ quickDepth: v })} />
        <NumberField label="Quantidade de variantes (MultiPV)" hint="Alternativas calculadas por posição; necessário ≥ 2 para detectar soluções múltiplas." value={s.multiPv} min={1} max={5} onChange={(v) => set({ multiPv: v })} />
        <NumberField label="Profundidade mínima para classificar" hint="Abaixo disso o lance é marcado como inconclusivo." value={t.minDepth} min={4} max={30} onChange={(v) => set({ thresholds: { ...t, minDepth: v } })} />
      </Section>

      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h2>Limites de classificação</h2>
          <button className="btn btn-sm" onClick={() => set({ thresholds: DEFAULT_THRESHOLDS })}>
            Restaurar padrão
          </button>
        </div>
        <p className="small muted">Perda máxima de expectativa de vitória (pontos percentuais) para cada categoria. Acima do último limite, o lance é um erro grave.</p>
        <div className="grid-2">
          <NumberField label="Excelente até" value={t.excellent} min={0.5} max={t.good} step={0.5} onChange={(v) => set({ thresholds: { ...t, excellent: v } })} />
          <NumberField label="Bom até" value={t.good} min={t.excellent} max={t.inaccuracy} step={0.5} onChange={(v) => set({ thresholds: { ...t, good: v } })} />
          <NumberField label="Imprecisão até" value={t.inaccuracy} min={t.good} max={t.mistake} step={0.5} onChange={(v) => set({ thresholds: { ...t, inaccuracy: v } })} />
          <NumberField label="Erro até" value={t.mistake} min={t.inaccuracy} max={60} step={0.5} onChange={(v) => set({ thresholds: { ...t, mistake: v } })} />
        </div>
        <p className="xs faint">Novos limites valem para análises executadas a partir de agora.</p>
      </section>

      <Section title="Treinamento">
        <NumberField label="Tolerância para soluções alternativas (p.p.)" hint="Lances até esta perda em relação ao melhor são aceitos em novos exercícios." value={s.exerciseTolerance} min={1} max={15} step={0.5} onChange={(v) => set({ exerciseTolerance: v })} />
        <NumberField label="Máximo de exercícios gerados por partida" value={s.maxExercisesPerGame} min={0} max={15} onChange={(v) => set({ maxExercisesPerGame: v })} />
        <label className="field">
          <span>Intervalos da repetição espaçada (dias)</span>
          <input
            className="input mono"
            defaultValue={s.srsIntervalsDays.join(', ')}
            key={s.srsIntervalsDays.join(',')}
            onBlur={(e) => {
              const v = e.target.value
                .split(',')
                .map((x) => Number(x.trim()))
                .filter((x) => Number.isFinite(x) && x > 0);
              if (v.length) set({ srsIntervalsDays: v });
            }}
          />
          <small>Acerto sem dica avança um nível; com dica mantém o nível com metade do intervalo; erro volta em 10 minutos.</small>
        </label>
      </Section>

      <Section title="Tabuleiro e aparência">
        <label className="field">
          <span>Tema visual</span>
          <select className="select" value={s.appTheme} onChange={(e) => set({ appTheme: e.target.value as Settings['appTheme'] })}>
            <option value="dark">Escuro (grafite)</option>
            <option value="light">Claro (papel)</option>
          </select>
        </label>
        <label className="field">
          <span>Cores do tabuleiro</span>
          <select className="select" value={s.boardTheme} onChange={(e) => set({ boardTheme: e.target.value as Settings['boardTheme'] })}>
            <option value="slate">Ardósia</option>
            <option value="walnut">Nogueira</option>
            <option value="olive">Oliva</option>
          </select>
        </label>
        <label className="field">
          <span>Orientação padrão na análise</span>
          <select className="select" value={s.boardOrientation} onChange={(e) => set({ boardOrientation: e.target.value as Settings['boardOrientation'] })}>
            <option value="auto">Automática (sua cor)</option>
            <option value="white">Brancas embaixo</option>
            <option value="black">Pretas embaixo</option>
          </select>
        </label>
        <NumberField label="Duração das animações (ms)" value={s.animationMs} min={0} max={600} step={20} onChange={(v) => set({ animationMs: v })} />
        <label className="check">
          <input type="checkbox" checked={s.showCoordinates} onChange={(e) => set({ showCoordinates: e.target.checked })} /> Mostrar coordenadas
        </label>
      </Section>

      <DataPanel />
    </div>
  );
}
