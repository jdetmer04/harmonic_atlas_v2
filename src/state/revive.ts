// Validation for sketches read back from storage: everything is checked and
// filled in, so an older or damaged record opens rather than crashing the app.
// Kept free of browser APIs so it can be tested directly.

import { DEFAULT_METER } from '../core/chart';
import type { PC } from '../core/pcset';
import { VOICING_MODES } from '../core/voicing';
import { DEFAULT_CAMERA, emptySketch, type Camera, type ChordEvent, type Patch, type Sketch } from './store';

const PATCHES: readonly Patch[] = ['epiano', 'pad', 'pluck'];
const ORIGINS: readonly ChordEvent['origin'][] = ['typed', 'tonnetz', 'operator', 'walker', 'midi-in'];

const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

export function reviveCamera(c: Partial<Camera>): Camera {
  return { a: num(c.a, DEFAULT_CAMERA.a), b: num(c.b, DEFAULT_CAMERA.b), zoom: num(c.zoom, DEFAULT_CAMERA.zoom) };
}

export function reviveSketch(raw: unknown): Sketch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Sketch> & Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  const base = emptySketch(r.id);
  const chords: ChordEvent[] = [];
  let end = 0;
  for (const c of Array.isArray(r.chords) ? (r.chords as Partial<ChordEvent>[]) : []) {
    const start = num(c.start, NaN);
    const dur = num(c.dur, NaN);
    const pcs = num(c.pcs, 0) & 0xfff;
    if (!(dur > 0) || !(start >= end - 1e-9) || pcs === 0 || typeof c.id !== 'string') continue;
    const e: ChordEvent = { id: c.id, start, dur, pcs, origin: ORIGINS.includes(c.origin as ChordEvent['origin']) ? (c.origin as ChordEvent['origin']) : 'typed' };
    if (typeof c.bass === 'number' && c.bass >= 0 && c.bass < 12) e.bass = c.bass as PC;
    if (typeof c.label === 'string') e.label = c.label;
    if (Array.isArray(c.voicing) && c.voicing.every((n) => Number.isInteger(n) && n >= 0 && n < 128)) e.voicing = c.voicing;
    chords.push(e);
    end = start + dur;
  }
  const meter = Array.isArray(r.meter) && r.meter.length === 2 && r.meter.every((n) => Number.isInteger(n) && n > 0) ? (r.meter as [number, number]) : DEFAULT_METER;
  const loop = Array.isArray(r.loop) && r.loop.length === 2 && r.loop[1] > r.loop[0] ? (r.loop as [number, number]) : null;
  const view = (r.view ?? {}) as Partial<Sketch['view']>;
  const anchor = view.anchor && Number.isInteger(view.anchor.a) && Number.isInteger(view.anchor.b) ? { a: view.anchor.a, b: view.anchor.b } : null;
  return {
    ...base,
    name: typeof r.name === 'string' ? r.name : base.name,
    tempo: Math.max(20, Math.min(400, num(r.tempo, base.tempo))),
    meter,
    loop,
    chords,
    lanes: Array.isArray(r.lanes) ? (r.lanes as Sketch['lanes']) : [],
    chartText: typeof r.chartText === 'string' ? r.chartText : base.chartText,
    voicingMode: VOICING_MODES.includes(r.voicingMode as Sketch['voicingMode']) ? (r.voicingMode as Sketch['voicingMode']) : 'smooth',
    patch: PATCHES.includes(r.patch as Patch) ? (r.patch as Patch) : 'epiano',
    view: { camera: reviveCamera(view.camera ?? {}), anchor },
  };
}
