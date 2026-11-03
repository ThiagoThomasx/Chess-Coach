import { useMemo, useState, type CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, type Square } from 'chess.js';
import { useSettings } from '../../hooks/useSettings';
import type { Settings } from '../../types/domain';

export interface BoardArrow {
  from: string;
  to: string;
  color?: string;
}

interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  /** Return true to accept the move. Absent → board is read-only. */
  onMove?: (uci: string) => boolean;
  lastMove?: { from: string; to: string } | null;
  arrows?: BoardArrow[];
  highlights?: Record<string, CSSProperties>;
  id?: string;
}

const THEMES: Record<Settings['boardTheme'], { light: string; dark: string }> = {
  slate: { light: '#c9cfd6', dark: '#6b7a8c' },
  walnut: { light: '#e8d3b0', dark: '#a87b52' },
  olive: { light: '#e3e4cf', dark: '#7d9161' },
};

const LAST_MOVE = 'rgba(217, 178, 106, 0.42)';
const SELECTED = 'rgba(122, 167, 230, 0.55)';

/** Promotion is automatic to a queen, except when only an under-promotion is legal (never the case). */
function toUci(fen: string, from: string, to: string): string | null {
  const chess = new Chess(fen);
  const legal = chess.moves({ square: from as Square, verbose: true }).filter((m) => m.to === to);
  if (legal.length === 0) return null;
  const promo = legal.find((m) => m.promotion === 'q') ?? legal[0];
  return `${from}${to}${promo?.promotion ?? ''}`;
}

export function ChessBoard({ fen, orientation, onMove, lastMove, arrows = [], highlights = {}, id = 'board' }: ChessBoardProps) {
  const settings = useSettings();
  const [selected, setSelected] = useState<string | null>(null);
  const theme = THEMES[settings.boardTheme];
  const interactive = !!onMove;

  const targets = useMemo(() => {
    if (!selected) return [];
    try {
      return new Chess(fen).moves({ square: selected as Square, verbose: true }).map((m) => m.to);
    } catch {
      return [];
    }
  }, [fen, selected]);

  const squareStyles = useMemo(() => {
    const s: Record<string, CSSProperties> = {};
    if (lastMove) {
      s[lastMove.from] = { background: LAST_MOVE };
      s[lastMove.to] = { background: LAST_MOVE };
    }
    Object.assign(s, highlights);
    if (selected) s[selected] = { background: SELECTED };
    for (const t of targets) s[t] = { ...s[t], backgroundImage: 'radial-gradient(circle, rgba(20,22,26,.45) 18%, transparent 20%)' };
    return s;
  }, [lastMove, highlights, selected, targets]);

  const attempt = (from: string, to: string): boolean => {
    if (!onMove) return false;
    const uci = toUci(fen, from, to);
    setSelected(null);
    return uci ? onMove(uci) : false;
  };

  const sideToMove = fen.split(' ')[1];

  return (
    <div className="board-frame" data-testid={id}>
      <Chessboard
        options={{
          id,
          position: fen,
          boardOrientation: orientation,
          allowDragging: interactive,
          showNotation: settings.showCoordinates,
          animationDurationInMs: settings.animationMs,
          darkSquareStyle: { backgroundColor: theme.dark },
          lightSquareStyle: { backgroundColor: theme.light },
          squareStyles,
          arrows: arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color ?? 'rgba(122,167,230,0.85)' })),
          allowDrawingArrows: true,
          canDragPiece: ({ piece }) => interactive && piece.pieceType[0] === sideToMove,
          onPieceDrop: ({ sourceSquare, targetSquare }) => (targetSquare ? attempt(sourceSquare, targetSquare) : false),
          onSquareClick: ({ square, piece }) => {
            if (!interactive) return;
            if (selected && targets.includes(square as Square)) {
              attempt(selected, square);
              return;
            }
            setSelected(piece && piece.pieceType[0] === sideToMove ? square : null);
          },
        }}
      />
    </div>
  );
}
