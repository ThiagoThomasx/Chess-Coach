import { useEffect, useRef, useState } from 'react';
import { Download, HardDrive, Upload } from 'lucide-react';
import { clearData, exportBackup, restoreBackup, storageEstimate, validateBackup, type ClearScope } from '../../services/backup/backup';
import { useToast } from '../../components/feedback/Toast';

const CLEAR_LABEL: Record<ClearScope, { label: string; warn: string }> = {
  analyses: { label: 'Análises do motor', warn: 'Apaga análises e o cache de avaliações. As partidas, exercícios e o perfil são mantidos.' },
  training: { label: 'Exercícios e histórico de treino', warn: 'Apaga exercícios, tentativas, posições marcadas e todas as evidências do perfil de competências. O histórico de aprendizado será perdido.' },
  openings: { label: 'Repertório e treinos de abertura', warn: 'Apaga linhas pessoais, repertório e histórico de treino de aberturas.' },
  all: { label: 'Tudo', warn: 'Apaga TODOS os dados locais, incluindo partidas e todo o histórico de aprendizado. Exporte um backup antes.' },
};

function fmtBytes(n?: number): string {
  if (n === undefined) return 'n/d';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DataPanel() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof storageEstimate>> | null>(null);
  const [scope, setScope] = useState<ClearScope>('analyses');

  const refresh = () => void storageEstimate().then(setInfo).catch(() => setInfo(null));
  useEffect(refresh, []);

  const download = async () => {
    const data = await exportBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chessquest-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup exportado', 'good');
  };

  const restore = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast('Arquivo inválido: não é JSON', 'bad');
      return;
    }
    const v = validateBackup(parsed);
    if (!v.ok) {
      toast(`Backup recusado: ${v.errors.slice(0, 3).join('; ')}`, 'bad');
      return;
    }
    const summary = Object.entries(v.counts)
      .map(([k, n]) => `${k}: ${n}`)
      .join(', ');
    if (!confirm(`O backup é válido (${summary}). Restaurar substituirá os dados atuais das tabelas incluídas. Continuar?`)) return;
    const r = await restoreBackup(parsed);
    toast(r.ok ? 'Backup restaurado' : 'Falha ao restaurar; nenhum dado foi alterado', r.ok ? 'good' : 'bad');
    refresh();
  };

  const clear = async () => {
    if (!confirm(`${CLEAR_LABEL[scope].warn}\n\nEsta ação não pode ser desfeita. Continuar?`)) return;
    await clearData(scope);
    toast('Dados apagados', 'info');
    refresh();
  };

  const persist = async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? 'O navegador manterá os dados mesmo com pouco espaço' : 'O navegador não concedeu armazenamento persistente', ok ? 'good' : 'warn');
    refresh();
  };

  return (
    <section className="panel stack" aria-labelledby="data-title">
      <h2 id="data-title" className="row">
        <HardDrive size={16} /> Dados locais
      </h2>
      <p className="small muted">
        Tudo fica no IndexedDB deste navegador (banco <span className="mono">chessquest</span>). Nada é enviado para servidores. Limpar os dados do site no navegador apaga seu histórico — mantenha backups.
      </p>
      {info && (
        <div className="small">
          <div>
            Uso: <span className="mono">{fmtBytes(info.usage)}</span> de <span className="mono">{fmtBytes(info.quota)}</span> · persistente: {info.persisted ? 'sim' : 'não'}
          </div>
          <div className="xs faint mono" style={{ marginTop: '0.3rem' }}>
            {Object.entries(info.counts)
              .map(([k, n]) => `${k} ${n}`)
              .join(' · ')}
          </div>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" onClick={() => void download()} data-testid="export-backup">
          <Download size={15} /> Exportar backup
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> Restaurar backup
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="restore-input" onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
        {!info?.persisted && (
          <button className="btn btn-ghost" onClick={() => void persist()}>
            Solicitar armazenamento persistente
          </button>
        )}
      </div>
      <hr className="divider" />
      <h3>Limpeza seletiva</h3>
      <div className="row">
        <select className="select" value={scope} onChange={(e) => setScope(e.target.value as ClearScope)} aria-label="O que apagar">
          {(Object.keys(CLEAR_LABEL) as ClearScope[]).map((k) => (
            <option key={k} value={k}>
              {CLEAR_LABEL[k].label}
            </option>
          ))}
        </select>
        <button className="btn btn-danger" onClick={() => void clear()}>
          Apagar
        </button>
      </div>
      <p className="callout callout-warn xs">{CLEAR_LABEL[scope].warn}</p>
    </section>
  );
}
