import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { classifyMove, embedChord, embedPath, shortestOps } from '../../src/core/embed';
import { applyOps, triadPcs, type Triad } from '../../src/core/ops';
import { fromPcs, type PC } from '../../src/core/pcset';
import { PERIODS, pcAt, toXY, type Coord } from '../../src/core/tonnetz';
import { must } from '../must';

const maj = (r: number): Triad => ({ root: r as PC, quality: 'maj' });
const min = (r: number): Triad => ({ root: r as PC, quality: 'min' });
const screenDist = (p: Coord, q: Coord) => {
  const a = toXY(p.a, p.b, 1);
  const b = toXY(q.a, q.b, 1);
  return Math.hypot(a.x - b.x, a.y - b.y);
};
const setArb = fc.integer({ min: 1, max: 0xfff });
const anchorArb = fc.record({ a: fc.integer({ min: -6, max: 6 }), b: fc.integer({ min: -6, max: 6 }) });

describe('embedPath', () => {
  it('places each chord on nodes carrying exactly its pitch classes', () => {
    fc.assert(
      fc.property(fc.array(setArb, { minLength: 1, maxLength: 8 }), anchorArb, (sets, anchor) => {
        embedPath(sets.map((pcs) => ({ pcs })), anchor).forEach((e, i) => {
          expect(fromPcs(must(e).nodes.map((n) => pcAt(n.a, n.b)))).toBe(sets[i]);
        });
      }),
    );
  });

  it('puts each chord at the period translate nearest the previous one', () => {
    fc.assert(
      fc.property(fc.array(setArb, { minLength: 2, maxLength: 6 }), anchorArb, (sets, anchor) => {
        const path = embedPath(sets.map((pcs) => ({ pcs })), anchor).map((e) => must(e));
        for (let i = 1; i < path.length; i++) {
          const prev = must(path[i - 1]).centroid;
          const c = must(path[i]).centroid;
          const d = screenDist(c, prev);
          for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
            const t = { a: c.a + u * PERIODS[0].a + v * PERIODS[1].a, b: c.b + u * PERIODS[0].b + v * PERIODS[1].b };
            expect(screenDist(t, prev)).toBeGreaterThanOrEqual(d - 1e-9);
          }
        }
      }),
    );
  });

  it('starts nearest the anchor, independent of the camera', () => {
    const [first] = embedPath([{ pcs: triadPcs(maj(0)) }], { a: 8, b: 0 });
    expect(screenDist(must(first).centroid, { a: 8, b: 0 })).toBeLessThan(2);
  });

  it('P/L/R neighbors embed as edge-adjacent triangles', () => {
    for (const [from, op] of [[maj(0), 'P'], [maj(0), 'L'], [maj(0), 'R'], [min(9), 'L']] as const) {
      const to = applyOps(from, op);
      const [a, b] = embedPath([{ pcs: triadPcs(from) }, { pcs: triadPcs(to) }], { a: 0, b: 0 }).map((e) => must(e));
      const shared = must(a).nodes.filter((n) => must(b).nodes.some((m) => m.a === n.a && m.b === n.b));
      expect(shared).toHaveLength(2);
    }
  });

  it('drifts on a PL cycle instead of returning home', () => {
    // C Cm Ab Abm E Em C: back to C, but one period flatward along the
    // major-thirds strip (C → A♭ → F♭ → D♭♭ by position, as in the explorer).
    const cycle = [maj(0), min(0), maj(8), min(8), maj(4), min(4), maj(0)];
    const path = embedPath(cycle.map((t) => ({ pcs: triadPcs(t) })), { a: 0, b: 0 }).map((e) => must(e));
    const first = must(path[0]).centroid;
    const last = must(path[6]).centroid;
    expect(last.a - first.a).toBeCloseTo(-PERIODS[1].a);
    expect(last.b - first.b).toBeCloseTo(-PERIODS[1].b);
    // Every step is an edge flip, so all six triads stay in one strip.
    for (const e of path) expect(must(e).shape.kind).toBe('triad');
  });

  it('skips empty sets without moving the path', () => {
    const path = embedPath([{ pcs: triadPcs(maj(0)) }, { pcs: 0 }, { pcs: triadPcs(min(0)) }], { a: 0, b: 0 });
    expect(path[1]).toBeNull();
    expect(must(path[2]).shape.kind).toBe('triad');
  });

  it('rings the bass on a chord node, or the nearest copy', () => {
    const c = embedChord(triadPcs(maj(0)), 4, { a: 0, b: 0 });
    expect(pcAt(must(c.bassNode).a, must(c.bassNode).b)).toBe(4);
    expect(c.nodes.some((n) => n.a === must(c.bassNode).a && n.b === must(c.bassNode).b)).toBe(true);
    const slash = embedChord(fromPcs([2, 5, 9, 0]), 7, { a: 0, b: 0 }); // Dm7/G
    const bn = must(slash.bassNode);
    expect(pcAt(bn.a, bn.b)).toBe(7);
    expect(screenDist(bn, slash.centroid)).toBeLessThan(2.5);
  });
});

describe('classifyMove', () => {
  it('names single flips and the spec compounds', () => {
    expect(classifyMove(triadPcs(maj(0)), triadPcs(min(0)))).toEqual({ kind: 'flip', ops: 'P' });
    expect(classifyMove(triadPcs(maj(0)), triadPcs(min(9))).kind).toBe('flip');
    // The slide (C → C♯m) has no shortcut: three ops.
    expect(classifyMove(triadPcs(maj(0)), triadPcs(min(1)))).toEqual({ kind: 'compound', ops: shortestOps(maj(0), min(1)) });
    expect(shortestOps(maj(0), min(1))).toHaveLength(3);
    expect(classifyMove(triadPcs(maj(0)), triadPcs(maj(0)))).toEqual({ kind: 'same', ops: '' });
  });

  it('calls a tritone-away triad a jump, and any non-triad move a jump', () => {
    expect(classifyMove(triadPcs(maj(0)), triadPcs(maj(6))).kind).toBe('jump');
    expect(classifyMove(fromPcs([2, 5, 9, 0]), fromPcs([7, 11, 2, 5])).kind).toBe('jump');
  });

  it('finds a shortest string that actually arrives', () => {
    const triad = fc.record({ root: fc.integer({ min: 0, max: 11 }).map((r) => r as PC), quality: fc.constantFrom('maj' as const, 'min' as const) });
    fc.assert(
      fc.property(triad, triad, (a, b) => {
        const ops = shortestOps(a, b);
        expect(applyOps(a, ops)).toEqual(b);
        expect(ops.length).toBeLessThanOrEqual(5);
      }),
    );
  });
});
