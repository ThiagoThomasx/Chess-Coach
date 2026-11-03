import type { Score } from '../../types/domain';

/** Parsed `info` line. Score is relative to the side to move, as UCI defines. */
export interface UciInfo {
  depth?: number;
  seldepth?: number;
  multipv: number;
  score?: Score;
  bound?: 'lower' | 'upper';
  pv?: string[];
  nodes?: number;
  timeMs?: number;
}

export function parseInfoLine(line: string): UciInfo | null {
  if (!line.startsWith('info ')) return null;
  const tokens = line.trim().split(/\s+/);
  const info: UciInfo = { multipv: 1 };
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    switch (t) {
      case 'depth':
        info.depth = Number(next);
        i++;
        break;
      case 'seldepth':
        info.seldepth = Number(next);
        i++;
        break;
      case 'multipv':
        info.multipv = Number(next);
        i++;
        break;
      case 'nodes':
        info.nodes = Number(next);
        i++;
        break;
      case 'time':
        info.timeMs = Number(next);
        i++;
        break;
      case 'score': {
        const kind = tokens[i + 1];
        const val = Number(tokens[i + 2]);
        if ((kind === 'cp' || kind === 'mate') && Number.isFinite(val)) {
          // "mate 0" = side to move is already mated.
          info.score = kind === 'mate' && val === 0 ? { kind: 'mate', value: -0.5 } : { kind, value: val };
        }
        i += 2;
        if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') {
          info.bound = tokens[i + 1] === 'lowerbound' ? 'lower' : 'upper';
          i++;
        }
        break;
      }
      case 'pv':
        info.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
      default:
        break;
    }
  }
  return info;
}

export function parseBestMove(line: string): { best: string | null; ponder?: string } | null {
  const m = /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(line.trim());
  if (!m || m[1] === undefined) return null;
  const best = m[1] === '(none)' || m[1] === '0000' ? null : m[1];
  return m[2] ? { best, ponder: m[2] } : { best };
}
