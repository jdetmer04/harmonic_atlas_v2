// Helpers shared by actions and selectors (kept apart so the two don't import each other).

import { COMPOUNDS, parseOps } from '../core/ops';
import { fromPcs, type PcSet } from '../core/pcset';
import { pcAt, triangleNodes, trianglePcs, type Coord } from '../core/tonnetz';
import type { CurrentChord } from './store';

// Custom operator strings: "Q=PRL, W=LRLR"

/** Letters that already have a job in the keymap. */
export const RESERVED_KEYS = new Set(['P', 'L', 'R', ...Object.keys(COMPOUNDS), 'C']);

export interface CustomOps {
  bindings: Record<string, string>; // key letter → operator string
  errors: string[];
}

export function parseCustomOps(text: string): CustomOps {
  const bindings: Record<string, string> = {};
  const errors: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const m = /^([A-Za-z])\s*=\s*(.+)$/.exec(entry);
    if (!m) {
      errors.push(`"${entry}": write KEY=OPS, e.g. Q=PRL`);
      continue;
    }
    const key = (m[1] as string).toUpperCase();
    const ops = (m[2] as string).replace(/\s+/g, '').toUpperCase();
    if (RESERVED_KEYS.has(key)) {
      errors.push(`"${key}" is already a key (${[...RESERVED_KEYS].join(' ')} are taken)`);
      continue;
    }
    try {
      parseOps(ops);
      bindings[key] = ops;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { bindings, errors };
}



export function chordNodes(chord: CurrentChord): Coord[] {
  return chord.kind === 'triad' ? triangleNodes(chord.triangle) : chord.nodes;
}

export function chordPcs(chord: CurrentChord): PcSet {
  return chord.kind === 'triad' ? trianglePcs(chord.triangle) : fromPcs(chord.nodes.map((n) => pcAt(n.a, n.b)));
}

export function roundCoord(c: Coord): Coord {
  return { a: Math.round(c.a), b: Math.round(c.b) };
}
