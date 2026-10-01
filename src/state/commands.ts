// Every sketch edit is a command on one undo stack (SPEC "Everything undoes").
//
// The sketch is immutable, so a command's do/undo are the sketch after and
// before it; structural sharing keeps that cheap. Undo and redo never touch
// sketch.view (camera, trail anchor), which is saved but not undoable.
// Bursts of the same kind of edit (typing in the chart, dragging the tempo or
// loop) coalesce into one undo step.

import {
  barBeats,
  leadingComments,
  parseChart,
  printChart,
  type Meter,
  type ParsedChart,
} from '../core/chart';
import type { PC, PcSet } from '../core/pcset';
import type { Coord } from '../core/tonnetz';
import type { VoicingMode } from '../core/voicing';
import { writeSketch } from './mutate';
import {
  emptySketch,
  store,
  type Camera,
  type ChordEvent,
  type HistoryEntry,
  type Patch,
  type Sketch,
  type TimelineState,
} from './store';

const COALESCE_MS = 1200;
const HISTORY_LIMIT = 500;

const get = store.getState;

let chordCounter = 0;
export function newChordId(): string {
  chordCounter++;
  return `c${Date.now().toString(36)}${chordCounter.toString(36)}`;
}

function commit(label: string, next: Sketch, opts: { coalesce?: string; timeline?: Partial<TimelineState> } = {}) {
  const s = get();
  const before = s.sketch;
  if (next === before) return;
  const now = Date.now();
  const past = s.history.past.slice();
  const top = past[past.length - 1];
  const coalesce = opts.coalesce ?? null;
  if (coalesce !== null && top && top.coalesce === coalesce && now - top.at < COALESCE_MS && s.history.future.length === 0) {
    past[past.length - 1] = { ...top, after: next, at: now };
  } else {
    past.push({ label, before, after: next, coalesce, at: now });
    if (past.length > HISTORY_LIMIT) past.shift();
  }
  writeSketch(next, { past, future: [] }, opts.timeline);
}

export function undo(): HistoryEntry | null {
  const s = get();
  const entry = s.history.past[s.history.past.length - 1];
  if (!entry) return null;
  writeSketch({ ...entry.before, view: s.sketch.view }, {
    past: s.history.past.slice(0, -1),
    future: [...s.history.future, entry],
  });
  return entry;
}

export function redo(): HistoryEntry | null {
  const s = get();
  const entry = s.history.future[s.history.future.length - 1];
  if (!entry) return null;
  writeSketch({ ...entry.after, view: s.sketch.view }, {
    past: [...s.history.past, entry],
    future: s.history.future.slice(0, -1),
  });
  return entry;
}

/** Stop a coalescing burst, so the next edit of the same kind starts a new undo step. */
export function sealHistory() {
  const s = get();
  const top = s.history.past[s.history.past.length - 1];
  if (top?.coalesce) writeSketch(s.sketch, { past: [...s.history.past.slice(0, -1), { ...top, coalesce: null }], future: s.history.future });
}

// Chords

export interface NewChord {
  pcs: PcSet;
  bass?: PC;
  label?: string;
  voicing?: number[];
  origin: ChordEvent['origin'];
  /** Where it was drawn, so a sketch's first chord anchors the trail there. */
  near?: Coord;
}

export function sketchEnd(chords: readonly ChordEvent[]): number {
  let end = 0;
  for (const c of chords) end = Math.max(end, c.start + c.dur);
  return end;
}

/** Beat position of the insert point. */
export function insertBeat(chords: readonly ChordEvent[], index: number): number {
  return index < chords.length ? (chords[index] as ChordEvent).start : sketchEnd(chords);
}

/** Insert one bar of `chord` at the insert point, pushing later chords back. Returns its id. */
export function appendChord(chord: NewChord): string | null {
  if (chord.pcs === 0) return null;
  const s = get();
  const sk = s.sketch;
  const index = Math.min(s.timeline.insertIndex, sk.chords.length);
  const dur = barBeats(sk.meter);
  const start = insertBeat(sk.chords, index);
  const event: ChordEvent = { id: newChordId(), start, dur, pcs: chord.pcs, origin: chord.origin };
  if (chord.bass !== undefined) event.bass = chord.bass;
  if (chord.label !== undefined) event.label = chord.label;
  if (chord.voicing !== undefined) event.voicing = chord.voicing;

  const chords = [
    ...sk.chords.slice(0, index),
    event,
    ...sk.chords.slice(index).map((c) => ({ ...c, start: c.start + dur })),
  ];
  const next = withChords(sk, chords, chord.near);
  commit('Add chord', next, { timeline: { selection: event.id, insertIndex: index + 1 } });
  return event.id;
}

/** Remove a chord and close the gap. */
export function deleteChord(id: string) {
  const sk = get().sketch;
  const index = sk.chords.findIndex((c) => c.id === id);
  if (index < 0) return;
  const gone = sk.chords[index] as ChordEvent;
  const chords = [
    ...sk.chords.slice(0, index),
    ...sk.chords.slice(index + 1).map((c) => ({ ...c, start: c.start - gone.dur })),
  ];
  const nextSel = chords[index]?.id ?? chords[index - 1]?.id ?? null;
  commit('Delete chord', withChords(sk, chords), { timeline: { selection: nextSel, insertIndex: index } });
}

function withChords(sk: Sketch, chords: ChordEvent[], near?: Coord): Sketch {
  const next: Sketch = { ...sk, chords, chartText: rewriteChart(sk.chartText, sk.tempo, sk.meter, chords) };
  return withAnchor(next, near);
}

/** Fix the trail anchor the first time the sketch has chords. */
function withAnchor(sk: Sketch, near?: Coord): Sketch {
  if (sk.view.anchor !== null || sk.chords.length === 0) return sk;
  const c = near ?? sk.view.camera;
  return { ...sk, view: { ...sk.view, anchor: { a: Math.round(c.a), b: Math.round(c.b) } } };
}

function rewriteChart(previous: string, tempo: number, meter: Meter, chords: readonly ChordEvent[]): string {
  return printChart({ tempo, meter, chords, header: leadingComments(previous) });
}

// Chart text

/**
 * The text changed. A clean parse replaces the chords (keeping ids, and pinned
 * voicings that still fit, by position); with errors only the text is kept,
 * and the last valid chords keep playing.
 */
export function editChart(text: string): ParsedChart {
  const sk = get().sketch;
  const parsed = parseChart(text);
  if (parsed.errors.length > 0) {
    commit('Edit chart', { ...sk, chartText: text }, { coalesce: 'chart' });
    return parsed;
  }
  const chords: ChordEvent[] = parsed.chords.map((c, i) => {
    const old = sk.chords[i];
    const event: ChordEvent = { id: old?.id ?? newChordId(), start: c.start, dur: c.dur, pcs: c.pcs, label: c.label, origin: c.origin };
    if (c.bass !== undefined) event.bass = c.bass;
    if (old?.voicing && old.pcs === c.pcs && old.bass === c.bass) event.voicing = old.voicing;
    return event;
  });
  const next: Sketch = {
    ...sk,
    chords: sameChords(sk.chords, chords) ? sk.chords : chords,
    tempo: parsed.tempo ?? sk.tempo,
    meter: parsed.meter ?? sk.meter,
    chartText: text,
  };
  // An insert point at the end stays at the end as the chart grows.
  const atEnd = get().timeline.insertIndex >= sk.chords.length;
  commit('Edit chart', withAnchor(next), { coalesce: 'chart', ...(atEnd && { timeline: { insertIndex: chords.length } }) });
  return parsed;
}

function sameChords(a: readonly ChordEvent[], b: readonly ChordEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as ChordEvent;
    const y = b[i] as ChordEvent;
    if (x.id !== y.id || x.start !== y.start || x.dur !== y.dur || x.pcs !== y.pcs || x.bass !== y.bass || x.label !== y.label || x.origin !== y.origin || x.voicing !== y.voicing) return false;
  }
  return true;
}

// Sketch settings

export function setTempo(bpm: number) {
  const sk = get().sketch;
  const tempo = Math.max(20, Math.min(400, Math.round(bpm * 10) / 10));
  if (tempo === sk.tempo) return;
  // Only the @tempo line changes, so the rest of the text stays as typed.
  const line = `@tempo ${tempo}`;
  const chartText = /^@tempo\b.*$/m.test(sk.chartText)
    ? sk.chartText.replace(/^@tempo\b.*$/m, line)
    : `${line}\n${sk.chartText}`;
  commit('Tempo', { ...sk, tempo, chartText }, { coalesce: 'tempo' });
}

export function setMeter(meter: Meter) {
  const sk = get().sketch;
  if (meter[0] === sk.meter[0] && meter[1] === sk.meter[1]) return;
  commit('Meter', { ...sk, meter, chartText: rewriteChart(sk.chartText, sk.tempo, meter, sk.chords) });
}

/** Loop region in beats, or null for none. Dragging coalesces into one step. */
export function setLoop(loop: [number, number] | null) {
  const sk = get().sketch;
  const norm: [number, number] | null = loop && loop[1] - loop[0] > 1e-6 ? [Math.min(...loop), Math.max(...loop)] : null;
  if (norm === sk.loop || (norm && sk.loop && norm[0] === sk.loop[0] && norm[1] === sk.loop[1])) return;
  commit(norm ? 'Loop' : 'Clear loop', { ...sk, loop: norm }, { coalesce: 'loop' });
}

export function renameSketch(name: string) {
  const sk = get().sketch;
  if (name === sk.name) return;
  commit('Rename', { ...sk, name }, { coalesce: 'name' });
}

export function setVoicingMode(voicingMode: VoicingMode) {
  const sk = get().sketch;
  if (voicingMode !== sk.voicingMode) commit('Voicing mode', { ...sk, voicingMode });
}

export function setPatch(patch: Patch) {
  const sk = get().sketch;
  if (patch !== sk.patch) commit('Sound', { ...sk, patch });
}

// Not undoable

export function setCamera(camera: Camera) {
  const sk = get().sketch;
  const c = sk.view.camera;
  if (c.a === camera.a && c.b === camera.b && c.zoom === camera.zoom) return;
  writeSketch({ ...sk, view: { ...sk.view, camera } });
}

/** Replace the whole sketch (opening a saved one); the undo history starts over. */
export function loadSketch(sketch: Sketch) {
  writeSketch(sketch, { past: [], future: [] }, { selection: null, insertIndex: sketch.chords.length });
}

export function newSketch() {
  loadSketch(emptySketch(undefined, get().sketch.view.camera));
}
