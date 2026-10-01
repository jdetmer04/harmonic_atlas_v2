// Session actions: explorer, timeline selection, transport flags, live MIDI
// and view prefs. These are not sketch edits, so they are plain setters
// rather than undoable commands; sketch edits go through commands.ts.

import { chordText } from '../core/chart';
import { fromPcs, type PC } from '../core/pcset';
import { walk } from '../core/ops';
import { centroid, placeCompact, shapeOf, type Coord, type Triangle } from '../core/tonnetz';
import { appendChord, type NewChord } from './commands';
import { chordNodes, chordPcs, roundCoord } from './helpers';
import { selectTrail } from './selectors';
import {
  store,
  type ChordEvent,
  type CurrentChord,
  type LabelMode,
  type MidiPortInfo,
  type MidiStatus,
  type SketchSummary,
} from './store';

export { chordNodes, chordPcs, parseCustomOps, RESERVED_KEYS, type CustomOps } from './helpers';

const set = store.setState;
const get = store.getState;

// Explorer

export function selectTriangle(triangle: Triangle): CurrentChord {
  const current: CurrentChord = { kind: 'triad', triangle };
  set((s) => ({ explorer: { ...s.explorer, current, bass: null, label: null, lastMove: null } }));
  return current;
}

/**
 * Toggle a node in the current chord. A triad becomes its three nodes first;
 * a node set that forms a triangle becomes a triad again, so P/L/R apply.
 */
export function toggleNode(node: Coord): CurrentChord | null {
  const cur = get().explorer.current;
  const nodes = cur === null ? [] : chordNodes(cur);
  const without = nodes.filter((n) => n.a !== node.a || n.b !== node.b);
  const next = without.length === nodes.length ? [...nodes, { a: node.a, b: node.b }] : without;
  const current = normalize(next);
  set((s) => ({ explorer: { ...s.explorer, current, bass: null, label: null, lastMove: null } }));
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
  set((s) => ({ explorer: { ...s.explorer, current, bass: null, label: null, lastMove: ops.toUpperCase() } }));
  return current;
}

export function setHover(hover: Triangle | null) {
  const prev = get().explorer.hover;
  if (prev === hover || (prev && hover && prev.a === hover.a && prev.b === hover.b && prev.orient === hover.orient)) return;
  set((s) => ({ explorer: { ...s.explorer, hover } }));
}

export function clearCurrent() {
  set((s) => ({ explorer: { ...s.explorer, current: null, bass: null, label: null, lastMove: null } }));
}

/** Append the current (or draft) chord at the insert point. Returns the new chord's id. */
export function appendCurrent(origin: NewChord['origin'] = 'tonnetz'): string | null {
  const cur = get().explorer.current;
  if (!cur) return null;
  return appendChord({ pcs: chordPcs(cur), origin, near: centroid(chordNodes(cur)) });
}

// Timeline

/** Select a chord: it becomes the current chord (so P/L/R continue from it) and the insert point follows it. */
export function selectChord(id: string | null) {
  const s = get();
  if (id === null) {
    set({ timeline: { ...s.timeline, selection: null } });
    return;
  }
  const index = s.sketch.chords.findIndex((c) => c.id === id);
  if (index < 0) return;
  const e = selectTrail(s)[index];
  const current: CurrentChord | null = !e
    ? s.explorer.current
    : e.shape.kind === 'triad'
      ? { kind: 'triad', triangle: e.shape.triangle }
      : { kind: 'nodes', nodes: e.nodes.map(({ a, b }) => ({ a, b })) };
  set({
    timeline: { selection: id, insertIndex: index + 1 },
    explorer: { ...s.explorer, current, bass: e?.bassNode ?? null, label: chordText(s.sketch.chords[index] as ChordEvent), lastMove: null },
  });
}

/** Move the insert point by whole chords (Left / Right). */
export function moveInsert(delta: number) {
  const s = get();
  const insertIndex = Math.max(0, Math.min(s.sketch.chords.length, s.timeline.insertIndex + delta));
  if (insertIndex !== s.timeline.insertIndex) set({ timeline: { selection: null, insertIndex } });
}

export function setInsertIndex(insertIndex: number) {
  const s = get();
  const i = Math.max(0, Math.min(s.sketch.chords.length, insertIndex));
  set({ timeline: { selection: null, insertIndex: i } });
}

// Transport flags (the engine owns the clock; these mirror it for the UI)

export function setPlaying(playing: boolean) {
  set((s) => ({ transport: { ...s.transport, playing, chordIndex: playing ? s.transport.chordIndex : null } }));
}

export function setChordIndex(chordIndex: number | null) {
  if (get().transport.chordIndex === chordIndex) return;
  set((s) => ({ transport: { ...s.transport, chordIndex } }));
}

export function setMetronome(metronome: boolean) {
  set((s) => ({ transport: { ...s.transport, metronome } }));
}

export function setCountIn(countIn: boolean) {
  set((s) => ({ transport: { ...s.transport, countIn } }));
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
        : s.sketch.view.camera,
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

export function toggleChart() {
  set((s) => ({ view: { ...s.view, chartOpen: !s.view.chartOpen } }));
}

// Library (saved sketches)

export function setLibrary(library: SketchSummary[]) {
  set({ library });
}
