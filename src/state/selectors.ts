// Derived views of state, memoized on the inputs they read so per-frame
// callers get the same object back until something changes.

import { bassOf, chordText, parseChart, type ParsedChart } from '../core/chart';
import { classifyMove, embedPath, type EmbeddedChord, type Move } from '../core/embed';
import { fromPcs } from '../core/pcset';
import { defaultName, noteName, spell } from '../core/spell';
import { pcAt, qAt, shapeOf, triangleName, trianglePcs, type Coord, type Shape, type Triangle } from '../core/tonnetz';
import { autoVoice } from '../core/voicing';
import { chordNodes, parseCustomOps, type CustomOps } from './helpers';
import type { AppState, ChordEvent, CurrentChord, LiveState, Sketch } from './store';

export interface Display {
  source: 'midi' | 'playhead' | 'explorer' | 'none';
  nodes: Coord[];
  shape: Shape;
  bass: Coord | null;
  pcs: number; // PcSet
  name: string; // spelled from position ('E♭⁴'), or plainly on the torus
  hint: string | null; // plain spelling when `name` has drifted past double accidentals ('C')
  label: string | null; // the sketch chord's own name ('Am7'), when it is one
}

const NONE: Display = { source: 'none', nodes: [], shape: { kind: 'empty' }, bass: null, pcs: 0, name: '', hint: null, label: null };

/** Memoize a function of a few inputs by identity. */
function memo<A extends readonly unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: A | null = null;
  let result: R;
  return (...args: A) => {
    if (last && last.length === args.length && last.every((x, i) => x === args[i])) return result;
    last = args;
    result = fn(...args);
    return result;
  };
}

// Sketch

/** Each chord's voicing: pinned if set, else auto-voiced from the one before. */
export const selectVoicings = (s: AppState) => voicings(s.sketch.chords, s.sketch.voicingMode);

const voicings = memo((chords: readonly ChordEvent[], mode: Sketch['voicingMode']): number[][] => {
  const out: number[][] = [];
  let prev: number[] | null = null;
  for (const c of chords) {
    const v: number[] = c.voicing ?? autoVoice(c.pcs, { bass: bassOf(c), prev, mode });
    out.push(v);
    prev = v;
  }
  return out;
});

/** Where each chord sits on the Tonnetz (SPEC "Path embedding"). */
export const selectTrail = (s: AppState) => trail(s.sketch.chords, s.sketch.view.anchor);

const ORIGIN: Coord = { a: 0, b: 0 };
// The ring goes on the voiced bass: the slash bass, else the root, else the lowest note.
const trail = memo((chords: readonly ChordEvent[], anchor: Coord | null): (EmbeddedChord | null)[] =>
  embedPath(
    chords.map((c) => ({ pcs: c.pcs, bass: bassOf(c) })),
    anchor ?? ORIGIN,
  ),
);

/** Move type into each chord from the one before; the first chord's is null. */
export const selectMoves = (s: AppState) => moves(s.sketch.chords);

const moves = memo((chords: readonly ChordEvent[]): (Move | null)[] =>
  chords.map((c, i) => (i === 0 ? null : classifyMove((chords[i - 1] as ChordEvent).pcs, c.pcs))),
);

export const selectChart = (s: AppState) => chart(s.sketch.chartText);
const chart = memo((text: string): ParsedChart => parseChart(text));

/**
 * Index of the chord sounding at beat `t`, or -1 in a rest. Binary search, no
 * allocation, so it is safe per frame.
 */
export function chordIndexAt(chords: readonly ChordEvent[], t: number): number {
  let lo = 0;
  let hi = chords.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = chords[mid] as ChordEvent;
    if (t < c.start) hi = mid - 1;
    else if (t >= c.start + c.dur) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function selectedIndex(s: AppState): number {
  const id = s.timeline.selection;
  return id === null ? -1 : s.sketch.chords.findIndex((c) => c.id === id);
}

// What the Tonnetz lights

let lastCurrent: CurrentChord | null = null;
let lastLive: LiveState | null = null;
let lastTorus = false;
let lastPlaying: number | null = null;
let lastTrail: readonly (EmbeddedChord | null)[] | null = null;
let lastDisplay: Display = NONE;

/** Held MIDI notes override the playing chord, which overrides the current chord. */
export function selectDisplay(s: AppState): Display {
  const playing = s.transport.playing ? s.transport.chordIndex : null;
  const path = playing !== null ? selectTrail(s) : null;
  if (
    s.explorer.current === lastCurrent &&
    s.live === lastLive &&
    s.view.torus === lastTorus &&
    playing === lastPlaying &&
    path === lastTrail
  ) {
    return lastDisplay;
  }
  lastCurrent = s.explorer.current;
  lastLive = s.live;
  lastTorus = s.view.torus;
  lastPlaying = playing;
  lastTrail = path;
  lastDisplay = computeDisplay(s, playing, path);
  return lastDisplay;
}

function computeDisplay(s: AppState, playing: number | null, path: readonly (EmbeddedChord | null)[] | null): Display {
  const torus = s.view.torus;
  if (s.live.placed.length > 0) {
    const nodes = s.live.placed.map(({ a, b }) => ({ a, b }));
    const pcs = fromPcs(s.live.placed.map((p) => p.pc));
    return { source: 'midi', nodes, shape: shapeOf(nodes), bass: s.live.bass, pcs, label: null, ...nodesName(nodes, torus) };
  }
  const e = playing !== null && path ? path[playing] : null;
  if (e) {
    const nodes = e.nodes.map(({ a, b }) => ({ a, b }));
    const naming = e.shape.kind === 'triad' ? triadName(e.shape.triangle, torus) : nodesName(nodes, torus);
    const c = s.sketch.chords[playing as number];
    return { source: 'playhead', nodes, shape: e.shape, bass: e.bassNode, pcs: c?.pcs ?? 0, label: c ? chordText(c) : null, ...naming };
  }
  const cur = s.explorer.current;
  if (!cur) return NONE;
  const nodes = chordNodes(cur);
  const pcs = cur.kind === 'triad' ? trianglePcs(cur.triangle) : fromPcs(nodes.map((n) => pcAt(n.a, n.b)));
  const naming = cur.kind === 'triad' ? triadName(cur.triangle, torus) : nodesName(nodes, torus);
  return { source: 'explorer', nodes, shape: shapeOf(nodes), bass: s.explorer.bass, pcs, label: s.explorer.label, ...naming };
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
