// App state. M1 holds only session state (the explorer, live MIDI, view
// prefs); none of it is the sketch, so none of it goes through commands or
// undo. The sketch and its commands arrive in M2.

import { createStore } from 'zustand/vanilla';
import type { Coord, PlacedNode, Triangle } from '../core/tonnetz';

/** The one lit chord: a triad (P/L/R apply) or any set of nodes built by clicking. */
export type CurrentChord = { kind: 'triad'; triangle: Triangle } | { kind: 'nodes'; nodes: Coord[] };

export interface Camera {
  a: number; // view center, fractional lattice coordinates
  b: number;
  zoom: number; // node spacing in CSS pixels
}

export type LabelMode = 'notes' | 'pcs';

export interface ViewPrefs {
  camera: Camera;
  torus: boolean;
  labels: LabelMode;
  autoPan: boolean;
  frameOverlay: boolean;
  customOpsText: string; // e.g. "Q=PRL, W=LRLR"
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

export interface AppState {
  explorer: ExplorerState;
  live: LiveState;
  view: ViewPrefs;
}

export const DEFAULT_VIEW: ViewPrefs = {
  camera: { a: 1, b: 0.5, zoom: 64 },
  torus: false,
  labels: 'notes',
  autoPan: true,
  frameOverlay: false,
  customOpsText: '',
};

export function initialState(view: ViewPrefs = DEFAULT_VIEW): AppState {
  return {
    explorer: { current: null, hover: null, lastMove: null },
    live: { held: [], placed: [], bass: null, midiStatus: 'pending', inputs: [], inputId: null },
    view,
  };
}

export const store = createStore<AppState>()(() => initialState());
