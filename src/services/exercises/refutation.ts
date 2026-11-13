import type { Color, Score } from '../../types/domain';
import { uciLineToSan } from '../chess/position';
import { settledSwing } from '../chess/material';
import { winPercentFor } from '../analysis/evaluation';

/** Opponent plies shown after a rejected move (the reply and what follows). */
export const REFUTATION_PLIES = 4;
/** Settled material difference (points) that is named as a material consequence. */
export const MATERIAL_CONSEQUENCE = 3;

export interface RefutationMove {
  uci: string;
  san: string;
}

/** The line that punishes a rejected move, starting with the opponent's reply. */
export interface Refutation {
  line: RefutationMove[];
}

/**
 * Plies after the user's move in an engine line that starts with it, in SAN,
 * up to REFUTATION_PLIES. Undefined when the line has no reply: nothing is invented.
 */
export function refutationLine(fen: string, pv: readonly string[]): RefutationMove[] | undefined {
  const san = uciLineToSan(fen, pv.slice(0, REFUTATION_PLIES + 1)).slice(1);
  if (san.length === 0) return undefined;
  return san.map((s, i) => ({ uci: pv[i + 1] as string, san: s }));
}

export interface ConsequenceInput {
  /** Position before the user's move. */
  fen: string;
  solver: Color;
  /** White-POV scores of the user's move and of the reference move. */
  played: Score;
  reference: Score;
  /** Engine lines starting with the user's move and with the reference move (same search). */
  pv?: readonly string[];
  referencePv?: readonly string[];
}

type Band = 'decisive' | 'advantage' | 'equal' | 'disadvantage' | 'lost';
const BAND_LABEL: Record<Band, string> = {
  decisive: 'vantagem decisiva',
  advantage: 'vantagem',
  equal: 'igualdade',
  disadvantage: 'desvantagem',
  lost: 'posição perdida',
};
const BAND_ORDER: readonly Band[] = ['lost', 'disadvantage', 'equal', 'advantage', 'decisive'];

function bandOf(win: number): Band {
  if (win >= 80) return 'decisive';
  if (win >= 60) return 'advantage';
  if (win > 40) return 'equal';
  if (win > 20) return 'disadvantage';
  return 'lost';
}

function sizeOf(points: number): string {
  if (points >= 8) return 'uma dama';
  if (points >= 5) return 'uma torre';
  return 'uma peça';
}

/** Opponent's mate distance after the user's move, or null when the solver is not being mated. */
function matedIn(score: Score, solver: Color): number | null {
  if (score.kind !== 'mate' || score.value === 0) return null;
  const opponentMates = solver === 'w' ? score.value < 0 : score.value > 0;
  return opponentMates ? Math.ceil(Math.abs(score.value)) : null;
}

/** Settled material consequence of the user's line, compared with the reference line when known. */
function materialConsequence(input: ConsequenceInput): string | null {
  if (!input.pv || input.pv.length < 2) return null;
  const mine = settledSwing(input.fen, input.pv, input.solver);
  if (!mine.settled) return null;
  const ref = input.referencePv && input.referencePv.length > 0 ? settledSwing(input.fen, input.referencePv, input.solver) : null;
  // Material is named only against a settled reference line: without one, the best move might lose the same
  // material, and the loss would be blamed on the user's move (Sprint 4.6 audit, AC-7). The band rule applies.
  if (!ref?.settled) return null;
  const refDelta = ref.delta;
  if (mine.delta <= -MATERIAL_CONSEQUENCE && refDelta - mine.delta >= MATERIAL_CONSEQUENCE) {
    return `perde material (cerca de ${sizeOf(-mine.delta)})`;
  }
  if (refDelta - mine.delta >= MATERIAL_CONSEQUENCE) {
    return `deixa de ganhar material (cerca de ${sizeOf(refDelta - mine.delta)})`;
  }
  return null;
}

/** Change of the position from the reference move to the user's move, in words. */
function bandConsequence(input: ConsequenceInput): string {
  const from = bandOf(winPercentFor(input.reference, input.solver));
  const to = bandOf(winPercentFor(input.played, input.solver));
  if (from !== to) return `a posição passa de ${BAND_LABEL[from]} para ${BAND_LABEL[to]}`;
  const rank = BAND_ORDER.indexOf(from);
  if (rank >= BAND_ORDER.indexOf('advantage')) return 'reduz a vantagem';
  if (from === 'equal') return 'piora a posição';
  return 'piora uma posição já difícil';
}

/**
 * The loss of a rejected move as a concrete consequence, by verifiable rules
 * (docs/METHODOLOGY.md): a mate against the user; else a settled material
 * difference of MATERIAL_CONSEQUENCE points or more; else the change of the
 * win-expectancy band. Never in percentage points.
 */
export function consequenceOf(input: ConsequenceInput): string {
  const mate = matedIn(input.played, input.solver);
  if (mate !== null) return `permite mate em ${mate}`;
  return materialConsequence(input) ?? bandConsequence(input);
}

/** SAN moves played from `fen`, with move numbers ("12… Qxd4 13. Kf1"). */
export function numberedLine(fen: string, sans: readonly string[]): string {
  const [, side = 'w', , , , full = '1'] = fen.split(' ');
  let moveNo = Number.parseInt(full, 10) || 1;
  let white = side === 'w';
  const parts: string[] = [];
  sans.forEach((san, i) => {
    if (white) parts.push(`${moveNo}. ${san}`);
    else parts.push(i === 0 ? `${moveNo}… ${san}` : san);
    if (!white) moveNo++;
    white = !white;
  });
  return parts.join(' ');
}
