import { Cpu, Pause, Play, Zap } from 'lucide-react';
import type { Game, GameAnalysis, Settings } from '../../types/domain';
import { AnalysisElsewhereError, derivationMessage, startAnalysis, stopAnalysis } from '../../services/analysis/analysisRunner';
import { useActiveRun } from './useActiveRun';
import { controlView, useAnalysisOwner, type ControlView } from './useAnalysisOwner';
import { useEngine } from '../../hooks/useEngine';
import { useToast } from '../../components/feedback/Toast';

type Props = {
  game: Game;
  analysis: GameAnalysis | undefined;
  settings: Settings;
};

const STATUS_TEXT: Record<ControlView['status'], string> = {
  pending: 'Ainda não analisada',
  running: 'Analisando…',
  paused: 'Análise incompleta — pode ser retomada',
  complete: 'Análise concluída',
  error: 'A análise falhou',
  elsewhere: 'Analisando em outra aba…',
};

export function AnalysisControls({ game, analysis, settings }: Props) {
  const { engine, state } = useEngine();
  const toast = useToast();
  const [isActive, setIsActive] = useActiveRun(game.id);
  const done = analysis?.positions.filter((p) => p && (p.complete || p.terminal)).length ?? 0;
  const total = game.moves.length + 1;
  const pct = Math.round((done / total) * 100);
  const owner = useAnalysisOwner(game.id, analysis?.status, isActive);
  const { status, controls } = controlView(owner, analysis?.status);

  const run = async (depth: number) => {
    setIsActive(true);
    try {
      const { analysis: r, derivation } = await startAnalysis(game, settings, engine, depth);
      if (r.status === 'complete') toast(derivationMessage(derivation), derivation?.hasUserColor === false ? 'info' : 'good');
      else if (r.status === 'error') toast(r.error ?? 'Falha na análise', 'bad');
      else toast('Análise pausada. Os resultados parciais foram salvos.', 'info');
    } catch (e) {
      if (e instanceof AnalysisElsewhereError) toast(e.message, 'info');
      else toast(e instanceof Error ? e.message : 'Falha ao iniciar o motor', 'bad');
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
        {controls === 'none' ? (
          <p className="xs muted" data-testid="analysis-elsewhere">
            Esta partida está sendo analisada em outra aba. O progresso aparece aqui, e você poderá retomar a análise quando aquela aba terminar ou for fechada.
          </p>
        ) : controls === 'stop' ? (
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
