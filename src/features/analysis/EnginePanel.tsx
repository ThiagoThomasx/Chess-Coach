import { useState } from 'react';
import { Search, X } from 'lucide-react';
import type { EngineLine, PositionAnalysis, Settings } from '../../types/domain';
import { formatScore } from '../../services/analysis/evaluation';
import { uciLineToSan } from '../../services/chess/position';
import { useEngine } from '../../hooks/useEngine';

type Props = {
  /** Lines stored for the position before the selected move (best alternatives). */
  alternatives: PositionAnalysis | null;
  alternativesBasePly: number;
  displayedFen: string;
  settings: Settings;
  onShowLine: (basePly: number | null, fen: string, moves: string[]) => void;
};

function LineButton({ fen, line, onClick }: { fen: string; line: EngineLine; onClick: () => void }) {
  const san = uciLineToSan(fen, line.pv.slice(0, 8));
  return (
    <button className="engine-line" onClick={onClick} title="Explorar esta variante no tabuleiro">
      <span className="score mono">{formatScore(line.score)}</span>
      <span className="line-chip">{san.length ? san.join(' ') : '—'}</span>
    </button>
  );
}

export function EnginePanel({ alternatives, alternativesBasePly, displayedFen, settings, onShowLine }: Props) {
  const { engine } = useEngine();
  const [probe, setProbe] = useState<PositionAnalysis | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const probeValid = probe && probe.fen === displayedFen;

  const analyzeHere = async () => {
    setIsProbing(true);
    setProbeError(null);
    try {
      const r = await engine.analyze({ fen: displayedFen, depth: settings.analysisDepth, multiPv: settings.multiPv, onProgress: (p) => setProbe(p) });
      setProbe(r);
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : 'Falha na análise');
    } finally {
      setIsProbing(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="engine-title">
      <div className="panel-head">
        <h2 id="engine-title">Variantes</h2>
        <div className="row">
          {isProbing ? (
            <button className="btn btn-sm" onClick={() => engine.stop()}>
              <X size={14} /> Parar
            </button>
          ) : (
            <button className="btn btn-sm" onClick={() => void analyzeHere()} data-testid="analyze-position">
              <Search size={14} /> Analisar posição exibida
            </button>
          )}
        </div>
      </div>
      {alternatives && alternatives.lines.length > 0 ? (
        <div className="stack" style={{ gap: '0.4rem' }}>
          <h3>Melhores alternativas antes do lance</h3>
          {alternatives.lines.map((l) => (
            <LineButton key={l.multipv} fen={alternatives.fen} line={l} onClick={() => onShowLine(alternativesBasePly, alternatives.fen, l.pv)} />
          ))}
        </div>
      ) : (
        <p className="small muted">Analise a partida para ver as alternativas do motor em cada lance.</p>
      )}
      {(probeValid || isProbing || probeError) && <hr className="divider" />}
      {probeError && <p className="callout callout-bad small">{probeError}</p>}
      {probeValid && probe && (
        <div className="stack" style={{ gap: '0.4rem' }}>
          <h3>
            Posição exibida · prof. {probe.depth} {isProbing ? '(em andamento)' : probe.complete ? '' : '(interrompida — resultado parcial)'}
          </h3>
          {probe.lines.map((l) => (
            <LineButton key={l.multipv} fen={probe.fen} line={l} onClick={() => onShowLine(null, probe.fen, l.pv)} />
          ))}
        </div>
      )}
      {isProbing && !probeValid && <p className="small muted">Aguardando o motor…</p>}
    </section>
  );
}
