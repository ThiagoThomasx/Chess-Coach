import { useRef, useState, type DragEvent } from 'react';
import { ClipboardPaste, FileUp, Loader2 } from 'lucide-react';
import { importPastedPgn, importPgn, type ImportSummary } from '../../db/gamesRepo';
import { MAX_PGN_BYTES } from '../../services/pgn/parsePgn';
import { useSettings } from '../../hooks/useSettings';
import { useToast } from '../../components/feedback/Toast';

const ACCEPTED = /\.(pgn|txt)$/i;
const PASTE_PLACEHOLDER = '[White "Você"]\n[Black "Adversário"]\n\n1. e4 e5 2. Nf3 Nc6 …';

export function ImportPanel() {
  const settings = useSettings();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [results, setResults] = useState<ImportSummary[]>([]);
  const [pasted, setPasted] = useState('');
  const isPasteTooLarge = pasted.length > MAX_PGN_BYTES;

  const reportImported = (out: ImportSummary[]) => {
    setResults(out);
    const imported = out.reduce((s, r) => s + r.record.imported, 0);
    if (out.length) toast(`${imported} partida(s) importada(s)`, imported ? 'good' : 'warn');
  };

  const handlePaste = async () => {
    setIsBusy(true);
    try {
      const summary = await importPastedPgn(pasted, settings.playerNames);
      reportImported([summary]);
      // Keep the text when nothing was imported, so the user can fix it.
      if (summary.record.imported > 0) setPasted('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha na importação do texto colado', 'bad');
    } finally {
      setIsBusy(false);
    }
  };

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
    setIsBusy(false);
    reportImported(out);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <section className="panel import-panel" aria-labelledby="import-title">
      <div className="panel-head">
        <h2 id="import-title">Importar PGN</h2>
        <span className="xs faint">Processado localmente — nada é enviado</span>
      </div>
      <div className="import-sources">
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
      <div className="paste-box">
        <label htmlFor="pgn-paste" className="small paste-label">
          <ClipboardPaste size={15} aria-hidden="true" /> Ou cole o PGN aqui
        </label>
        <textarea
          id="pgn-paste"
          data-testid="pgn-paste"
          className="paste-area mono"
          rows={4}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={PASTE_PLACEHOLDER}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          aria-describedby="pgn-paste-help"
        />
        <div className="row paste-actions">
          <span id="pgn-paste-help" className={`xs ${isPasteTooLarge ? 'paste-error' : 'faint'}`}>
            {isPasteTooLarge ? 'Texto grande demais (limite de 20 MB).' : 'Uma ou várias partidas; mesma validação e deduplicação dos arquivos.'}
          </span>
          <button className="btn btn-primary" onClick={() => void handlePaste()} disabled={isBusy || pasted.trim().length === 0 || isPasteTooLarge} data-testid="pgn-paste-submit">
            {isBusy ? <Loader2 className="spin" size={15} /> : <ClipboardPaste size={15} />} Importar texto
          </button>
        </div>
      </div>
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
