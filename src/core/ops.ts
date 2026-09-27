// Neo-Riemannian transforms. Each is an edge flip on the Tonnetz:
//   P keeps the fifth edge        (C → Cm)
//   R keeps the major-third edge  (C → Am)
//   L keeps the minor-third edge  (C → Em)
// Compound strings apply left to right: "LPR" means L, then P, then R.

import { fromPcs, mod, popcount, toPcs, type PC, type PcSet } from './pcset';
import type { Triangle } from './tonnetz';

export type Quality = 'maj' | 'min';

export interface Triad {
  root: PC;
  quality: Quality;
}

export type Op = 'P' | 'L' | 'R';

/** Named compounds: slide, hexatonic pole, Nebenverwandt. */
export const COMPOUNDS: Readonly<Record<string, string>> = {
  S: 'LPR',
  H: 'LPL',
  N: 'RLP',
};

export function triadPcs(t: Triad): PcSet {
  return fromPcs([t.root, t.root + (t.quality === 'maj' ? 4 : 3), t.root + 7]);
}

/** The major or minor triad whose pitch classes are exactly `set`, else null. */
export function triadOf(set: PcSet): Triad | null {
  if (popcount(set) !== 3) return null;
  for (const root of toPcs(set)) {
    for (const quality of ['maj', 'min'] as const) {
      if (triadPcs({ root, quality }) === set) return { root, quality };
    }
  }
  return null;
}

export function apply(t: Triad, op: Op): Triad {
  const maj = t.quality === 'maj';
  switch (op) {
    case 'P':
      return { root: t.root, quality: maj ? 'min' : 'maj' };
    case 'R':
      return { root: shift(t.root, maj ? 9 : 3), quality: maj ? 'min' : 'maj' };
    case 'L':
      return { root: shift(t.root, maj ? 4 : 8), quality: maj ? 'min' : 'maj' };
  }
}

/**
 * Expand an operator string into primitive ops. Accepts P, L, R and the named
 * compounds; spaces are ignored. Throws on anything else.
 */
export function parseOps(str: string): Op[] {
  const out: Op[] = [];
  for (const ch of str.replace(/\s+/g, '').toUpperCase()) {
    if (ch === 'P' || ch === 'L' || ch === 'R') out.push(ch);
    else if (ch in COMPOUNDS) out.push(...parseOps(COMPOUNDS[ch] as string));
    else throw new Error(`Unknown operator "${ch}" in "${str}"`);
  }
  return out;
}

export function applyOps(t: Triad, ops: string | readonly Op[]): Triad {
  const list = typeof ops === 'string' ? parseOps(ops) : ops;
  return list.reduce(apply, t);
}

/** The same flip on the lattice: the neighbor across the kept edge, so paths keep their position. */
export function flip(t: Triangle, op: Op): Triangle {
  const { a, b } = t;
  if (t.orient === 'up') {
    switch (op) {
      case 'P':
        return { a, b, orient: 'down' };
      case 'R':
        return { a: a - 1, b: b + 1, orient: 'down' };
      case 'L':
        return { a, b: b + 1, orient: 'down' };
    }
  }
  switch (op) {
    case 'P':
      return { a, b, orient: 'up' };
    case 'R':
      return { a: a + 1, b: b - 1, orient: 'up' };
    case 'L':
      return { a, b: b - 1, orient: 'up' };
  }
}

/** Every triangle visited, starting with `start`. */
export function walk(start: Triangle, ops: string | readonly Op[]): Triangle[] {
  const list = typeof ops === 'string' ? parseOps(ops) : ops;
  const path = [start];
  for (const op of list) path.push(flip(path[path.length - 1] as Triangle, op));
  return path;
}

function shift(p: PC, n: number): PC {
  return mod(p + n, 12) as PC;
}
