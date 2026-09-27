import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fromPcs, toPcs, type PC } from '../../src/core/pcset';
import { triadPcs } from '../../src/core/ops';
import {
  convexHull,
  latticeDistance,
  pcAt,
  placeCompact,
  shapeOf,
  spread,
  toXY,
  triangleName,
  trianglePcs,
  type Coord,
} from '../../src/core/tonnetz';

const smallSet = fc
  .uniqueArray(fc.integer({ min: 0, max: 11 }), { minLength: 1, maxLength: 5 })
  .map((xs) => fromPcs(xs));
const near = fc.record({ a: fc.integer({ min: -20, max: 20 }), b: fc.integer({ min: -20, max: 20 }) });

/** Exhaustive minimum spread over every copy within 4 steps of the first pc's copy at the origin region. */
function bruteForceSpread(set: number): number {
  const pcs = toPcs(set);
  const pool = (pc: number) => {
    const out: Coord[] = [];
    for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) if (pcAt(a, b) === pc) out.push({ a, b });
    return out;
  };
  const first = pool(pcs[0] as number).filter((n) => latticeDistance(n, { a: 0, b: 0 }) <= 2);
  let best = Infinity;
  const rec = (i: number, chosen: Coord[]) => {
    if (spread(chosen) >= best) return;
    if (i === pcs.length) {
      best = spread(chosen);
      return;
    }
    for (const c of pool(pcs[i] as number)) rec(i + 1, [...chosen, c]);
  };
  for (const f of first) rec(1, [f]);
  return best;
}

describe('compact placement', () => {
  it('places each pitch class exactly once', () => {
    fc.assert(
      fc.property(smallSet, near, (set, n) => {
        const placed = placeCompact(set, n);
        expect(placed.map((p) => p.pc)).toEqual(toPcs(set));
        for (const p of placed) expect(pcAt(p.a, p.b)).toBe(p.pc);
      }),
    );
  });

  it('matches brute force on small sets', () => {
    fc.assert(
      fc.property(smallSet, (set) => {
        expect(spread(placeCompact(set))).toBe(bruteForceSpread(set));
      }),
      { numRuns: 60 },
    );
  });

  it('lands near the anchor', () => {
    fc.assert(
      fc.property(smallSet, near, (set, n) => {
        const placed = placeCompact(set, n);
        const c = placed.reduce((acc, p) => ({ a: acc.a + p.a / placed.length, b: acc.b + p.b / placed.length }), { a: 0, b: 0 });
        const p = toXY(c.a, c.b, 1);
        const q = toXY(n.a, n.b, 1);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThanOrEqual(3);
      }),
    );
  });

  it('places every major and minor triad as a triangle', () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of ['maj', 'min'] as const) {
        const set = triadPcs({ root: root as PC, quality });
        const shape = shapeOf(placeCompact(set, { a: 3, b: -1 }));
        expect(shape.kind).toBe('triad');
        if (shape.kind === 'triad') expect(trianglePcs(shape.triangle)).toBe(set);
      }
    }
  });

  it('handles large sets (greedy path) without losing notes', () => {
    const all = placeCompact(0xfff);
    expect(all).toHaveLength(12);
    expect(new Set(all.map((p) => p.pc)).size).toBe(12);
  });
});

describe('shapes', () => {
  const shapeFor = (pcs: number[]) => shapeOf(placeCompact(fromPcs(pcs)));

  it('empty, single note', () => {
    expect(shapeOf([]).kind).toBe('empty');
    expect(shapeFor([2])).toEqual({ kind: 'note', node: expect.any(Object) });
  });

  it.each([
    ['sus4 C F G', [0, 5, 7], 'fifths'],
    ['sus2 C D G', [0, 2, 7], 'fifths'],
    ['quartal C F Bb', [0, 5, 10], 'fifths'],
    ['stacked fifths C G D A', [0, 7, 2, 9], 'fifths'],
    ['augmented C E G#', [0, 4, 8], 'majorThirds'],
    ['diminished C Eb F#', [0, 3, 6], 'minorThirds'],
    ['dim7', [0, 3, 6, 9], 'minorThirds'],
    ['fifth C G', [0, 7], 'fifths'],
  ])('%s is a capsule along the %s axis', (_, pcs, axis) => {
    const s = shapeFor(pcs as number[]);
    expect(s.kind).toBe('capsule');
    if (s.kind === 'capsule') expect(s.axis).toBe(axis);
  });

  it('off-axis pairs are capsules with no axis', () => {
    const s = shapeOf([{ a: 0, b: 0 }, { a: 1, b: 1 }]); // C–B
    expect(s).toMatchObject({ kind: 'capsule', axis: null });
  });

  it.each([
    ['Cmaj7', [0, 4, 7, 11]],
    ['Cm7', [0, 3, 7, 10]],
  ])('%s is a rhombus: 4-point hull with 5 lattice edges', (_, pcs) => {
    const s = shapeFor(pcs);
    expect(s.kind).toBe('hull');
    if (s.kind === 'hull') {
      expect(s.hull).toHaveLength(4);
      expect(s.edges).toHaveLength(5);
    }
  });

  it('C7 is a triangle with a tail, not a rhombus', () => {
    const s = shapeFor([0, 4, 7, 10]);
    expect(s.kind).toBe('hull');
    if (s.kind === 'hull') expect(s.edges.length).toBeLessThan(5);
  });

  it('ignores duplicate nodes', () => {
    expect(shapeOf([{ a: 0, b: 0 }, { a: 0, b: 0 }]).kind).toBe('note');
  });

  it('convex hull encloses every node', () => {
    const coord = fc.record({ a: fc.integer({ min: -6, max: 6 }), b: fc.integer({ min: -6, max: 6 }) });
    fc.assert(
      fc.property(fc.array(coord, { minLength: 3, maxLength: 12 }), (nodes) => {
        const hull = convexHull(nodes).map((n) => toXY(n.a, n.b, 1));
        if (hull.length < 3) return;
        for (const n of nodes) {
          const p = toXY(n.a, n.b, 1);
          for (let i = 0; i < hull.length; i++) {
            const o = hull[i] as { x: number; y: number };
            const q = hull[(i + 1) % hull.length] as { x: number; y: number };
            // Consistent side (monotone chain winds one way): cross ≥ 0.
            expect((q.x - o.x) * (p.y - o.y) - (q.y - o.y) * (p.x - o.x)).toBeGreaterThanOrEqual(-1e-9);
          }
        }
      }),
    );
  });

  it('names triads from position, including drift', () => {
    expect(triangleName({ a: 0, b: 0, orient: 'up' })).toBe('C');
    expect(triangleName({ a: 0, b: -1, orient: 'down' })).toBe('A♭m');
    expect(triangleName({ a: 0, b: -3, orient: 'up' })).toBe('D♭♭');
  });
});
