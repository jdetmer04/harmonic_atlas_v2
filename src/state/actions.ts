// Session actions: explorer, live MIDI and view prefs. These are not sketch
// edits, so they are plain setters rather than undoable commands.

import { fromPcs, type PC, type PcSet } from '../core/pcset';
import { COMPOUNDS, parseOps, walk } from '../core/ops';
import {
  centroid,
  pcAt,
  placeCompact,
  shapeOf,
  triangleNodes,
  trianglePcs,
  type Coord,
  type Triangle,
} from '../core/tonnetz';
import { store, type Camera, type CurrentChord, type LabelMode, type MidiPortInfo, type MidiStatus } from './store';

const set = store.setState;
const get = store.getState;

// Explorer

export function selectTriangle(triangle: Triangle): CurrentChord {
  const current: CurrentChord = { kind: 'triad', triangle };
  set((s) => ({ explorer: { ...s.explorer, current, lastMove: null } }));
  return current;
}

/**
 * Toggle a node in the current chord. A triad becomes its three nodes first;
 * a node set that forms a triangle becomes a triad again, so P/L/R apply.
 */
export function toggleNode(node: Coord): CurrentChord | null {
  const cur = get().explorer.current;
  const nodes = cur === null ? [] : cur.kind === 'triad' ? triangleNodes(cur.triangle) : cur.nodes;
  const without = nodes.filter((n) => n.a !== node.a || n.b !== node.b);
  const next = without.length === nodes.length ? [...nodes, { a: node.a, b: node.b }] : without;
  const current = normalize(next);
  set((s) => ({ explorer: { ...s.explorer, current, lastMove: null } }));
  return current;
}

function normalize(nodes: Coord[]): CurrentChord | null {
  if (nodes.length === 0) return null;
  const shape = shapeOf(nodes);
  return shape.kind === 'triad' ? { kind: 'triad', triangle: shape.triangle } : { kind: 'nodes', nodes };
}

/**
 * Apply an operator string (P, L, R, compounds) to the current triad as one
 * move. Returns the new chord, or null when there is no current triad.
 */
export function transform(ops: string): CurrentChord | null {
  const cur = get().explorer.current;
  if (cur?.kind !== 'triad') return null;
  const path = walk(cur.triangle, ops);
  const current: CurrentChord = { kind: 'triad', triangle: path[path.length - 1] as Triangle };
  set((s) => ({ explorer: { ...s.explorer, current, lastMove: ops.toUpperCase() } }));
  return current;
}

export function setHover(hover: Triangle | null) {
  const prev = get().explorer.hover;
  if (prev === hover || (prev && hover && prev.a === hover.a && prev.b === hover.b && prev.orient === hover.orient)) return;
  set((s) => ({ explorer: { ...s.explorer, hover } }));
}

export function clearCurrent() {
  set((s) => ({ explorer: { ...s.explorer, current: null, lastMove: null } }));
}

// Live MIDI

/**
 * Held notes changed. Places them compactly near the previous placement (or
 * the current chord, or the view center) so successive chords stay close.
 */
export function setHeld(notes: readonly number[]) {
  const held = [...new Set(notes)].sort((x, y) => x - y);
  const s = get();
  if (held.length === s.live.held.length && held.every((n, i) => n === s.live.held[i])) return;
  if (held.length === 0) {
    set({ live: { ...s.live, held, placed: [], bass: null } });
    return;
  }
  const anchor = roundCoord(
    s.live.placed.length > 0
      ? centroid(s.live.placed)
      : s.explorer.current
        ? centroid(chordNodes(s.explorer.current))
        : s.view.camera,
  );
  const placed = placeCompact(fromPcs(held), anchor);
  const bassPc = ((held[0] as number) % 12) as PC;
  const bassNode = placed.find((p) => p.pc === bassPc) ?? null;
  set({ live: { ...s.live, held, placed, bass: bassNode && { a: bassNode.a, b: bassNode.b } } });
}

export function setMidiStatus(midiStatus: MidiStatus) {
  set((s) => ({ live: { ...s.live, midiStatus } }));
}

export function setMidiInputs(inputs: MidiPortInfo[]) {
  set((s) => ({ live: { ...s.live, inputs } }));
}

export function selectMidiInput(inputId: string | null) {
  set((s) => ({ live: { ...s.live, inputId, held: [], placed: [], bass: null } }));
}

// View prefs

export function setCamera(camera: Camera) {
  set((s) => ({ view: { ...s.view, camera } }));
}

export function setTorus(torus: boolean) {
  set((s) => ({ view: { ...s.view, torus } }));
}

export function setLabels(labels: LabelMode) {
  set((s) => ({ view: { ...s.view, labels } }));
}

export function setAutoPan(autoPan: boolean) {
  set((s) => ({ view: { ...s.view, autoPan } }));
}

export function toggleFrameOverlay() {
  set((s) => ({ view: { ...s.view, frameOverlay: !s.view.frameOverlay } }));
}

export function setCustomOpsText(customOpsText: string) {
  set((s) => ({ view: { ...s.view, customOpsText } }));
}

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

// Helpers

export function chordNodes(chord: CurrentChord): Coord[] {
  return chord.kind === 'triad' ? triangleNodes(chord.triangle) : chord.nodes;
}

export function chordPcs(chord: CurrentChord): PcSet {
  return chord.kind === 'triad' ? trianglePcs(chord.triangle) : fromPcs(chord.nodes.map((n) => pcAt(n.a, n.b)));
}

function roundCoord(c: Coord): Coord {
  return { a: Math.round(c.a), b: Math.round(c.b) };
}
