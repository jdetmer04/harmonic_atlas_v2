// App state: the sketch (the one source of truth for the music, changed only
// by state/commands.ts) plus session state that is never undone: the explorer,
// timeline selection, transport flags, live MIDI and view prefs.

import { createStore } from 'zustand/vanilla';
import type { Meter } from '../core/chart';
import type { PC, PcSet } from '../core/pcset';
import type { Coord, PlacedNode, Triangle } from '../core/tonnetz';
import type { VoicingMode } from '../core/voicing';

// Sketch (SPEC "Core data model")

export interface ChordEvent {
  id: string;
  start: number; // beats (quarter notes) from sketch start
  dur: number;
  pcs: PcSet;
  bass?: PC;
  voicing?: number[]; // MIDI notes, lowest = bass; absent = auto-voice
  label?: string; // what the user typed, e.g. "Dm7/G"
  origin: 'typed' | 'tonnetz' | 'operator' | 'walker' | 'midi-in';
}

export type LaneRole = 'drum' | 'comp' | 'arp' | 'bass' | 'changes' | 'walker';

/** Rhythm lanes arrive in M4; the type is here so saved sketches already carry them. */
export interface Lane {
  id: string;
  steps: number;
  hits: number;
  rotation: number;
  stepBeats: number;
  role: LaneRole;
  seed: number;
  mute: boolean;
  accents?: boolean[];
}

export interface Camera {
  a: number; // view center, fractional lattice coordinates
  b: number;
  zoom: number; // node spacing in CSS pixels
}

export type Patch = 'epiano' | 'pad' | 'pluck';

/** Saved with the sketch, but not undoable. */
export interface SketchView {
  camera: Camera;
  /** Where the trail's first chord is placed. Fixed once set, so panning never re-embeds the path. */
  anchor: Coord | null;
}

export interface Sketch {
  id: string;
  name: string;
  tempo: number; // bpm
  meter: Meter;
  loop: [number, number] | null; // beats
  chords: ChordEvent[]; // sorted by start, non-overlapping
  lanes: Lane[];
  chartText: string;
  voicingMode: VoicingMode;
  patch: Patch;
  view: SketchView;
}

// Session

/** The one lit chord: a triad (P/L/R apply) or any set of nodes built by clicking. */
export type CurrentChord = { kind: 'triad'; triangle: Triangle } | { kind: 'nodes'; nodes: Coord[] };

export type LabelMode = 'notes' | 'pcs';

/** App-wide toggles, kept in localStorage rather than in any one sketch. */
export interface ViewPrefs {
  torus: boolean;
  labels: LabelMode;
  autoPan: boolean; // follow the current / playing chord
  frameOverlay: boolean;
  customOpsText: string; // e.g. "Q=PRL, W=LRLR"
  chartOpen: boolean;
}

export interface MidiPortInfo {
  id: string;
  name: string;
}

export type MidiStatus = 'pending' | 'ready' | 'unavailable' | 'denied';

export interface LiveState {
  held: number[]; // sorted MIDI note numbers physically held
  placed: PlacedNode[]; // compact placement of the held pitch classes
  bass: Coord | null; // node of the lowest held note
  midiStatus: MidiStatus;
  inputs: MidiPortInfo[];
  inputId: string | null;
}

export interface ExplorerState {
  current: CurrentChord | null;
  hover: Triangle | null;
  lastMove: string | null; // operator string of the last transform
}

export interface TimelineState {
  selection: string | null; // chord id
  /** Insert before chords[insertIndex]; chords.length appends at the end. */
  insertIndex: number;
}

export interface TransportState {
  playing: boolean;
  /** Chord sounding at the playhead (updated when it changes, not every frame); null in a rest or stopped. */
  chordIndex: number | null;
  metronome: boolean;
  countIn: boolean;
}

export interface HistoryEntry {
  label: string;
  before: Sketch;
  after: Sketch;
  coalesce: string | null;
  at: number; // ms, for coalescing bursts
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export interface SketchSummary {
  id: string;
  name: string;
  updated: number;
}

export interface AppState {
  sketch: Sketch;
  history: History;
  explorer: ExplorerState;
  timeline: TimelineState;
  transport: TransportState;
  live: LiveState;
  view: ViewPrefs;
  library: SketchSummary[]; // saved sketches, newest first
}

export const DEFAULT_VIEW: ViewPrefs = {
  torus: false,
  labels: 'notes',
  autoPan: true,
  frameOverlay: false,
  customOpsText: '',
  chartOpen: false,
};

export const DEFAULT_CAMERA: Camera = { a: 1, b: 0.5, zoom: 64 };

export function newSketchId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function emptySketch(id = newSketchId(), camera: Camera = DEFAULT_CAMERA): Sketch {
  return {
    id,
    name: 'Untitled',
    tempo: 96,
    meter: [4, 4],
    loop: null,
    chords: [],
    lanes: [],
    chartText: '@tempo 96\n@meter 4/4\n',
    voicingMode: 'smooth',
    patch: 'epiano',
    view: { camera, anchor: null },
  };
}

export function initialState(view: ViewPrefs = DEFAULT_VIEW, sketch: Sketch = emptySketch('initial')): AppState {
  return {
    sketch,
    history: { past: [], future: [] },
    explorer: { current: null, hover: null, lastMove: null },
    timeline: { selection: null, insertIndex: sketch.chords.length },
    transport: { playing: false, chordIndex: null, metronome: false, countIn: false },
    live: { held: [], placed: [], bass: null, midiStatus: 'pending', inputs: [], inputId: null },
    view,
    library: [],
  };
}

export const store = createStore<AppState>()(() => initialState());
