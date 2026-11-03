import { describe, expect, it } from 'vitest';
import { applyUci, moveNumberLabel, positionsOf, replayGame, sanToUci, sideToMove, START_FEN, terminalState, uciLineToSan, uciToSan, isValidFen, legalMoveCount } from '../src/services/chess/position';
import { materialBalance, gamePhase, materialSwingAlongLine } from '../src/services/chess/material';
import { vulnerablePieces, defendedBy, attackedTargets } from '../src/services/chess/attacks';

describe('position reconstruction', () => {
  it('replays SAN moves and reports per-ply FENs', () => {
    const plies = replayGame(['e4', 'e5', 'Nf3']);
    expect(plies).toHaveLength(3);
    expect(plies[0]?.uci).toBe('e2e4');
    expect(plies[1]?.color).toBe('b');
    expect(plies[2]?.fenBefore).toBe(plies[1]?.fenAfter);
    expect(positionsOf(['e4'])[0]).toBe(START_FEN);
  });

  it('throws a readable error on an illegal move', () => {
    expect(() => replayGame(['e4', 'e4'])).toThrow(/meia-jogada 2/);
  });

  it('identifies side to move', () => {
    expect(sideToMove(START_FEN)).toBe('w');
    expect(sideToMove(positionsOf(['e4'])[1] as string)).toBe('b');
  });

  it('handles castling on both sides', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(uciToSan(fen, 'e1g1')).toBe('O-O');
    expect(uciToSan(fen, 'e1c1')).toBe('O-O-O');
    expect(sanToUci(fen, 'O-O')).toBe('e1g1');
  });

  it('handles en passant', () => {
    const plies = replayGame(['e4', 'a6', 'e5', 'd5', 'exd6']);
    expect(plies[4]?.uci).toBe('e5d6');
    expect(plies[4]?.captured).toBe('p');
  });

  it('handles promotion with UCI suffix', () => {
    const fen = '8/P7/8/8/8/8/8/k6K w - - 0 1';
    expect(uciToSan(fen, 'a7a8q')).toBe('a8=Q+');
    expect(uciToSan(fen, 'a7a8n')).toBe('a8=N');
    expect(applyUci(fen, 'a7a8q')?.startsWith('Q7')).toBe(true);
  });

  it('detects check, mate and stalemate', () => {
    const mated = positionsOf(['f3', 'e5', 'g4', 'Qh4#'])[4] as string;
    expect(terminalState(mated)).toBe('checkmate');
    expect(terminalState('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBe('stalemate');
    expect(terminalState(START_FEN)).toBeNull();
  });

  it('converts UCI lines to SAN and stops at illegal moves', () => {
    expect(uciLineToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(uciLineToSan(START_FEN, ['e2e4', 'e2e4'])).toEqual(['e4']);
    expect(uciToSan(START_FEN, 'e2e5')).toBeNull();
  });

  it('labels move numbers', () => {
    expect(moveNumberLabel(1)).toBe('1.');
    expect(moveNumberLabel(2)).toBe('1...');
    expect(moveNumberLabel(3)).toBe('2.');
  });

  it('validates FEN and counts legal moves', () => {
    expect(isValidFen('garbage')).toBe(false);
    expect(legalMoveCount(START_FEN)).toBe(20);
  });
});

describe('material and attacks', () => {
  it('computes balance from each side', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    expect(materialBalance(fen, 'w')).toBe(5);
    expect(materialBalance(fen, 'b')).toBe(-5);
  });

  it('classifies game phase', () => {
    expect(gamePhase(START_FEN, 1)).toBe('opening');
    expect(gamePhase('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 60)).toBe('endgame');
  });

  it('measures material swing along a line', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/3NP3/8/PPPP1PPP/RNBQKB1R b KQkq - 3 3';
    expect(materialSwingAlongLine(fen, ['e5d4'], 'w').delta).toBe(-3);
  });

  it('finds undefended attacked pieces and ignores defended ones', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/3NP3/8/PPPP1PPP/RNBQKB1R b KQkq - 3 3';
    const v = vulnerablePieces(fen, 'w');
    expect(v.map((x) => x.square)).toContain('d4');
    expect(vulnerablePieces(START_FEN, 'w')).toHaveLength(0);
  });

  it('lists what a piece defends and attacks', () => {
    expect(defendedBy('6k1/8/1b6/8/3N4/8/8/3R2K1 w - - 0 1', 'd1')).toContain('d4');
    const t = attackedTargets('2q3k1/4N3/8/8/8/8/8/6K1 b - - 0 1', 'e7').map((x) => x.type).sort();
    expect(t).toEqual(['k', 'q']);
  });
});
