import { useEffect, useRef, useState } from 'react';
import { Download, HardDrive, Upload } from 'lucide-react';
import { clearData, exportBackupFile, restoreBackup, storageEstimate, validateBackup, type BackupDownload, type ClearScope } from '../../services/backup/backup';
import { useToast } from '../../components/feedback/Toast';
import { useSettings } from '../../hooks/useSettings';

const CLEAR_LABEL: Record<ClearScope, { label: string; warn: string }> = {
  analyses: { label: 'Análises do motor', warn: 'Apaga análises e o cache de avaliações. As partidas, exercícios e o perfil são mantidos.' },
  training: { label: 'Exercícios e histórico de treino', warn: 'Apaga exercícios, tentativas, posições marcadas e todas as evidências do perfil de competências. O histórico de aprendizado será perdido.' },
  openings: { label: 'Repertório e treinos de abertura', warn: 'Apaga linhas pessoais, repertório e histórico de treino de aberturas.' },
  all: { label: 'Tudo', warn: 'Apaga TODOS os dados locais, incluindo partidas e todo o histórico de aprendizado. Exporte um backup antes.' },
};

/** Hands the file to the browser as a download; throws if the browser refuses to start it. */
function startBrowserDownload({ name, blob }: BackupDownload): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fmtBytes(n?: number): string {
  if (n === undefined) return 'n/d';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DataPanel() {
  const toast = useToast();
  const { lastBackupAt } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof storageEstimate>> | null>(null);
  const [scope, setScope] = useState<ClearScope>('analyses');

  const refresh = () => void storageEstimate().then(setInfo).catch(() => setInfo(null));
  useEffect(refresh, []);

  const download = async () => {
    try {
      // The date of the last export is recorded only after the download was requested (Sprint 4.8, N-1).
      await exportBackupFile(startBrowserDownload);
      toast('Backup exportado. Confira se o arquivo foi salvo na pasta de downloads.', 'good');
    } catch (e) {
      console.error('ChessQuest: falha ao exportar o backup', e);
      toast('Não foi possível exportar o backup. A data da última exportação não foi alterada.', 'bad');
    }
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
      <div>
        <p className="small" data-testid="last-backup">
          Última exportação de backup: {lastBackupAt !== undefined ? new Date(lastBackupAt).toLocaleDateString('pt-BR') : 'nenhuma neste navegador'}
        </p>
        <p className="xs faint">Data da última exportação iniciada (ou do backup restaurado). O navegador não informa se o arquivo foi salvo.</p>
      </div>
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
