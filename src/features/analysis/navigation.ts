import { applyUci, uciLineToSan, type PlyInfo } from '../../services/chess/position';

/** A side line explored from a main-line position. */
export interface Variation {
  basePly: number;
  moves: string[]; // UCI
  index: number; // number of variation moves currently applied
}

export interface NavState {
  ply: number;
  variation: Variation | null;
}

export type NavAction =
  | { type: 'goto'; ply: number }
  | { type: 'step'; delta: number }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'play'; uci: string }
  | { type: 'showLine'; basePly: number; moves: string[] }
  | { type: 'extendLine'; moves: string[] }
  | { type: 'varGoto'; index: number }
  | { type: 'exitVariation' };

export function navReducer(plies: readonly PlyInfo[]) {
  const max = plies.length;
  const clamp = (n: number) => Math.max(0, Math.min(max, n));
  return (s: NavState, a: NavAction): NavState => {
    switch (a.type) {
      case 'goto':
        return { ply: clamp(a.ply), variation: null };
      case 'first':
        return { ply: 0, variation: null };
      case 'last':
        return { ply: max, variation: null };
      case 'step': {
        if (s.variation) {
          const index = s.variation.index + a.delta;
          if (index < 0) return { ply: s.variation.basePly, variation: null };
          return { ...s, variation: { ...s.variation, index: Math.min(s.variation.moves.length, index) } };
        }
        return { ply: clamp(s.ply + a.delta), variation: null };
      }
      case 'play': {
        if (!s.variation) {
          if (plies[s.ply]?.uci === a.uci) return { ply: s.ply + 1, variation: null };
          return { ply: s.ply, variation: { basePly: s.ply, moves: [a.uci], index: 1 } };
        }
        const v = s.variation;
        if (v.moves[v.index] === a.uci) return { ...s, variation: { ...v, index: v.index + 1 } };
        return { ...s, variation: { ...v, moves: [...v.moves.slice(0, v.index), a.uci], index: v.index + 1 } };
      }
      case 'showLine':
        return { ply: a.basePly, variation: { basePly: a.basePly, moves: a.moves, index: 1 } };
      case 'extendLine': {
        if (!s.variation) return { ply: s.ply, variation: { basePly: s.ply, moves: a.moves, index: 1 } };
        const v = s.variation;
        return { ...s, variation: { ...v, moves: [...v.moves.slice(0, v.index), ...a.moves], index: v.index + 1 } };
      }
      case 'varGoto':
        return s.variation ? { ...s, variation: { ...s.variation, index: Math.max(0, Math.min(s.variation.moves.length, a.index)) } } : s;
      case 'exitVariation':
        return { ply: s.variation?.basePly ?? s.ply, variation: null };
    }
  };
}

export interface DisplayedPosition {
  fen: string;
  lastMove: { from: string; to: string } | null;
  variationSan: string[];
}

/** FEN and last move currently shown, following the variation when present. */
export function displayed(fens: readonly string[], plies: readonly PlyInfo[], s: NavState): DisplayedPosition {
  if (!s.variation) {
    const p = plies[s.ply - 1];
    return { fen: fens[s.ply] as string, lastMove: p ? { from: p.from, to: p.to } : null, variationSan: [] };
  }
  const base = fens[s.variation.basePly] as string;
  let fen = base;
  let last: string | undefined;
  for (const uci of s.variation.moves.slice(0, s.variation.index)) {
    const next = applyUci(fen, uci);
    if (!next) break;
    fen = next;
    last = uci;
  }
  return {
    fen,
    lastMove: last ? { from: last.slice(0, 2), to: last.slice(2, 4) } : null,
    variationSan: uciLineToSan(base, s.variation.moves),
  };
}
