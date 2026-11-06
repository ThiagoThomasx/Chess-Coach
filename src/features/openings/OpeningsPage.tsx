import { useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Star, Trash2 } from 'lucide-react';
import { getDb } from '../../db/database';
import { deleteCustomOpening, toggleRepertoire } from '../../db/openingsRepo';
import { OPENINGS, matchOpening } from '../../services/openings/library';
import { validateLine } from '../../services/openings/practice';
import { ChessBoard } from '../../components/board/ChessBoard';
import { OpeningPractice } from './OpeningPractice';
import { CustomLineForm } from './CustomLineForm';
import type { Color, Opening } from '../../types/domain';

type Mode = 'study' | 'practice' | 'add';

/** Single-column layout (features.css): the library comes after the board and the line details. */
const STACKED_LAYOUT = '(max-width: 760px)';

export function OpeningsPage() {
  const custom = useLiveQuery(() => getDb().customOpenings.toArray(), [], []);
  const repertoire = useLiveQuery(() => getDb().repertoire.toArray(), [], []);
  const games = useLiveQuery(() => getDb().games.toArray(), [], []);
  const attempts = useLiveQuery(() => getDb().openingAttempts.toArray(), [], []);
  const all: Opening[] = [...OPENINGS, ...custom];
  const [selectedId, setSelectedId] = useState(OPENINGS[0]?.id ?? '');
  const [lineId, setLineId] = useState('main');
  const [mode, setMode] = useState<Mode>('study');
  const [ply, setPly] = useState(0);
  const boardRef = useRef<HTMLElement>(null);
  const opening = all.find((o) => o.id === selectedId) ?? all[0];
  if (!opening) return null;
  const lines = [opening.mainLine, ...opening.variations];
  const line = lines.find((l) => l.id === lineId) ?? opening.mainLine;
  const fens = validateLine(line.moves).fens;
  const shown = Math.min(ply, line.moves.length);
  const inRepertoire = repertoire.some((r) => r.id === `${opening.id}:${line.id}`);
  const lineAttempts = attempts.filter((a) => a.openingId === opening.id && a.lineId === line.id);
  const myGames = games.filter((g) => matchOpening(g.moves, custom)?.opening.id === opening.id);
  const now = Date.now();
  const dueLines = repertoire.filter((r) => r.srs.dueAt <= now);

  const select = (id: string) => {
    setSelectedId(id);
    setLineId('main');
    setPly(0);
    setMode('study');
  };
  /** From the library on a phone, the chosen line's board is out of view: bring it back. */
  const pickFromLibrary = (id: string) => {
    select(id);
    if (window.matchMedia?.(STACKED_LAYOUT).matches) boardRef.current?.scrollIntoView({ block: 'start' });
  };
  const sideLabel = (c: Color) => (c === 'w' ? 'Brancas' : 'Pretas');
  const lastMove = (() => {
    if (shown === 0) return null;
    const m = new Chess(fens[shown - 1]).move(line.moves[shown - 1] as string);
    return { from: m.from, to: m.to };
  })();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Aberturas</h1>
          <p>Biblioteca inicial com linhas principais verificadas por regras do xadrez, ideias gerais e treino de continuação. Adicione suas próprias linhas ao repertório.</p>
        </div>
        {dueLines.length > 0 && <span className="tag tag-info">{dueLines.length} linha(s) do repertório para revisar</span>}
      </header>
      <div className="openings">

        <section className="stack openings-board" ref={boardRef}>
          {mode === 'add' ? (
            <div className="panel">
              <h2>Nova linha pessoal</h2>
              <div style={{ marginTop: '0.8rem' }}>
                <CustomLineForm onCreated={(id) => select(id)} />
              </div>
            </div>
          ) : mode === 'practice' ? (
            <OpeningPractice key={`${opening.id}:${line.id}`} opening={opening} line={line} side={opening.side} />
          ) : (
            <>
              <ChessBoard fen={fens[shown] as string} orientation={opening.side === 'w' ? 'white' : 'black'} lastMove={lastMove} id="opening-board" />
              <div className="controls">
                <button className="btn btn-icon" aria-label="Voltar" onClick={() => setPly(Math.max(0, shown - 1))}>
                  <ChevronLeft size={18} />
                </button>
                <button className="btn btn-icon" aria-label="Avançar" onClick={() => setPly(Math.min(line.moves.length, shown + 1))}>
                  <ChevronRight size={18} />
                </button>
              </div>
              <div className="line-chip">
                {line.moves.map((m, i) => (
                  <button key={i} className="btn btn-ghost btn-sm" aria-current={i + 1 === shown} style={i + 1 === shown ? { color: 'var(--info)' } : undefined} onClick={() => setPly(i + 1)}>
                    {i % 2 === 0 ? `${i / 2 + 1}.` : ''}
                    {m}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel stack openings-details">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h2>{opening.name}</h2>
            {opening.custom && (
              <button className="btn btn-ghost btn-icon" aria-label="Excluir linha pessoal" onClick={() => confirm('Excluir esta linha pessoal?') && void deleteCustomOpening(opening.id).then(() => select(OPENINGS[0]?.id ?? ''))}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
          <div className="tabs" role="tablist">
            {lines.map((l) => (
              <button key={l.id} role="tab" aria-selected={l.id === line.id} onClick={() => (setLineId(l.id), setPly(0))}>
                {l.name}
              </button>
            ))}
          </div>
          {line.comment && <p className="callout small">{line.comment}</p>}
          <div className="row">
            <button className={`btn ${mode === 'practice' ? '' : 'btn-primary'}`} onClick={() => setMode(mode === 'practice' ? 'study' : 'practice')} data-testid="practice-toggle">
              {mode === 'practice' ? 'Voltar ao estudo' : `Praticar como ${sideLabel(opening.side)}`}
            </button>
            <button className="btn" aria-pressed={inRepertoire} onClick={() => void toggleRepertoire(opening.id, line.id, opening.side)}>
              <Star size={15} fill={inRepertoire ? 'currentColor' : 'none'} /> {inRepertoire ? 'No repertório' : 'Salvar no repertório'}
            </button>
          </div>
          {lineAttempts.length > 0 && (
            <p className="xs muted">
              Treinos desta linha: {lineAttempts.length} · {lineAttempts.filter((a) => a.correct).length} sem erros
            </p>
          )}
          {opening.goals.length > 0 && (
            <div>
              <h3>Objetivos estratégicos</h3>
              <ul className="bullets">{opening.goals.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          )}
          {opening.tacticalIdeas.length > 0 && (
            <div>
              <h3>Ideias táticas</h3>
              <ul className="bullets">{opening.tacticalIdeas.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          )}
          {opening.commonMistakes.length > 0 && (
            <div>
              <h3>Erros comuns</h3>
              <ul className="bullets">{opening.commonMistakes.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          )}
          <div>
            <h3>Nas suas partidas</h3>
            {myGames.length === 0 ? (
              <p className="small muted">Nenhuma partida importada segue esta linha.</p>
            ) : (
              <ul className="bullets">
                {myGames.slice(0, 5).map((g) => (
                  <li key={g.id}>
                    <Link to={`/analysis/${g.id}`}>
                      {g.headers.white} × {g.headers.black} ({g.headers.result})
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!opening.custom && <p className="xs faint">As ideias descritas são princípios gerais amplamente aceitos, não uma análise teórica exaustiva.</p>}
        </section>

        <aside className="panel openings-library">
          <h3>Biblioteca</h3>
          <div className="opening-list" style={{ marginTop: '0.5rem' }}>
            {all.map((o) => (
              <button key={o.id} aria-current={o.id === opening.id} onClick={() => pickFromLibrary(o.id)} data-testid="opening-item">
                <span className="small">
                  {repertoire.some((r) => r.openingId === o.id) && <Star size={12} color="var(--accent)" style={{ marginRight: 4 }} />}
                  {o.name}
                </span>
                <span className="xs faint">
                  {o.custom ? 'Linha pessoal' : o.eco} · {sideLabel(o.side)}
                </span>
              </button>
            ))}
          </div>
          <hr className="divider" />
          <button className="btn btn-sm" onClick={() => setMode('add')}>
            + Adicionar linha manualmente
          </button>
        </aside>
      </div>
    </div>
  );
}
