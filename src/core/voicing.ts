// Voicing: turning a pitch-class set into MIDI notes.
//
// closeVoicing is the quick audition voicing from M1. autoVoice is the
// playback voicing (SPEC "Auto-voicing"): every placement of each pitch class
// in the upper range, scored by how far the voices move from the previous
// voicing; the bass is voiced on its own, nearest the previous bass.

import { toPcs, type PC, type PcSet } from './pcset';
import { triadOf } from './ops';

/** Bass in C2–B2, then every pitch class once, stacked in A3–G♯4. */
export function closeVoicing(set: PcSet, bass?: PC): number[] {
  const pcs = toPcs(set);
  if (pcs.length === 0) return [];
  const low = bass ?? triadOf(set)?.root ?? (pcs[0] as PC);
  const upper = pcs.map((pc) => 57 + ((pc - 9 + 12) % 12)).sort((x, y) => x - y);
  return [36 + low, ...upper];
}

export type VoicingMode = 'smooth' | 'close' | 'drop2' | 'spread';

export const VOICING_MODES: readonly VoicingMode[] = ['smooth', 'close', 'drop2', 'spread'];

export interface VoiceOptions {
  /** The bass pitch class: the chord's bass, else its root, else its lowest pitch class. */
  bass: PC;
  /** Previous voicing, lowest note first; null for the first chord. */
  prev: readonly number[] | null;
  mode?: VoicingMode;
  upper?: [number, number]; // inclusive MIDI range, default C3–C5
  bassRange?: [number, number]; // default E1–C3
}

export const UPPER_RANGE: [number, number] = [48, 72];
export const BASS_RANGE: [number, number] = [28, 48];
/** Below E3, adjacent voices closer than a minor third turn to mud. */
const MUD_LINE = 52;
const MIN_LOW_INTERVAL = 3;
/** Where a first chord sits when there is nothing to lead from. */
const HOME_UPPER = 62;
const HOME_BASS = 38;
const MAX_CANDIDATES = 20000;

const cache = new Map<string, number[]>();

/**
 * Voice `pcs` as MIDI notes, sorted, bass first. A repeated chord never
 * moves; otherwise the upper voices take the candidate with the least total
 * motion from the previous voicing (doubling allowed), within the mode's
 * shape, and candidates with mud below E3 are dropped unless nothing else fits.
 */
export function autoVoice(pcs: PcSet, opts: VoiceOptions): number[] {
  const members = toPcs(pcs);
  if (members.length === 0) return [];
  const mode = opts.mode ?? 'smooth';
  const upperRange = opts.upper ?? UPPER_RANGE;
  const bassRange = opts.bassRange ?? BASS_RANGE;
  const key = `${pcs}|${opts.bass}|${mode}|${upperRange}|${bassRange}|${opts.prev?.join(',') ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const prev = opts.prev && opts.prev.length > 0 ? splitVoicing(opts.prev) : null;
  const upper = voiceUpper(members, prev?.upper ?? null, mode, upperRange);
  const bass = voiceBass(opts.bass, prev?.bass ?? null, upper[0] ?? upperRange[0], bassRange);
  const result = bass === null ? upper : [bass, ...upper];

  if (cache.size > 4096) cache.clear();
  cache.set(key, result);
  return result;
}

/** Lowest note is the bass; the rest are the upper voices. */
export function splitVoicing(notes: readonly number[]): { bass: number; upper: number[] } {
  const sorted = [...notes].sort((x, y) => x - y);
  return { bass: sorted[0] as number, upper: sorted.slice(1) };
}

function voiceUpper(members: PC[], prev: number[] | null, mode: VoicingMode, range: [number, number]): number[] {
  const all = candidates(members, range);
  const shaped = mode === 'smooth' ? all : all.map((c) => shape(c, mode, range)).filter((c): c is number[] => c !== null);
  const pool = nonEmpty(nonEmpty(shaped, all).filter(clear), nonEmpty(shaped, all));

  let best = pool[0] as number[];
  let bestCost = Infinity;
  for (const c of pool) {
    const cost = prev && prev.length > 0 ? motion(prev, c) : homeCost(c);
    if (cost < bestCost - 1e-9) {
      best = c;
      bestCost = cost;
    }
  }
  return best;
}

function nonEmpty<T>(xs: T[], fallback: T[]): T[] {
  return xs.length > 0 ? xs : fallback;
}

/**
 * Every placement of each pitch class once within range, sorted ascending.
 * Large sets would explode, so past MAX_CANDIDATES the search falls back to
 * close positions only (one per inversion and octave).
 */
export function candidates(members: readonly PC[], range: [number, number]): number[][] {
  const copies = members.map((pc) => {
    const out: number[] = [];
    for (let n = range[0]; n <= range[1]; n++) if (n % 12 === pc) out.push(n);
    return out;
  });
  let count = 1;
  for (const c of copies) count *= c.length;
  if (count > MAX_CANDIDATES) return closePositions(members, range);

  const out: number[][] = [];
  const pick: number[] = [];
  const rec = (i: number) => {
    if (i === copies.length) {
      out.push([...pick].sort((x, y) => x - y));
      return;
    }
    for (const n of copies[i] as number[]) {
      pick.push(n);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return out;
}

function closePositions(members: readonly PC[], range: [number, number]): number[][] {
  const out: number[][] = [];
  for (let low = range[0]; low <= range[1]; low++) {
    if (!members.includes((low % 12) as PC)) continue;
    const notes = members.map((pc) => low + ((pc - low + 120) % 12)).sort((x, y) => x - y);
    if ((notes[notes.length - 1] as number) <= range[1]) out.push(notes);
  }
  return out;
}

/** Reshape a candidate into the mode's form, or null if it isn't one. */
function shape(c: number[], mode: VoicingMode, range: [number, number]): number[] | null {
  const span = (c[c.length - 1] as number) - (c[0] as number);
  switch (mode) {
    case 'smooth':
      return c;
    case 'close':
      return span < 12 ? c : null;
    case 'drop2': {
      if (span >= 12) return null;
      if (c.length < 3) return c;
      const dropped = c.slice();
      dropped[c.length - 2] = (c[c.length - 2] as number) - 12;
      dropped.sort((x, y) => x - y);
      return (dropped[0] as number) >= range[0] ? dropped : null;
    }
    case 'spread': {
      if (c.length < 2) return c;
      for (let i = 1; i < c.length; i++) if ((c[i] as number) - (c[i - 1] as number) < 3) return null;
      return span >= 12 ? c : null;
    }
  }
}

/** No adjacent pair closer than a minor third with the lower note below E3. */
function clear(c: readonly number[]): boolean {
  for (let i = 1; i < c.length; i++) {
    const lo = c[i - 1] as number;
    if (lo < MUD_LINE && (c[i] as number) - lo < MIN_LOW_INTERVAL) return false;
  }
  return true;
}

/**
 * Voice-leading distance between two sorted voicings: total semitones moved
 * when every voice of each is matched, in order, to at least one voice of the
 * other (so voices may double or merge when the sizes differ). This is
 * dynamic time warping on the sorted notes.
 */
export function motion(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  let row = new Float64Array(m);
  let next = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const d = Math.abs((a[i] as number) - (b[j] as number));
      let best: number;
      if (i === 0 && j === 0) best = 0;
      else if (i === 0) best = next[j - 1] as number;
      else if (j === 0) best = row[j] as number;
      else best = Math.min(row[j - 1] as number, row[j] as number, next[j - 1] as number);
      next[j] = d + best;
    }
    [row, next] = [next, row];
  }
  return row[m - 1] as number;
}

/** First chord: compact and centered near middle C. */
function homeCost(c: readonly number[]): number {
  let sum = 0;
  for (const n of c) sum += n;
  const span = (c[c.length - 1] as number) - (c[0] as number);
  return Math.abs(sum / c.length - HOME_UPPER) + span / 4;
}

function voiceBass(pc: PC, prev: number | null, below: number, range: [number, number]): number | null {
  const target = prev ?? HOME_BASS;
  let best: number | null = null;
  for (let n = range[0]; n <= range[1] && n < below; n++) {
    if (n % 12 !== pc) continue;
    // Nearest the previous bass; ties go down.
    if (best === null || Math.abs(n - target) < Math.abs(best - target)) best = n;
  }
  return best;
}
