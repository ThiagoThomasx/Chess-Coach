import { useRef, useState, type DragEvent } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { importPgn, type ImportSummary } from '../../db/gamesRepo';
import { useSettings } from '../../hooks/useSettings';
import { useToast } from '../../components/feedback/Toast';

const ACCEPTED = /\.(pgn|txt)$/i;

export function ImportPanel() {
  const settings = useSettings();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [results, setResults] = useState<ImportSummary[]>([]);

  const handleFiles = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;
    setIsBusy(true);
    const out: ImportSummary[] = [];
    for (const f of list) {
      if (!ACCEPTED.test(f.name)) {
        toast(`${f.name}: formato não suportado (use .pgn)`, 'bad');
        continue;
      }
      try {
        const text = await f.text();
        const summary = await importPgn(text, f.name, settings.playerNames);
        out.push(summary);
      } catch (e) {
        toast(`${f.name}: ${e instanceof Error ? e.message : 'falha na importação'}`, 'bad');
      }
    }
    setResults(out);
    setIsBusy(false);
    const imported = out.reduce((s, r) => s + r.record.imported, 0);
    if (out.length) toast(`${imported} partida(s) importada(s)`, imported ? 'good' : 'warn');
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <section className="panel" aria-labelledby="import-title">
      <div className="panel-head">
        <h2 id="import-title">Importar PGN</h2>
        <span className="xs faint">Processado localmente — nada é enviado</span>
      </div>
      <div
        className="dropzone"
        data-active={isDragging}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {isBusy ? <Loader2 className="spin" size={26} /> : <FileUp size={26} />}
        <strong>Arraste arquivos .pgn aqui</strong>
        <span className="small">ou clique para escolher — um arquivo pode conter várias partidas</span>
        <input ref={inputRef} data-testid="pgn-input" type="file" accept=".pgn,.txt" multiple hidden onChange={(e) => e.target.files && void handleFiles(e.target.files)} />
      </div>
      {settings.playerNames.length === 0 && (
        <p className="callout callout-info" style={{ marginTop: '0.8rem' }}>
          Informe seu nome de jogador em Configurações para que a cor usada por você seja detectada automaticamente. Você também pode escolhê-la em cada partida.
        </p>
      )}
      {results.map((r) => (
        <div key={r.record.id} className="stack fade-in" style={{ marginTop: '0.9rem' }} data-testid="import-result">
          <div className="row small">
            <strong>{r.record.fileName}</strong>
            <span className="tag tag-good">{r.record.imported} importada(s)</span>
            {r.record.duplicates > 0 && <span className="tag tag-warn">{r.record.duplicates} duplicada(s)</span>}
            {r.record.failures.length > 0 && <span className="tag tag-bad">{r.record.failures.length} com erro</span>}
          </div>
          {r.imported.slice(0, 6).map((g) => (
            <div key={g.id} className="small muted">
              {g.headers.white} × {g.headers.black} · {g.headers.result} · {g.headers.date ?? 'sem data'} · {g.headers.timeControl ?? 'ritmo n/d'} · {Math.ceil(g.moves.length / 2)} lances
              {g.warnings.length > 0 && <span className="faint"> — {g.warnings.join(', ')}</span>}
            </div>
          ))}
          {r.record.failures.map((f) => (
            <div key={f.index} className="callout callout-bad xs">
              Partida #{f.index + 1}: {f.reason}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
