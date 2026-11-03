import { describe, expect, it } from 'vitest';
import {
  attackedTargets,
  deflectionIn,
  discoveredAttacks,
  enPrise,
  legalCapturesOn,
  legalRecapturers,
  mateInOne,
  mateThreats,
  nullMoveFen,
  overloadedDefenders,
  pinsAgainst,
  seeCapture,
} from '../src/services/chess/tactics';
import { settledSwing } from '../src/services/chess/material';
import { vulnerablePieces } from '../src/services/chess/attacks';
import { applyUci } from '../src/services/chess/position';

// Black knight e5 is absolutely pinned by Re1 against Ke8; it "attacks" Bd3 geometrically.
const PINNED_ATTACKER = '4k3/8/8/4n3/8/3B4/8/4R1K1 b - - 0 1';
// White Nd4 is "defended" by Pc3, but c3 is pinned by Ba5 against Ke1; Rd8 attacks d4.
const PINNED_DEFENDER = '3rk3/8/8/b7/3N4/2P5/8/4K3 b - - 0 1';
// Pawn d5 defended by pawn c6: Qxd5 looks like a free pawn but loses the queen.
const POISONED_PAWN = '4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1';
// Black Qd6 is the only defender of Nb6 and Be5, both attacked by white rooks.
const OVERLOADED = '6k1/8/1n1q4/4b3/8/8/8/1R2R1K1 w - - 0 1';

describe('legal captures vs geometric attacks', () => {
  it('a pinned piece attacks a square but cannot legally capture there', () => {
    expect(vulnerablePieces(PINNED_ATTACKER, 'w').map((v) => v.square)).toContain('d3'); // old geometric view
    expect(legalCapturesOn(PINNED_ATTACKER, 'd3', 'b')).toHaveLength(0);
    expect(enPrise(PINNED_ATTACKER, 'w')).toHaveLength(0);
  });

  it('a pinned defender does not defend', () => {
    expect(vulnerablePieces(PINNED_DEFENDER, 'w').map((v) => v.square)).not.toContain('d4'); // geometric view misses it
    expect(legalRecapturers(PINNED_DEFENDER, 'd4', 'w')).toEqual([]);
    // Rxd4 wins the knight; Bxc3+ also wins the (undefended) pawn.
    expect(enPrise(PINNED_DEFENDER, 'w')).toEqual([
      { square: 'd4', type: 'n', capture: 'd8d4', gain: 3 },
      { square: 'c3', type: 'p', capture: 'a5c3', gain: 1 },
    ]);
  });

  it('detects absolute and relative pins', () => {
    expect(pinsAgainst(PINNED_ATTACKER, 'b')).toEqual([{ pinned: 'e5', pinnedType: 'n', by: 'e1', to: 'e8', kind: 'absolute' }]);
    // Bishop b5 pins knight c6 against the queen on e8 (relative pin).
    const rel = pinsAgainst('4q1k1/8/2n5/1B6/8/8/8/6K1 b - - 0 1', 'b');
    expect(rel).toEqual([{ pinned: 'c6', pinnedType: 'n', by: 'b5', to: 'e8', kind: 'relative' }]);
  });

  it('null move is refused when the side to move is in check', () => {
    expect(nullMoveFen('4k3/8/8/8/8/8/8/4RK2 b - - 0 1')).toBeNull();
    expect(nullMoveFen(PINNED_ATTACKER)?.split(' ')[1]).toBe('w');
  });
});

describe('static exchange evaluation (legal moves only)', () => {
  it('a capture that looks winning loses material', () => {
    expect(seeCapture(POISONED_PAWN, 'd1d5')).toBe(-8);
    expect(seeCapture('4k3/8/2p5/3n4/8/8/8/3RK3 w - - 0 1', 'd1d5')).toBe(-2);
  });
  it('an undefended piece is a clean gain', () => {
    expect(seeCapture('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'd1d5')).toBe(3);
  });
  it('non-captures and illegal moves', () => {
    expect(seeCapture(POISONED_PAWN, 'd1d4')).toBe(0);
    expect(seeCapture(POISONED_PAWN, 'd1d8')).toBeNull(); // blocked by d5: illegal
  });
});

describe('mate detection (exact)', () => {
  it('finds mate in one and null-move mate threats', () => {
    expect(mateInOne('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1')).toEqual(['a1a8']);
    expect(mateThreats('6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1')).toEqual(['a1a8']);
    expect(mateThreats('6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1'.replace('R5K1', '6K1'))).toEqual([]);
  });
});

describe('motifs', () => {
  it('a knight check forking king and queen', () => {
    const after = applyUci('2q3k1/8/8/3N4/8/8/8/6K1 w - - 0 1', 'd5e7') as string;
    expect(attackedTargets(after, 'e7').map((t) => t.type).sort()).toEqual(['k', 'q']);
  });

  it('a discovered attack on the queen behind a checking knight', () => {
    expect(discoveredAttacks('4k3/4q3/8/8/4N3/8/8/4RK2 w - - 0 1', 'e4f6')).toEqual([{ by: 'e1', target: 'e7', type: 'q' }]);
    expect(discoveredAttacks('4k3/4q3/8/8/4N3/8/8/4RK2 w - - 0 1', 'f1g1')).toEqual([]);
  });

  it('an overloaded defender and the deflection that exploits it', () => {
    expect(overloadedDefenders(OVERLOADED, 'b')).toEqual([{ defender: 'd6', defenderType: 'q', targets: ['b6', 'e5'] }]);
    expect(deflectionIn(OVERLOADED, ['b1b6', 'd6b6', 'e1e5'])).toEqual({ defender: 'd6', target: 'e5' });
    expect(deflectionIn(OVERLOADED, ['b1b6', 'g8f8', 'e1e5'])).toBeNull();
  });
});

describe('settled material swing', () => {
  it('does not stop in the middle of an exchange', () => {
    // Line ends right after QxP: the swing is not settled (cxd5 is pending).
    const cut = settledSwing(POISONED_PAWN, ['d1d5'], 'w');
    expect(cut).toMatchObject({ delta: 1, settled: false });
    const full = settledSwing(POISONED_PAWN, ['d1d5', 'c6d5', 'e1e2', 'e8e7'], 'w');
    expect(full).toMatchObject({ delta: -8, settled: true });
  });
});
