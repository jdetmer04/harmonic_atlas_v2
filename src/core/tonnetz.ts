// The Tonnetz lattice: axis a = fifths (+7), axis b = major thirds (+4), and the
// third direction (a+1, b−1) = minor thirds (+3).

import { fromPcs, mod, type PC, type PcSet } from './pcset';
import type { Triad } from './ops';

export interface Coord {
  a: number;
  b: number;
}

export type Orientation = 'up' | 'down';

/**
 * A triangle, anchored at its triad's root node.
 *   up   (major): root (a,b), fifth (a+1,b), major third (a,b+1)
 *   down (minor): root (a,b), fifth (a+1,b), minor third (a+1,b−1)
 */
export interface Triangle {
  a: number;
  b: number;
  orient: Orientation;
}

/** Translating by either period vector lands on the same pitch class (det = 12). */
export const PERIODS: readonly [Coord, Coord] = [
  { a: 4, b: -1 },
  { a: 0, b: 3 },
];

export function pcAt(a: number, b: number): PC {
  return mod(7 * a + 4 * b, 12) as PC;
}

/** Line-of-fifths index of a node; see spell.ts. */
export function qAt(a: number, b: number): number {
  return a + 4 * b;
}

/** Steps between nodes along lattice edges (hex distance in axial coordinates). */
export function latticeDistance(p: Coord, q: Coord): number {
  const da = q.a - p.a;
  const db = q.b - p.b;
  return (Math.abs(da) + Math.abs(db) + Math.abs(da + db)) / 2;
}

/** Nodes as [root, fifth, third]. */
export function triangleNodes(t: Triangle): [Coord, Coord, Coord] {
  const { a, b } = t;
  return t.orient === 'up'
    ? [{ a, b }, { a: a + 1, b }, { a, b: b + 1 }]
    : [{ a, b }, { a: a + 1, b }, { a: a + 1, b: b - 1 }];
}

export function trianglePcs(t: Triangle): PcSet {
  return fromPcs(triangleNodes(t).map((n) => pcAt(n.a, n.b)));
}

export function triangleTriad(t: Triangle): Triad {
  return { root: pcAt(t.a, t.b), quality: t.orient === 'up' ? 'maj' : 'min' };
}

/** The copy of `triad` whose root node is nearest `near` (ties broken toward smaller a, then b). */
export function triangleOf(triad: Triad, near: Coord = { a: 0, b: 0 }): Triangle {
  const root = nearestNode(triad.root, near);
  return { a: root.a, b: root.b, orient: triad.quality === 'maj' ? 'up' : 'down' };
}

/** The node carrying pitch class `pc` nearest `near`. */
export function nearestNode(pc: number, near: Coord): Coord {
  // Every pitch class appears once in any 4×3 block of the period lattice,
  // so searching a small window around `near` always finds the nearest copy.
  let best: Coord = near;
  let bestDist = Infinity;
  for (let da = -4; da <= 4; da++) {
    for (let db = -3; db <= 3; db++) {
      const a = near.a + da;
      const b = near.b + db;
      if (pcAt(a, b) !== mod(pc, 12)) continue;
      const d = latticeDistance(near, { a, b });
      if (d < bestDist) {
        best = { a, b };
        bestDist = d;
      }
    }
  }
  return best;
}

/** Wrap a node into the torus's fundamental domain a ∈ [0,4), b ∈ [0,3). */
export function torusWrap(a: number, b: number): Coord {
  const k = Math.floor(a / 4); // subtract k·(4, −1)
  return { a: a - 4 * k, b: mod(b + k, 3) };
}

// Screen geometry: a skewed basis with node spacing s, y pointing down.

const SQRT3_2 = Math.sqrt(3) / 2;

export function toXY(a: number, b: number, s: number): { x: number; y: number } {
  return { x: s * (a + b / 2), y: -s * b * SQRT3_2 };
}

/** Inverse of toXY: fractional lattice coordinates. */
export function fromXY(x: number, y: number, s: number): Coord {
  const b = -y / (s * SQRT3_2);
  return { a: x / s - b / 2, b };
}

/** The triangle containing fractional lattice point (a, b). */
export function triangleAt(a: number, b: number): Triangle {
  const a0 = Math.floor(a);
  const b0 = Math.floor(b);
  return a - a0 + (b - b0) < 1
    ? { a: a0, b: b0, orient: 'up' }
    : { a: a0, b: b0 + 1, orient: 'down' };
}
