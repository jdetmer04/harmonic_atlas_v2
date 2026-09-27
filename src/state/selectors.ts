// Derived views of state, memoized on the inputs they read so per-frame
// callers get the same object back until something changes.

import { fromPcs } from '../core/pcset';
import { noteName } from '../core/spell';
import { pcAt, qAt, shapeOf, triangleName, trianglePcs, type Coord, type Shape } from '../core/tonnetz';
import { chordNodes, parseCustomOps, type CustomOps } from './actions';
import type { AppState, CurrentChord, LiveState } from './store';

export interface Display {
  source: 'midi' | 'explorer' | 'none';
  nodes: Coord[];
  shape: Shape;
  bass: Coord | null;
  pcs: number; // PcSet
  name: string;
}

const NONE: Display = { source: 'none', nodes: [], shape: { kind: 'empty' }, bass: null, pcs: 0, name: '' };

let lastCurrent: CurrentChord | null = null;
let lastLive: LiveState | null = null;
let lastDisplay: Display = NONE;

/** What the Tonnetz lights: held MIDI notes override the current chord. */
export function selectDisplay(s: AppState): Display {
  if (s.explorer.current === lastCurrent && s.live === lastLive) return lastDisplay;
  lastCurrent = s.explorer.current;
  lastLive = s.live;
  lastDisplay = computeDisplay(s);
  return lastDisplay;
}

function computeDisplay(s: AppState): Display {
  if (s.live.placed.length > 0) {
    const nodes = s.live.placed.map(({ a, b }) => ({ a, b }));
    return { source: 'midi', nodes, shape: shapeOf(nodes), bass: s.live.bass, pcs: fromPcs(s.live.placed.map((p) => p.pc)), name: nodesName(nodes) };
  }
  const cur = s.explorer.current;
  if (!cur) return NONE;
  const nodes = chordNodes(cur);
  const pcs = cur.kind === 'triad' ? trianglePcs(cur.triangle) : fromPcs(nodes.map((n) => pcAt(n.a, n.b)));
  const name = cur.kind === 'triad' ? triangleName(cur.triangle) : nodesName(nodes);
  return { source: 'explorer', nodes, shape: shapeOf(nodes), bass: null, pcs, name };
}

/** Node names in line-of-fifths order: "F C G". */
function nodesName(nodes: readonly Coord[]): string {
  return nodes
    .map((n) => qAt(n.a, n.b))
    .sort((x, y) => x - y)
    .map(noteName)
    .join(' ');
}

let lastOpsText: string | null = null;
let lastOps: CustomOps = { bindings: {}, errors: [] };

export function selectCustomOps(s: AppState): CustomOps {
  if (s.view.customOpsText !== lastOpsText) {
    lastOpsText = s.view.customOpsText;
    lastOps = parseCustomOps(lastOpsText);
  }
  return lastOps;
}
