import { Chess } from 'chess.js';

type Props = { fen: string; orientation: 'white' | 'black' };

const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

/** Lightweight static board for thumbnails (avoids mounting many interactive boards). */
export function MiniBoard({ fen, orientation }: Props) {
  let rows: ReturnType<Chess['board']>;
  try {
    rows = new Chess(fen).board();
  } catch {
    return <div className="mini-board" />;
  }
  const ordered = orientation === 'white' ? rows : [...rows].reverse().map((r) => [...r].reverse());
  return (
    <div className="mini-board" aria-hidden="true">
      {ordered.flatMap((row, r) =>
        row.map((sq, c) => (
          <span key={`${r}${c}`} data-dark={(r + c) % 2 === 1}>
            {sq && <b data-color={sq.color}>{GLYPH[sq.type]}</b>}
          </span>
        )),
      )}
    </div>
  );
}
