import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fromPcs, type PC } from '../../src/core/pcset';
import { noteName } from '../../src/core/spell';
import { triadOf, triadPcs, type Triad } from '../../src/core/ops';
import {
  PERIODS,
  fromXY,
  latticeDistance,
  nearestNode,
  pcAt,
  qAt,
  toXY,
  torusWrap,
  triangleAt,
  triangleNodes,
  triangleOf,
  trianglePcs,
  triangleTriad,
  type Coord,
  type Triangle,
} from '../../src/core/tonnetz';

const int = fc.integer({ min: -50, max: 50 });
const triangle = fc.record({ a: int, b: int, orient: fc.constantFrom('up' as const, 'down' as const) });
const allTriads: Triad[] = Array.from({ length: 12 }, (_, r) => r as PC).flatMap((root) => [
  { root, quality: 'maj' as const },
  { root, quality: 'min' as const },
]);

describe('tonnetz', () => {
  it('pc(a, b) = 7a + 4b mod 12, with the minor third on (a+1, b−1)', () => {
    expect(pcAt(0, 0)).toBe(0);
    expect(pcAt(1, 0)).toBe(7);
    expect(pcAt(0, 1)).toBe(4);
    expect(pcAt(1, -1)).toBe(3);
    fc.assert(fc.property(int, int, (a, b) => pcAt(a + 1, b - 1) === (pcAt(a, b) + 3) % 12));
  });

  it('fixture: period vectors map a node to the same pitch class', () => {
    fc.assert(
      fc.property(int, int, (a, b) =>
        PERIODS.every((v) => pcAt(a + v.a, b + v.b) === pcAt(a, b)),
      ),
    );
    const [u, v] = PERIODS;
    expect(u.a * v.b - u.b * v.a).toBe(12);
  });

  it('spelling: (4, −1) keeps the name, (0, 3) adds 12 fifths (C → B♯)', () => {
    fc.assert(fc.property(int, int, (a, b) => qAt(a + 4, b - 1) === qAt(a, b) && qAt(a, b + 3) === qAt(a, b) + 12));
    expect(noteName(qAt(0, 3))).toBe('B♯');
    expect(noteName(qAt(0, -3))).toBe('D♭♭');
  });

  it('fixture: triangles contain exactly their triad', () => {
    fc.assert(
      fc.property(triangle, (t) => {
        const pcs = trianglePcs(t);
        expect(triadOf(pcs)).toEqual(triangleTriad(t));
        expect(pcs).toBe(triadPcs(triangleTriad(t)));
      }),
    );
    for (const triad of allTriads) {
      const t = triangleOf(triad, { a: 5, b: -2 });
      expect(trianglePcs(t)).toBe(triadPcs(triad));
    }
    expect(trianglePcs({ a: 0, b: 0, orient: 'up' })).toBe(fromPcs([0, 4, 7]));
    expect(trianglePcs({ a: 0, b: 0, orient: 'down' })).toBe(fromPcs([0, 3, 7]));
  });

  it('major triangles point up on screen, minor down', () => {
    const apexBelowBase = (t: Triangle) => {
      const [r, f, third] = triangleNodes(t);
      const y = (n: Coord) => toXY(n.a, n.b, 1).y;
      return y(third) > y(r) && y(r) === y(f);
    };
    expect(apexBelowBase({ a: 0, b: 0, orient: 'up' })).toBe(false);
    expect(apexBelowBase({ a: 0, b: 0, orient: 'down' })).toBe(true);
  });

  it('lattice distance counts edge steps', () => {
    const o = { a: 0, b: 0 };
    for (const n of [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: -1 }, { a: -1, b: 1 }]) {
      expect(latticeDistance(o, n)).toBe(1);
    }
    expect(latticeDistance(o, { a: 1, b: 1 })).toBe(2);
  });

  it('finds the nearest copy of a pitch class', () => {
    fc.assert(
      fc.property(int, int, fc.integer({ min: 0, max: 11 }), (a, b, pc) => {
        const n = nearestNode(pc, { a, b });
        expect(pcAt(n.a, n.b)).toBe(pc);
        expect(latticeDistance({ a, b }, n)).toBeLessThanOrEqual(2);
      }),
    );
  });

  it('torus wrap keeps the pitch class, and the 4×3 domain holds each pc once', () => {
    fc.assert(
      fc.property(int, int, (a, b) => {
        const w = torusWrap(a, b);
        expect(pcAt(w.a, w.b)).toBe(pcAt(a, b));
        expect(w.a >= 0 && w.a < 4 && w.b >= 0 && w.b < 3).toBe(true);
      }),
    );
    const domain = new Set<number>();
    for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) domain.add(pcAt(a, b));
    expect(domain.size).toBe(12);
  });

  it('screen coordinates round-trip, and every point lands in one triangle containing it', () => {
    const frac = fc.double({ min: -20, max: 20, noNaN: true });
    fc.assert(
      fc.property(frac, frac, (a, b) => {
        const { x, y } = toXY(a, b, 40);
        const back = fromXY(x, y, 40);
        expect(back.a).toBeCloseTo(a, 9);
        expect(back.b).toBeCloseTo(b, 9);

        // Barycentric check: (a, b) lies inside the triangle triangleAt returns.
        const [p0, p1, p2] = triangleNodes(triangleAt(a, b));
        const cross = (o: Coord, u: Coord, px: number, py: number) =>
          (u.a - o.a) * (py - o.b) - (u.b - o.b) * (px - o.a);
        const s = [cross(p0, p1, a, b), cross(p1, p2, a, b), cross(p2, p0, a, b)];
        const eps = 1e-9;
        expect(s.every((v) => v >= -eps) || s.every((v) => v <= eps)).toBe(true);
      }),
    );
  });
});
