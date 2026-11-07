import { useEffect, useMemo, useReducer, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Bookmark, BookmarkCheck, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2, Undo2 } from 'lucide-react';
import { getDb } from '../../db/database';
import { markBookmarkReviewed, toggleBookmark } from '../../db/analysisRepo';
import { useSettings } from '../../hooks/useSettings';
import { replayGame, sideToMove } from '../../services/chess/position';
import { ChessBoard, type BoardArrow } from '../../components/board/ChessBoard';
import { EvalBar } from '../../components/board/EvalBar';
import { EvalGraph } from '../../components/charts/EvalGraph';
import { MoveList } from './MoveList';
import { AnalysisControls } from './AnalysisControls';
import { ExplanationPanel } from './ExplanationPanel';
import { EnginePanel } from './EnginePanel';
import { GameSummaryPanel } from './GameSummaryPanel';
import { CurrentMoveStrip } from './CurrentMoveStrip';
import { displayed, navReducer } from './navigation';
import { badgeForReview } from '../../services/analysis/moveBadge';
import type { Game, MoveReview } from '../../types/domain';

export function AnalysisPage() {
  const { gameId = '' } = useParams();
  const game = useLiveQuery(() => getDb().games.get(gameId), [gameId], null);
  if (game === null) return <div className="page muted">Carregando…</div>;
  if (!game) {
    return (
      <div className="page">
        <p className="callout callout-warn">Partida não encontrada.</p>
        <Link to="/games">Voltar às partidas</Link>
      </div>
    );
  }
  return <AnalysisView key={game.id} game={game} />;
}

function AnalysisView({ game }: { game: Game }) {
  const settings = useSettings();
  const gameId = game.id;
  const analysis = useLiveQuery(() => getDb().analyses.get(gameId), [gameId]);
  const bookmarks = useLiveQuery(() => getDb().bookmarks.where('gameId').equals(gameId).toArray(), [gameId], []);

  const plies = useMemo(() => replayGame(game.moves, game.startFen), [game]);
  const fens = useMemo(() => [game.startFen, ...plies.map((p) => p.fenAfter)], [game, plies]);
  const reducer = useMemo(() => navReducer(plies), [plies]);
  const [params] = useSearchParams();
  const initialPly = Math.max(0, Math.min(plies.length, Number(params.get('ply') ?? 0) || 0));
  const [nav, dispatch] = useReducer(reducer, { ply: initialPly, variation: null });

  useEffect(() => {
    // Opening a bookmarked position from the dashboard counts as reviewing it.
    if (!params.get('ply')) return;
    const b = bookmarks.find((x) => x.ply === initialPly && !x.reviewedAt);
    if (b) void markBookmarkReviewed(b.id);
  }, [bookmarks, initialPly, params]);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') dispatch({ type: 'step', delta: -1 });
      else if (e.key === 'ArrowRight') dispatch({ type: 'step', delta: 1 });
      else if (e.key === 'Home') dispatch({ type: 'first' });
      else if (e.key === 'End') dispatch({ type: 'last' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const view = displayed(fens, plies, nav);
  const reviews = new Map<number, MoveReview>((analysis?.reviews ?? []).map((r) => [r.ply, r]));
  const review = nav.variation ? undefined : reviews.get(nav.ply);
  const positions = analysis?.positions ?? [];
  const before = nav.ply > 0 ? (positions[nav.ply - 1] ?? null) : null;
  const after = positions[nav.ply] ?? null;
  const baseOrientation = settings.boardOrientation === 'auto' ? (game.userColor === 'b' ? 'black' : 'white') : settings.boardOrientation;
  const orientation = flipped ? (baseOrientation === 'white' ? 'black' : 'white') : baseOrientation;
  const evalScore = nav.variation ? undefined : after?.lines[0]?.score;
  const isBookmarked = bookmarks.some((b) => b.ply === nav.ply);

  const arrows: BoardArrow[] = [];
  if (review && review.bestMoveUci && review.bestMoveUci !== review.uci && review.classification !== 'best') {
    arrows.push({ from: review.bestMoveUci.slice(0, 2), to: review.bestMoveUci.slice(2, 4), color: 'rgba(116,183,127,0.9)' });
  }

  const top = orientation === 'white' ? { name: game.headers.black, elo: game.headers.blackElo } : { name: game.headers.white, elo: game.headers.whiteElo };
  const bottom = orientation === 'white' ? { name: game.headers.white, elo: game.headers.whiteElo } : { name: game.headers.black, elo: game.headers.blackElo };
  const firstMoveNumber = Number(game.startFen.split(' ')[5] ?? '1');
  const shownPly = nav.ply > 0 ? plies[nav.ply - 1] : undefined;
  const blackOffset = sideToMove(game.startFen) === 'b' ? 1 : 0;
  const moveLabel = shownPly && `${firstMoveNumber + Math.floor((nav.ply - 1 + blackOffset) / 2)}${shownPly.color === 'w' ? '.' : '…'} ${shownPly.san}`;
  const betterSan = arrows.length > 0 ? review?.bestMoveSan : undefined;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link to="/games" className="small row touch-link">
            <ArrowLeft size={14} /> Partidas
          </Link>
          <h1 style={{ marginTop: '0.3rem' }}>
            {game.headers.white} × {game.headers.black}
          </h1>
          <p>
            {[game.headers.event, game.headers.date, game.headers.timeControl && `ritmo ${game.headers.timeControl}`, game.headers.result].filter(Boolean).join(' · ')}
          </p>
        </div>
      </header>
      <div className="analysis">
        <div className="analysis-board">
          <div className="player-strip">
            <span className="name">{top.name}</span>
            {top.elo && <span className="xs faint">Elo PGN {top.elo}</span>}
          </div>
          <div className="board-wrap">
            <EvalBar score={evalScore} orientation={orientation} isPending={!!analysis && analysis.status !== 'complete'} />
            <ChessBoard fen={view.fen} orientation={orientation} lastMove={view.lastMove} arrows={arrows} badge={badgeForReview(review)} onMove={(uci) => (dispatch({ type: 'play', uci }), true)} id="analysis-board" />
          </div>
          <div className="player-strip">
            <span className="name">{bottom.name}</span>
            {bottom.elo && <span className="xs faint">Elo PGN {bottom.elo}</span>}
          </div>
          <CurrentMoveStrip label={moveLabel} review={review} isInVariation={!!nav.variation} betterSan={betterSan} />
          {nav.variation && (
            <div className="variation-bar fade-in" data-testid="variation-bar">
              <strong className="xs">Variante</strong>
              <span className="line-chip">
                {view.variationSan.map((san, i) => (
                  <button key={i} aria-current={nav.variation?.index === i + 1} onClick={() => dispatch({ type: 'varGoto', index: i + 1 })}>
                    {san}
                  </button>
                ))}
              </span>
              <span className="spacer" />
              <button className="btn btn-sm" onClick={() => dispatch({ type: 'exitVariation' })}>
                <Undo2 size={14} /> Linha principal
              </button>
            </div>
          )}
          <div className="controls">
            <button className="btn btn-icon" aria-label="Primeiro lance" onClick={() => dispatch({ type: 'first' })}>
              <ChevronFirst size={18} />
            </button>
            <button className="btn btn-icon" aria-label="Voltar um lance" onClick={() => dispatch({ type: 'step', delta: -1 })} data-testid="prev">
              <ChevronLeft size={18} />
            </button>
            <button className="btn btn-icon" aria-label="Avançar um lance" onClick={() => dispatch({ type: 'step', delta: 1 })} data-testid="next">
              <ChevronRight size={18} />
            </button>
            <button className="btn btn-icon" aria-label="Último lance" onClick={() => dispatch({ type: 'last' })} data-testid="last">
              <ChevronLast size={18} />
            </button>
            <button className="btn btn-icon" aria-label="Girar tabuleiro" onClick={() => setFlipped((f) => !f)}>
              <FlipVertical2 size={17} />
            </button>
            <button
              className="btn btn-icon"
              aria-label={isBookmarked ? 'Remover marcação de revisão' : 'Marcar posição para revisão'}
              aria-pressed={isBookmarked}
              disabled={!!nav.variation}
              onClick={() => void toggleBookmark(game.id, nav.ply, view.fen)}
            >
              {isBookmarked ? <BookmarkCheck size={17} color="var(--accent)" /> : <Bookmark size={17} />}
            </button>
          </div>
          <div className="fen" title="FEN da posição exibida" data-testid="fen">
            {view.fen}
          </div>
          <div className="xs faint">
            {sideToMove(view.fen) === 'w' ? 'Brancas' : 'Pretas'} jogam · use ← → para navegar · arraste peças para explorar variantes
          </div>
        </div>
        <div className="analysis-side">
          <AnalysisControls game={game} analysis={analysis} settings={settings} />
          <section className="panel">
            <div className="panel-head">
              <h2>Lances</h2>
              <span className="xs faint mono">
                {nav.ply}/{plies.length}
              </span>
            </div>
            <MoveList
              plies={plies}
              reviews={reviews}
              currentPly={nav.ply}
              isInVariation={!!nav.variation}
              startsWithBlack={sideToMove(game.startFen) === 'b'}
              firstMoveNumber={firstMoveNumber}
              onSelect={(ply) => dispatch({ type: 'goto', ply })}
            />
          </section>
          <ExplanationPanel key={nav.ply} game={game} review={review} before={before} after={after} settings={settings} />
          {analysis && analysis.positions.some(Boolean) && (
            <section className="panel">
              <EvalGraph positions={analysis.positions} currentPly={nav.ply} onSelect={(ply) => dispatch({ type: 'goto', ply })} />
            </section>
          )}
          <EnginePanel
            alternatives={nav.variation ? null : before}
            alternativesBasePly={Math.max(0, nav.ply - 1)}
            displayedFen={view.fen}
            settings={settings}
            onShowLine={(basePly, _fen, moves) => dispatch(basePly === null ? { type: 'extendLine', moves } : { type: 'showLine', basePly, moves })}
          />
          {analysis && analysis.reviews.length > 0 && <GameSummaryPanel game={game} reviews={analysis.reviews} />}
        </div>
      </div>
    </div>
  );
}
