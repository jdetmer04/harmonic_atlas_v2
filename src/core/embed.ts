// Path embedding (SPEC "Path embedding"): which copy of each chord to draw.
//
// Each chord takes its compact placement, translated by a period vector so its
// centroid lands nearest the previous chord's (the first goes nearest a fixed
// anchor). Nothing ever re-centers, so a long progression drifts, and that
// drift is information.

import { applyOps, triadOf, type Op, type Triad } from './ops';
import type { PC, PcSet } from './pcset';
import { centroid, nearestNode, placeCompact, shapeOf, type Coord, type PlacedNode, type Shape } from './tonnetz';

export interface EmbeddedChord {
  nodes: PlacedNode[];
  centroid: Coord;
  shape: Shape;
  bassNode: Coord | null;
}

export type MoveKind = 'same' | 'flip' | 'compound' | 'jump';

export interface Move {
  kind: MoveKind;
  /** Shortest P/L/R string between two triads, e.g. "LP"; '' when not both triads. */
  ops: string;
}

export function embedChord(pcs: PcSet, bass: PC | undefined, near: Coord): EmbeddedChord {
  const nodes = placeCompact(pcs, near);
  const nodeCoords = nodes.map(({ a, b }) => ({ a, b }));
  const c = centroid(nodeCoords);
  let bassNode: Coord | null = null;
  if (bass !== undefined) {
    const own = nodes.find((n) => n.pc === bass);
    bassNode = own ? { a: own.a, b: own.b } : nearestNode(bass, { a: Math.round(c.a), b: Math.round(c.b) });
  }
  return { nodes, centroid: c, shape: shapeOf(nodeCoords), bassNode };
}

/** Embed a progression: continuity from `anchor`. Empty sets embed as nothing and don't move the path. */
export function embedPath(chords: readonly { pcs: PcSet; bass?: PC }[], anchor: Coord): (EmbeddedChord | null)[] {
  const out: (EmbeddedChord | null)[] = [];
  let near = anchor;
  for (const c of chords) {
    if (c.pcs === 0) {
      out.push(null);
      continue;
    }
    const e = embedChord(c.pcs, c.bass, near);
    out.push(e);
    near = e.centroid;
  }
  return out;
}

// Move classification

const COMPOUND_MAX = 3;

const triadIndex = (t: Triad) => t.root * 2 + (t.quality === 'min' ? 1 : 0);
let shortest: string[] | null = null;

/** Breadth-first over the 24 triads: the shortest P/L/R string between each pair. */
function shortestTable(): string[] {
  const table = new Array<string>(24 * 24).fill('');
  for (let start = 0; start < 24; start++) {
    const from: Triad = { root: (start >> 1) as PC, quality: start & 1 ? 'min' : 'maj' };
    const seen = new Map<number, string>([[start, '']]);
    let frontier: [Triad, string][] = [[from, '']];
    while (frontier.length > 0) {
      const next: [Triad, string][] = [];
      for (const [t, path] of frontier) {
        for (const op of ['P', 'L', 'R'] as Op[]) {
          const u = applyOps(t, [op]);
          const k = triadIndex(u);
          if (seen.has(k)) continue;
          seen.set(k, path + op);
          next.push([u, path + op]);
        }
      }
      frontier = next;
    }
    for (const [k, path] of seen) table[start * 24 + k] = path;
  }
  return table;
}

/** Shortest operator string taking triad `a` to triad `b`. */
export function shortestOps(a: Triad, b: Triad): string {
  shortest ??= shortestTable();
  return shortest[triadIndex(a) * 24 + triadIndex(b)] as string;
}

/** Trail segment color class: a single flip, a short compound (≤ 3 ops), or a jump. */
export function classifyMove(from: PcSet, to: PcSet): Move {
  if (from === to) return { kind: 'same', ops: '' };
  const a = triadOf(from);
  const b = triadOf(to);
  if (!a || !b) return { kind: 'jump', ops: '' };
  const ops = shortestOps(a, b);
  if (ops.length === 1) return { kind: 'flip', ops };
  return { kind: ops.length <= COMPOUND_MAX ? 'compound' : 'jump', ops };
}

