import { useState } from 'react';
import { Cpu, Pause, Play, Zap } from 'lucide-react';
import type { Game, GameAnalysis, Settings } from '../../types/domain';
import { isRunning, startAnalysis, stopAnalysis } from '../../services/analysis/analysisRunner';
import { useEngine } from '../../hooks/useEngine';
import { useToast } from '../../components/feedback/Toast';

type Props = {
  game: Game;
  analysis: GameAnalysis | undefined;
  settings: Settings;
};

const STATUS_TEXT: Record<GameAnalysis['status'], string> = {
  pending: 'Ainda não analisada',
  running: 'Analisando…',
  paused: 'Análise incompleta — pode ser retomada',
  complete: 'Análise concluída',
  error: 'A análise falhou',
};

export function AnalysisControls({ game, analysis, settings }: Props) {
  const { engine, state } = useEngine();
  const toast = useToast();
  const [isActive, setIsActive] = useState(isRunning(game.id));
  const done = analysis?.positions.filter((p) => p && (p.complete || p.terminal)).length ?? 0;
  const total = game.moves.length + 1;
  const pct = Math.round((done / total) * 100);
  const status = isActive ? 'running' : (analysis?.status ?? 'pending');
  const running = status === 'running';

  const run = async (depth: number) => {
    setIsActive(true);
    try {
      const r = await startAnalysis(game, settings, engine, depth);
      if (r.status === 'complete') toast('Análise concluída. Exercícios e perfil atualizados.', 'good');
      else if (r.status === 'error') toast(r.error ?? 'Falha na análise', 'bad');
      else toast('Análise pausada. Os resultados parciais foram salvos.', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao iniciar o motor', 'bad');
    } finally {
      setIsActive(false);
    }
  };

  const depthLabel = analysis ? `profundidade ${analysis.settings.depth}, ${analysis.settings.multiPv} variante(s)` : '';
  return (
    <section className="panel" aria-labelledby="analysis-ctl">
      <div className="panel-head">
        <h2 id="analysis-ctl" className="row">
          <Cpu size={16} /> Análise com Stockfish
        </h2>
        <span className="xs faint" data-testid="analysis-status">
          {STATUS_TEXT[status]}
        </span>
      </div>
      <div className="progress" aria-label={`Progresso ${pct}%`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="row xs muted" style={{ marginTop: '0.4rem' }}>
        <span className="mono">
          {done}/{total} posições
        </span>
        {depthLabel && <span>· {depthLabel}</span>}
        {state === 'error' && <span className="tag tag-bad">Motor indisponível</span>}
      </div>
      {analysis?.error && <p className="callout callout-bad small" style={{ marginTop: '0.6rem' }}>{analysis.error}</p>}
      <div className="row" style={{ marginTop: '0.8rem' }}>
        {running ? (
          <button className="btn" onClick={() => stopAnalysis(game.id, engine)} data-testid="stop-analysis">
            <Pause size={15} /> Interromper
          </button>
        ) : (
          <>
            <button className="btn btn-primary" onClick={() => void run(settings.analysisDepth)} data-testid="run-deep">
              <Play size={15} /> {analysis && analysis.status !== 'pending' ? 'Retomar / aprofundar' : 'Analisar'} (prof. {settings.analysisDepth})
            </button>
            <button className="btn" onClick={() => void run(settings.quickDepth)} data-testid="run-quick">
              <Zap size={15} /> Rápida (prof. {settings.quickDepth})
            </button>
          </>
        )}
      </div>
      {!game.userColor && (
        <p className="xs faint" style={{ marginTop: '0.6rem' }}>
          Defina sua cor na lista de partidas para gerar exercícios e atualizar seu perfil automaticamente.
        </p>
      )}
    </section>
  );
}
