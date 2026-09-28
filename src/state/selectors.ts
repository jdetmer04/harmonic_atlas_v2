// Derived views of state, memoized on the inputs they read so per-frame
// callers get the same object back until something changes.

import { fromPcs } from '../core/pcset';
import { defaultName, noteName, spell } from '../core/spell';
import { pcAt, qAt, shapeOf, triangleName, trianglePcs, type Coord, type Shape, type Triangle } from '../core/tonnetz';
import { chordNodes, parseCustomOps, type CustomOps } from './actions';
import type { AppState, CurrentChord, LiveState } from './store';

export interface Display {
  source: 'midi' | 'explorer' | 'none';
  nodes: Coord[];
  shape: Shape;
  bass: Coord | null;
  pcs: number; // PcSet
  name: string; // spelled from position ('E♭⁴'), or plainly on the torus
  hint: string | null; // plain spelling when `name` has drifted past double accidentals ('C')
}

const NONE: Display = { source: 'none', nodes: [], shape: { kind: 'empty' }, bass: null, pcs: 0, name: '', hint: null };

let lastCurrent: CurrentChord | null = null;
let lastLive: LiveState | null = null;
let lastTorus = false;
let lastDisplay: Display = NONE;

/** What the Tonnetz lights: held MIDI notes override the current chord. */
export function selectDisplay(s: AppState): Display {
  if (s.explorer.current === lastCurrent && s.live === lastLive && s.view.torus === lastTorus) return lastDisplay;
  lastCurrent = s.explorer.current;
  lastLive = s.live;
  lastTorus = s.view.torus;
  lastDisplay = computeDisplay(s);
  return lastDisplay;
}

function computeDisplay(s: AppState): Display {
  const torus = s.view.torus;
  if (s.live.placed.length > 0) {
    const nodes = s.live.placed.map(({ a, b }) => ({ a, b }));
    const pcs = fromPcs(s.live.placed.map((p) => p.pc));
    return { source: 'midi', nodes, shape: shapeOf(nodes), bass: s.live.bass, pcs, ...nodesName(nodes, torus) };
  }
  const cur = s.explorer.current;
  if (!cur) return NONE;
  const nodes = chordNodes(cur);
  const pcs = cur.kind === 'triad' ? trianglePcs(cur.triangle) : fromPcs(nodes.map((n) => pcAt(n.a, n.b)));
  const naming = cur.kind === 'triad' ? triadName(cur.triangle, torus) : nodesName(nodes, torus);
  return { source: 'explorer', nodes, shape: shapeOf(nodes), bass: null, pcs, ...naming };
}

const drifted = (q: number) => Math.abs(spell(q).accidentals) > 2;

function triadName(t: Triangle, torus: boolean): { name: string; hint: string | null } {
  const suffix = t.orient === 'down' ? 'm' : '';
  const plain = defaultName(pcAt(t.a, t.b)) + suffix;
  if (torus) return { name: plain, hint: null };
  return { name: triangleName(t), hint: drifted(qAt(t.a, t.b)) ? plain : null };
}

/** Node names in line-of-fifths order: "F C G". */
function nodesName(nodes: readonly Coord[], torus: boolean): { name: string; hint: string | null } {
  const qs = nodes.map((n) => qAt(n.a, n.b)).sort((x, y) => x - y);
  const plain = qs.map((q) => defaultName(pcAt(q, 0))).join(' ');
  if (torus) return { name: plain, hint: null };
  return { name: qs.map(noteName).join(' '), hint: qs.some(drifted) ? plain : null };
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
