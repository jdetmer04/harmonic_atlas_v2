// Euclidean rhythms. A pattern is one boolean per step (true = hit).

import { magnitudeAt } from './dft';
import { fromPcs, has, mod, type PC, type PcSet } from './pcset';

export type Pattern = boolean[];

/**
 * E(k, n) by Bjorklund's algorithm: k hits spread as evenly as possible over n
 * steps. Rotation 0 is Bjorklund's own output, which matches Toussaint's table
 * (E(3,8) = x..x..x., E(5,8) = x.xx.xx.).
 */
export function euclid(k: number, n: number): Pattern {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`euclid: n must be a positive integer, got ${n}`);
  if (!Number.isInteger(k) || k < 0 || k > n) throw new RangeError(`euclid: k must be in 0..${n}, got ${k}`);
  if (k === 0) return new Array<boolean>(n).fill(false);

  // Start with k groups [x] and n−k groups [.], then repeatedly append one
  // remainder group to each leading group until at most one remainder is left.
  let groups: Pattern[] = Array.from({ length: k }, () => [true]);
  let rest: Pattern[] = Array.from({ length: n - k }, () => [false]);
  while (rest.length > 1) {
    const m = Math.min(groups.length, rest.length);
    const merged = groups.slice(0, m).map((g, i) => g.concat(rest[i] as Pattern));
    rest = groups.length > m ? groups.slice(m) : rest.slice(m);
    groups = merged;
  }
  return [...groups.flat(), ...rest.flat()];
}

/** Positive r moves every hit r steps later (clockwise on the necklace). */
export function rotate(p: Pattern, r: number): Pattern {
  const n = p.length;
  const out = new Array<boolean>(n);
  for (let i = 0; i < n; i++) out[mod(i + r, n)] = p[i] as boolean;
  return out;
}

export function isRotationOf(p: Pattern, q: Pattern): boolean {
  if (p.length !== q.length) return false;
  for (let r = 0; r < p.length; r++) if (patternEquals(rotate(p, r), q)) return true;
  return p.length === 0;
}

export function patternEquals(p: Pattern, q: Pattern): boolean {
  return p.length === q.length && p.every((v, i) => v === q[i]);
}

export function hitCount(p: Pattern): number {
  return p.reduce((n, hit) => n + (hit ? 1 : 0), 0);
}

export function onsets(p: Pattern): number[] {
  const out: number[] = [];
  p.forEach((hit, i) => {
    if (hit) out.push(i);
  });
  return out;
}

/** 'x..x..x.' */
export function patternToString(p: Pattern): string {
  return p.map((hit) => (hit ? 'x' : '.')).join('');
}

export function patternFromString(s: string): Pattern {
  return [...s].map((ch) => {
    if (ch === 'x' || ch === 'X') return true;
    if (ch === '.') return false;
    throw new Error(`Pattern characters are 'x' and '.', got "${ch}" in "${s}"`);
  });
}

/**
 * |F_k| / k of the onset vector, with k = number of hits and an n-point DFT.
 * 1.0 only when k divides n; Euclidean patterns maximize it. 0 for no hits.
 */
export function evenness(p: Pattern): number {
  const k = hitCount(p);
  if (k === 0) return 0;
  return magnitudeAt(p.map((hit) => (hit ? 1 : 0)), k) / k;
}

/** A pitch-class set as a 12-step pattern, with `start` on step 0. */
export function patternFromPcSet(set: PcSet, start: PC = 0): Pattern {
  return Array.from({ length: 12 }, (_, i) => has(set, start + i));
}

/** A 12-step pattern as a pitch-class set, with step 0 on `start`. */
export function pcSetFromPattern(p: Pattern, start: PC = 0): PcSet {
  if (p.length !== 12) throw new RangeError(`Only 12-step patterns map to pitch classes, got ${p.length}`);
  return fromPcs(onsets(p).map((i) => start + i));
}
