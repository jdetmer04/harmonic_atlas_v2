import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fromPcs, intersect, popcount, type PC } from '../../src/core/pcset';
import { apply, applyOps, flip, parseOps, triadOf, triadPcs, walk, type Op, type Triad } from '../../src/core/ops';
import { triangleNodes, trianglePcs, triangleTriad, type Triangle } from '../../src/core/tonnetz';

const triad = fc.record({
  root: fc.integer({ min: 0, max: 11 }).map((r) => r as PC),
  quality: fc.constantFrom('maj' as const, 'min' as const),
});
const int = fc.integer({ min: -50, max: 50 });
const triangle = fc.record({ a: int, b: int, orient: fc.constantFrom('up' as const, 'down' as const) });
const op = fc.constantFrom<Op>('P', 'L', 'R');

const C: Triad = { root: 0, quality: 'maj' };
const name = (t: Triad) => `${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][t.root]}${t.quality === 'min' ? 'm' : ''}`;

describe('ops', () => {
  it('fixture: P, L, R from C give Cm, Em, Am', () => {
    expect(name(apply(C, 'P'))).toBe('Cm');
    expect(name(apply(C, 'L'))).toBe('Em');
    expect(name(apply(C, 'R'))).toBe('Am');
  });

  it('fixture: compounds applied left to right from C', () => {
    expect(name(applyOps(C, 'LPR'))).toBe('C#m');
    expect(name(applyOps(C, 'LPL'))).toBe('Abm');
    expect(name(applyOps(C, 'RLP'))).toBe('Fm');
    expect(name(applyOps(C, 'S'))).toBe('C#m');
    expect(name(applyOps(C, 'H'))).toBe('Abm');
    expect(name(applyOps(C, 'N'))).toBe('Fm');
  });

  it('fixture: P, L, R are involutions', () => {
    fc.assert(
      fc.property(triad, op, (t, o) => {
        expect(apply(apply(t, o), o)).toEqual(t);
      }),
    );
  });

  it('each op keeps exactly two common tones', () => {
    fc.assert(
      fc.property(triad, op, (t, o) => popcount(intersect(triadPcs(t), triadPcs(apply(t, o)))) === 2),
    );
  });

  it('parses operator strings', () => {
    expect(parseOps('p l r')).toEqual(['P', 'L', 'R']);
    expect(parseOps('SH')).toEqual(['L', 'P', 'R', 'L', 'P', 'L']);
    expect(() => parseOps('PQ')).toThrow(/Unknown operator "Q"/);
  });

  it('identifies triads from sets', () => {
    expect(triadOf(fromPcs([0, 4, 7]))).toEqual({ root: 0, quality: 'maj' });
    expect(triadOf(fromPcs([9, 0, 4]))).toEqual({ root: 9, quality: 'min' });
    expect(triadOf(fromPcs([0, 4, 8]))).toBeNull();
    expect(triadOf(fromPcs([0, 4, 7, 11]))).toBeNull();
    fc.assert(
      fc.property(triad, (t) => {
        expect(triadOf(triadPcs(t))).toEqual(t);
      }),
    );
  });

  describe('lattice flips', () => {
    it('agree with the pitch-class ops', () => {
      fc.assert(
        fc.property(triangle, op, (t, o) => {
          expect(triangleTriad(flip(t, o))).toEqual(apply(triangleTriad(t), o));
        }),
      );
    });

    it('are involutions that share exactly the kept edge', () => {
      const key = (n: { a: number; b: number }) => `${n.a},${n.b}`;
      fc.assert(
        fc.property(triangle, op, (t, o) => {
          const f = flip(t, o);
          expect(flip(f, o)).toEqual(t);
          const before = new Set(triangleNodes(t).map(key));
          expect(triangleNodes(f).filter((n) => before.has(key(n)))).toHaveLength(2);
        }),
      );
    });

    it('PLR circles one node and returns to the starting triangle', () => {
      const start: Triangle = { a: 0, b: 0, orient: 'up' };
      const path = walk(start, 'PLRPLR');
      expect(path.map((t) => name(triangleTriad(t)))).toEqual(['C', 'Cm', 'Ab', 'Fm', 'F', 'Am', 'C']);
      for (const t of path) expect(triangleNodes(t)).toContainEqual({ a: 0, b: 0 });
      expect(path[6]).toEqual(start);
    });

    it('PL runs the hexatonic strip and drifts by (0, −3) per cycle', () => {
      const start: Triangle = { a: 0, b: 0, orient: 'up' };
      const path = walk(start, 'PLPLPL');
      expect(path.map((t) => name(triangleTriad(t)))).toEqual(['C', 'Cm', 'Ab', 'Abm', 'E', 'Em', 'C']);
      expect(path[6]).toEqual({ a: 0, b: -3, orient: 'up' });
      const hexatonic = path.reduce((acc, t) => acc | trianglePcs(t), 0);
      expect(hexatonic).toBe(fromPcs([0, 3, 4, 7, 8, 11]));
    });
  });
});
