import { Chess, type Square } from 'chess.js';
import type { Color, MoveReview, Skill, Theme } from '../../types/domain';
import { gamePhase, settledSwing, type SettledSwing } from '../chess/material';
import { applyUci, parseUci, uciLineToSan, uciToSan } from '../chess/position';
import {
  attackedTargets,
  deflectionIn,
  discoveredAttacks,
  enPrise,
  legalRecapturers,
  mateInOne,
  mateThreats,
  overloadedDefenders,
  pinsAgainst,
  seeCapture,
} from '../chess/tactics';
import { hasMateFor } from '../analysis/evaluation';

export type ConceptCategory = 'mate' | 'tactical' | 'positional';

/** A concept detected in a reviewed move, with the facts that justify it. */
export interface Concept {
  theme: Theme;
  category: ConceptCategory;
  /** Whose tactic it is: the player's missed opportunity ("own") or the opponent's ("opponent"). */
  side?: 'own' | 'opponent';
  /** True when every claim is backed by legal-move facts and a settled engine line. */
  verified: boolean;
  evidence: ConceptEvidence;
}

export interface ConceptEvidence {
  square?: Square;
  pieceType?: string;
  capturingMoveSan?: string;
  replySan?: string[];
  bestSan?: string[];
  mateIn?: number;
  /** Exact mate-in-one move (chess.js), when one exists. */
  mateMoveSan?: string;
  /** Opponent had a mate-in-one threat before the move (null-move check). */
  mateThreatBefore?: boolean;
  materialDelta?: number;
  see?: number;
  targets?: { square: Square; type: string }[];
  movedPiece?: string;
  by?: Square;
  defender?: Square;
  pinKind?: 'absolute' | 'relative';
  /** The pin does not exist yet: the opponent's reply creates it. */
  pinCreated?: boolean;
  /** Whether the opponent's reply line reached a quiet point (material measured there). */
  lineSettled?: boolean;
  /** Plies of the reply line played before measuring material. */
  linePlies?: number;
  /**
   * Same-criterion comparison of the best line and the played line: material
   * for the mover at a settled point of each. Present only when both lines
   * settled and the best one keeps more material.
   */
  materialCompare?: { best: number; played: number };
  /** Opponent's mate distance with the best defense vs after the played move. */
  mateCompare?: { best: number; played: number };
}

export const THEME_SKILL: Record<Theme, Skill> = {
  hanging_piece: 'threats',
  ignored_threat: 'threats',
  removed_defender: 'threats',
  missed_capture: 'tactics',
  fork: 'patterns',
  missed_check: 'tactics',
  mate_threat: 'defense',
  missed_mate: 'patterns',
  allowed_mate: 'defense',
  defense: 'defense',
  positional: 'strategy',
  opening: 'openings',
  endgame: 'endgames',
  pin: 'patterns',
  discovered_attack: 'tactics',
  overloaded: 'tactics',
  deflection: 'calculation',
  losing_capture: 'calculation',
  combination: 'calculation',
  conversion: 'strategy',
};

export const THEME_LABEL: Record<Theme, string> = {
  hanging_piece: 'Peça desprotegida',
  ignored_threat: 'Ameaça não respondida',
  removed_defender: 'Defensor removido',
  missed_capture: 'Captura vantajosa',
  fork: 'Ataque duplo',
  missed_check: 'Xeque decisivo',
  mate_threat: 'Ameaça de mate',
  missed_mate: 'Mate disponível',
  allowed_mate: 'Mate permitido',
  defense: 'Defesa necessária',
  positional: 'Jogo posicional',
  opening: 'Princípios de abertura',
  endgame: 'Técnica de finais',
  pin: 'Cravada',
  discovered_attack: 'Ataque descoberto',
  overloaded: 'Peça sobrecarregada',
  deflection: 'Desvio',
  losing_capture: 'Captura que perde material',
  combination: 'Combinação tática',
  conversion: 'Conversão de vantagem',
};

/** Material gain needed (points) before a line counts as tactical. */
export const MATERIAL_THRESHOLD = 2;
/** Material the opponent's settled reply must win (points) for the explanation to cite it. */
export const CITED_LOSS_THRESHOLD = 1;
/** Opponent motifs that only have an "own opportunity" wording; they are reported as a combination. */
const OWN_ONLY_THEMES: readonly Theme[] = ['missed_capture', 'missed_check', 'combination'];

function mateDistance(score: { kind: string; value: number }): number | undefined {
  return score.kind === 'mate' ? Math.max(1, Math.ceil(Math.abs(score.value))) : undefined;
}

function isValuable(t: string): boolean {
  return t === 'k' || t === 'q' || t === 'r' || t === 'b' || t === 'n';
}

/** A pawn pinned along its own file can only push along it anyway: that pin restricts nothing. */
function isMeaningfulPin(p: { pinned: Square; pinnedType: string; by: Square }): boolean {
  return !(p.pinnedType === 'p' && p.pinned[0] === p.by[0]);
}

/** Tactical motif carried by the first move of `line` (played from `fen`), for the side that plays it. */
function motifOf(fen: string, line: readonly string[]): Omit<Concept, 'side' | 'verified' | 'category'> | null {
  const first = line[0];
  if (!first) return null;
  const after = applyUci(fen, first);
  if (!after) return null;
  const { to } = parseUci(first);
  const mover = fen.split(' ')[1] as Color;
  const enemy: Color = mover === 'w' ? 'b' : 'w';
  const san = uciLineToSan(fen, line.slice(0, 6));

  const disc = discoveredAttacks(fen, first);
  if (disc.length > 0) return { theme: 'discovered_attack', evidence: { bestSan: san, by: disc[0]?.by as Square, targets: disc.map((d) => ({ square: d.target, type: d.type })) } };

  const targets = attackedTargets(after, to).filter((t) => isValuable(t.type));
  if (targets.length >= 2) return { theme: 'fork', evidence: { bestSan: san, square: to, targets } };

  const defl = deflectionIn(fen, line);
  if (defl) return { theme: 'deflection', evidence: { bestSan: san, defender: defl.defender, square: defl.target } };

  const overloaded = overloadedDefenders(fen, enemy).find((o) => line.slice(0, 3).some((u) => o.targets.includes(parseUci(u).to)));
  if (overloaded) return { theme: 'overloaded', evidence: { bestSan: san, defender: overloaded.defender, pieceType: overloaded.defenderType, targets: overloaded.targets.map((s) => ({ square: s, type: new Chess(fen).get(s)?.type ?? '' })) } };

  const before = new Set(pinsAgainst(fen, enemy).map((p) => `${p.pinned}${p.to}`));
  // A pin explains the gain only if the line goes on to capture the pinned piece.
  const capturedLater = new Set(line.slice(1, 6).filter((_, i) => i % 2 === 1).map((u) => parseUci(u).to));
  const newPin = pinsAgainst(after, enemy).find((p) => p.by === to && !before.has(`${p.pinned}${p.to}`) && capturedLater.has(p.pinned) && isMeaningfulPin(p));
  if (newPin) return { theme: 'pin', evidence: { bestSan: san, square: newPin.pinned, pieceType: newPin.pinnedType, by: newPin.by, pinKind: newPin.kind } };

  const victim = new Chess(fen).get(to);
  if (victim && victim.color === enemy) {
    const see = seeCapture(fen, first) ?? 0;
    if (see >= MATERIAL_THRESHOLD) return { theme: 'missed_capture', evidence: { bestSan: san, square: to, pieceType: victim.type, see } };
  }
  if (new Chess(after).inCheck()) return { theme: 'missed_check', evidence: { bestSan: san } };
  return { theme: 'combination', evidence: { bestSan: san } };
}

/**
 * Material of the best line vs the played line (played move + engine reply),
 * both measured at a settled point. Only kept when it actually separates them.
 */
function materialCompare(review: MoveReview, replyLine: readonly string[], best: SettledSwing): Pick<ConceptEvidence, 'materialCompare'> {
  if (!review.bestLine[0] || review.bestMoveUci === review.uci) return {};
  const played = settledSwing(review.fenBefore, [review.uci, ...replyLine], review.color);
  if (!best.settled || !played.settled || best.delta - played.delta < CITED_LOSS_THRESHOLD) return {};
  return { materialCompare: { best: best.delta, played: played.delta } };
}

/**
 * Detects concepts behind a move using only verifiable facts: legal-move
 * analysis from chess.js and the engine's own lines (material is measured at
 * a settled point of the line). Ordered most specific first. Phase-based
 * fallbacks are marked unverified so the UI can present them as limited.
 */
export function detectConcepts(review: MoveReview, replyLine: readonly string[]): Concept[] {
  const out: Concept[] = [];
  const mover = review.color;
  const opponent: Color = mover === 'w' ? 'b' : 'w';
  const replySan = uciLineToSan(review.fenAfter, replyLine.slice(0, 6));
  const bestSan = uciLineToSan(review.fenBefore, review.bestLine.slice(0, 6));

  // 1. Mates (engine flags + exact mate-in-one facts).
  if (review.flags.includes('allowed_mate')) {
    const m1 = mateInOne(review.fenAfter)[0];
    const n = mateDistance(review.evalAfter);
    out.push({
      theme: 'allowed_mate',
      category: 'mate',
      side: 'opponent',
      verified: true,
      evidence: { replySan, ...(n ? { mateIn: n } : {}), ...(m1 ? { mateMoveSan: uciToSan(review.fenAfter, m1) ?? m1 } : {}), mateThreatBefore: mateThreats(review.fenBefore).length > 0 },
    });
  }
  if (review.flags.includes('mate_missed')) {
    const m1 = mateInOne(review.fenBefore)[0];
    const n = mateDistance(review.evalBefore);
    out.push({ theme: 'missed_mate', category: 'mate', side: 'own', verified: true, evidence: { bestSan, ...(n ? { mateIn: n } : {}), ...(m1 ? { mateMoveSan: uciToSan(review.fenBefore, m1) ?? m1 } : {}) } });
  }

  const reply = settledSwing(review.fenAfter, replyLine, mover);
  const best = settledSwing(review.fenBefore, review.bestLine, mover);

  // 2. The played move was itself a capture that loses material (SEE + engine line agree).
  const see = seeCapture(review.fenBefore, review.uci);
  const isCapture = !!new Chess(review.fenBefore).get(parseUci(review.uci).to);
  if (isCapture && see !== null && see < 0 && reply.settled && reply.delta <= -MATERIAL_THRESHOLD) {
    out.push({ theme: 'losing_capture', category: 'tactical', side: 'opponent', verified: true, evidence: { see, replySan, materialDelta: reply.delta, square: parseUci(review.uci).to } });
  }

  // 3. Material lost to the opponent's best reply: which motif made it possible?
  const replyFirst = replyLine[0];
  if (replyFirst && reply.delta <= -CITED_LOSS_THRESHOLD && !out.some((c) => c.theme === 'losing_capture')) {
    const target = parseUci(replyFirst).to;
    const base: ConceptEvidence = { replySan, capturingMoveSan: replySan[0] ?? replyFirst, materialDelta: reply.delta };
    const theirMotif = motifOf(review.fenAfter, replyLine);
    const ep = enPrise(review.fenAfter, mover).find((e) => e.square === target);
    const pinnedTarget = pinsAgainst(review.fenAfter, mover).find((p) => p.pinned === target && isMeaningfulPin(p));
    if (theirMotif && ['fork', 'discovered_attack', 'deflection', 'overloaded'].includes(theirMotif.theme)) {
      out.push({ ...theirMotif, evidence: { ...theirMotif.evidence, ...base }, category: 'tactical', side: 'opponent', verified: reply.settled });
    } else if (pinnedTarget && ep) {
      out.push({ theme: 'pin', category: 'tactical', side: 'opponent', verified: reply.settled, evidence: { ...base, square: target, pieceType: pinnedTarget.pinnedType, by: pinnedTarget.by, pinKind: pinnedTarget.kind } });
    } else if (ep) {
      const { from, to } = parseUci(review.uci);
      const evidence: ConceptEvidence = { ...base, square: target, pieceType: ep.type };
      const wasEnPrise = enPrise(review.fenBefore, mover).some((e) => e.square === target);
      if (target === to) out.push({ theme: 'hanging_piece', category: 'tactical', side: 'opponent', verified: reply.settled, evidence: { ...evidence, movedPiece: ep.type } });
      else if (wasEnPrise) out.push({ theme: 'ignored_threat', category: 'tactical', side: 'opponent', verified: reply.settled, evidence });
      else if (legalRecapturers(review.fenBefore, target, mover).includes(from)) out.push({ theme: 'removed_defender', category: 'tactical', side: 'opponent', verified: reply.settled, evidence: { ...evidence, defender: from } });
      else out.push({ theme: 'hanging_piece', category: 'tactical', side: 'opponent', verified: reply.settled, evidence });
    } else if (theirMotif && OWN_ONLY_THEMES.includes(theirMotif.theme)) {
      out.push({ theme: 'combination', category: 'tactical', side: 'opponent', verified: false, evidence: { ...base, lineSettled: reply.settled } });
    } else if (theirMotif) {
      const created = theirMotif.theme === 'pin' ? { pinCreated: true } : {};
      out.push({ ...theirMotif, evidence: { ...theirMotif.evidence, ...base, ...created }, category: 'tactical', side: 'opponent', verified: reply.settled });
    }
  }

  // 4. Opportunity the best line offered that the played move did not take.
  if (review.bestLine[0] && review.bestMoveUci !== review.uci && best.delta >= MATERIAL_THRESHOLD && !out.some((c) => c.category === 'mate')) {
    const playedGain = settledSwing(review.fenBefore, [review.uci, ...replyLine], mover).delta;
    if (best.delta > playedGain) {
      const m = motifOf(review.fenBefore, review.bestLine);
      if (m) out.push({ ...m, evidence: { ...m.evidence, materialDelta: best.delta }, category: 'tactical', side: 'own', verified: best.settled && m.theme !== 'combination' });
    }
  }

  // 5. Defensive situations.
  const compare = materialCompare(review, replyLine, best);
  if (out.length === 0 && hasMateFor(review.evalBefore, opponent)) {
    const mateBest = mateDistance(review.evalBefore);
    const matePlayed = hasMateFor(review.evalAfter, opponent) ? mateDistance(review.evalAfter) : undefined;
    const mateCompare = mateBest !== undefined && matePlayed !== undefined && matePlayed < mateBest ? { mateCompare: { best: mateBest, played: matePlayed } } : {};
    out.push({ theme: 'mate_threat', category: 'mate', side: 'opponent', verified: true, evidence: { bestSan, mateThreatBefore: mateThreats(review.fenBefore).length > 0, ...mateCompare } });
  }
  if (out.length === 0 && review.flags.includes('defense_needed')) out.push({ theme: 'defense', category: 'positional', verified: false, evidence: { bestSan, ...compare } });

  // 6. No tactical evidence: positional/phase explanation, always limited.
  if (out.length === 0) {
    const phase = gamePhase(review.fenBefore, review.ply);
    const theme: Theme = review.winBefore >= 80 ? 'conversion' : phase === 'opening' ? 'opening' : phase === 'endgame' ? 'endgame' : 'positional';
    out.push({ theme, category: 'positional', verified: false, evidence: { bestSan, lineSettled: reply.settled, linePlies: reply.plies, ...compare } });
  }
  // Facts first: a verified concept always outranks an unverified one (stable otherwise).
  return [...out.filter((c) => c.verified), ...out.filter((c) => !c.verified)];
}

/** True when a concept is backed by concrete, settled evidence (not phase heuristics). */
export function isVerifiedConcept(c: Concept): boolean {
  return c.verified;
}
