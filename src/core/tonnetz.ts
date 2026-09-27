// The Tonnetz lattice: axis a = fifths (+7), axis b = major thirds (+4), and the
// third direction (a+1, b−1) = minor thirds (+3).

import { fromPcs, mod, toPcs, type PC, type PcSet } from './pcset';
import { noteName } from './spell';
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

/** A pitch class placed on a lattice node. */
export interface PlacedNode extends Coord {
  pc: PC;
}

/** Candidate copies of a pitch class within `radius` steps of `center`. */
function copiesNear(pc: number, center: Coord, radius: number): Coord[] {
  const out: Coord[] = [];
  for (let da = -radius; da <= radius; da++) {
    for (let db = -radius; db <= radius; db++) {
      const n = { a: center.a + da, b: center.b + db };
      if (pcAt(n.a, n.b) === mod(pc, 12) && latticeDistance(center, n) <= radius) out.push(n);
    }
  }
  return out;
}

const EXACT_PLACEMENT_LIMIT = 8;
const PLACEMENT_RADIUS = 4;
const placementCache = new Map<string, PlacedNode[]>();

/**
 * Compact placement (SPEC "Path embedding" step 1): one lattice copy of each
 * pitch class in `set`, minimizing total pairwise lattice distance, then
 * translated by period vectors so its centroid sits nearest `near`.
 * Exact search up to 8 notes; greedy plus local improvement beyond that.
 */
export function placeCompact(set: PcSet, near: Coord = { a: 0, b: 0 }): PlacedNode[] {
  const key = `${set}@${near.a},${near.b}`;
  const cached = placementCache.get(key);
  if (cached) return cached;

  const pcs = toPcs(set);
  if (pcs.length === 0) return [];
  // The shape is translation-invariant, so pin the first pitch class and
  // search the others among nearby copies; place the result afterwards.
  const origin = nearestNode(pcs[0] as PC, { a: 0, b: 0 });
  const candidates = pcs.slice(1).map((pc) => copiesNear(pc, origin, PLACEMENT_RADIUS));
  const shape =
    pcs.length <= EXACT_PLACEMENT_LIMIT ? exactPlacement(origin, candidates) : localPlacement(origin, candidates);
  const placed = translateNear(shape, near).map((n, i) => ({ ...n, pc: pcs[i] as PC }));

  if (placementCache.size > 512) placementCache.clear();
  placementCache.set(key, placed);
  return placed;
}

/** Total pairwise lattice distance. */
export function spread(nodes: readonly Coord[]): number {
  let total = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) total += latticeDistance(nodes[i] as Coord, nodes[j] as Coord);
  }
  return total;
}

function exactPlacement(origin: Coord, candidates: Coord[][]): Coord[] {
  // Depth-first with pruning; start from the greedy answer as the bound.
  // Ties in spread go to the smaller hull area, so a chain of fifths stays a
  // straight line instead of folding over.
  let best = localPlacement(origin, candidates);
  let bestCost = spread(best);
  let bestArea = hullArea(best);
  const chosen: Coord[] = [origin];
  const search = (i: number, cost: number) => {
    if (cost > bestCost) return;
    if (i === candidates.length) {
      const area = cost < bestCost ? -1 : hullArea(chosen);
      if (cost < bestCost || area < bestArea - 1e-9) {
        best = chosen.slice();
        bestCost = cost;
        bestArea = hullArea(best);
      }
      return;
    }
    for (const c of candidates[i] as Coord[]) {
      let added = 0;
      for (const p of chosen) added += latticeDistance(p, c);
      chosen.push(c);
      search(i + 1, cost + added);
      chosen.pop();
    }
  };
  search(0, 0);
  return best;
}

/** Screen-space area of the convex hull (s = 1); 0 for collinear sets. */
export function hullArea(nodes: readonly Coord[]): number {
  const hull = convexHull(nodes).map((n) => toXY(n.a, n.b, 1));
  let twice = 0;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i] as { x: number; y: number };
    const q = hull[(i + 1) % hull.length] as { x: number; y: number };
    twice += p.x * q.y - q.x * p.y;
  }
  return Math.abs(twice) / 2;
}

function localPlacement(origin: Coord, candidates: Coord[][]): Coord[] {
  const chosen: Coord[] = [origin];
  for (const options of candidates) {
    let pick = options[0] as Coord;
    let pickCost = Infinity;
    for (const c of options) {
      let cost = 0;
      for (const p of chosen) cost += latticeDistance(p, c);
      if (cost < pickCost) {
        pick = c;
        pickCost = cost;
      }
    }
    chosen.push(pick);
  }
  // Move one note at a time while that lowers the total.
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < chosen.length; i++) {
      const current = spread(chosen);
      for (const c of candidates[i - 1] as Coord[]) {
        const prev = chosen[i] as Coord;
        chosen[i] = c;
        if (spread(chosen) < current) {
          improved = true;
          break;
        }
        chosen[i] = prev;
      }
    }
  }
  return chosen;
}

export function centroid(nodes: readonly Coord[]): Coord {
  let a = 0;
  let b = 0;
  for (const n of nodes) {
    a += n.a;
    b += n.b;
  }
  return { a: a / nodes.length, b: b / nodes.length };
}

/** Translate a shape by a period-lattice vector so its centroid lands nearest `near` on screen. */
export function translateNear(nodes: readonly Coord[], near: Coord): Coord[] {
  const c = centroid(nodes);
  const [u, v] = PERIODS;
  // Solve near − c ≈ m·u + n·v, then check the neighbouring integer pairs.
  const da = near.a - c.a;
  const db = near.b - c.b;
  const m0 = Math.round(da / u.a);
  const n0 = Math.round((db - m0 * u.b) / v.b);
  let best = { m: 0, n: 0, d: Infinity };
  for (let m = m0 - 1; m <= m0 + 1; m++) {
    for (let n = n0 - 1; n <= n0 + 1; n++) {
      const p = toXY(c.a + m * u.a + n * v.a, c.b + m * u.b + n * v.b, 1);
      const q = toXY(near.a, near.b, 1);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best.d) best = { m, n, d };
    }
  }
  const ta = best.m * u.a + best.n * v.a;
  const tb = best.m * u.b + best.n * v.b;
  return nodes.map((n) => ({ a: n.a + ta, b: n.b + tb }));
}

export type Axis = 'fifths' | 'majorThirds' | 'minorThirds';

/** How a set of lit nodes is drawn (SPEC "Rendering"). */
export type Shape =
  | { kind: 'empty' }
  | { kind: 'note'; node: Coord }
  | { kind: 'triad'; triangle: Triangle }
  /** All nodes on one line; `axis` is null for off-axis lines such as a lone major seventh. */
  | { kind: 'capsule'; axis: Axis | null; from: Coord; to: Coord }
  /** Convex hull (counter-clockwise on screen) plus lattice-adjacent pairs, drawn as thick edges. */
  | { kind: 'hull'; hull: Coord[]; edges: [Coord, Coord][] };

export function shapeOf(input: readonly Coord[]): Shape {
  const nodes = dedupe(input);
  if (nodes.length === 0) return { kind: 'empty' };
  const first = nodes[0] as Coord;
  if (nodes.length === 1) return { kind: 'note', node: first };

  const edges = adjacentPairs(nodes);
  if (nodes.length === 3 && edges.length === 3) {
    const c = centroid(nodes);
    return { kind: 'triad', triangle: triangleAt(c.a, c.b) };
  }

  const dir = { a: (nodes[1] as Coord).a - first.a, b: (nodes[1] as Coord).b - first.b };
  const collinear = nodes.every((n) => dir.a * (n.b - first.b) - dir.b * (n.a - first.a) === 0);
  if (collinear) {
    // Order along the line to find the ends.
    const t = (n: Coord) => (n.a - first.a) * dir.a + (n.b - first.b) * dir.b;
    const sorted = nodes.slice().sort((x, y) => t(x) - t(y));
    return { kind: 'capsule', axis: axisOf(dir), from: sorted[0] as Coord, to: sorted[sorted.length - 1] as Coord };
  }

  return { kind: 'hull', hull: convexHull(nodes), edges };
}

function axisOf(d: Coord): Axis | null {
  if (d.b === 0) return 'fifths';
  if (d.a === 0) return 'majorThirds';
  if (d.a === -d.b) return 'minorThirds';
  return null;
}

function dedupe(nodes: readonly Coord[]): Coord[] {
  const seen = new Set<string>();
  const out: Coord[] = [];
  for (const n of nodes) {
    const k = `${n.a},${n.b}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ a: n.a, b: n.b });
    }
  }
  return out;
}

export function adjacentPairs(nodes: readonly Coord[]): [Coord, Coord][] {
  const out: [Coord, Coord][] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (latticeDistance(nodes[i] as Coord, nodes[j] as Coord) === 1) out.push([nodes[i] as Coord, nodes[j] as Coord]);
    }
  }
  return out;
}

/**
 * Convex hull by monotone chain, computed in screen space (s = 1) so the
 * winding is visual. Collinear boundary points are dropped.
 */
export function convexHull(nodes: readonly Coord[]): Coord[] {
  const pts = dedupe(nodes)
    .map((n) => ({ n, ...toXY(n.a, n.b, 1) }))
    .sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts.map((p) => p.n);
  type P = (typeof pts)[number];
  const cross = (o: P, p: P, q: P) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const EPS = 1e-9;
  const lower: P[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as P, lower[lower.length - 1] as P, p) <= EPS) lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (const p of pts.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2] as P, upper[upper.length - 1] as P, p) <= EPS) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1)).map((p) => p.n);
}

/** A triad's name spelled from its position: 'C', 'A♭m', 'F♯♯'. */
export function triangleName(t: Triangle): string {
  return noteName(qAt(t.a, t.b)) + (t.orient === 'down' ? 'm' : '');
}
