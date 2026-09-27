// Discrete Fourier transform of a weight vector over Z_n.
//
//   F_k = Σ_p w_p · e^(−2πi·k·p/n)
//
// For n = 12 over pitch classes, |F_k| / F_0 reads the kind of collection and
// arg F_5 lands on the circle of fifths. For n = step count over a rhythm's
// onsets, it measures evenness. Input is real, so F_(n−k) mirrors F_k and only
// k = 0..⌊n/2⌋ are stored.

import { mod } from './pcset';

const TWO_PI = 2 * Math.PI;

/** cos/sin of 2π·j/n for j = 0..n−1, cached per n. */
const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function twiddlesFor(n: number) {
  let t = twiddles.get(n);
  if (!t) {
    t = { cos: new Float64Array(n), sin: new Float64Array(n) };
    for (let j = 0; j < n; j++) {
      t.cos[j] = Math.cos((TWO_PI * j) / n);
      t.sin[j] = Math.sin((TWO_PI * j) / n);
    }
    twiddles.set(n, t);
  }
  return t;
}

/** Length of the output buffer `dft` needs for an n-point input. */
export function dftSize(n: number): number {
  return 2 * (Math.floor(n / 2) + 1);
}

/**
 * Transform `input` (n = input.length) into `out`, interleaved as
 * [re_0, im_0, re_1, im_1, …] for k = 0..⌊n/2⌋. Allocates nothing once the
 * twiddle table for n exists, so it is safe to call every frame.
 */
export function dft(input: ArrayLike<number>, out: Float64Array): Float64Array {
  const n = input.length;
  const kMax = Math.floor(n / 2);
  if (out.length < 2 * (kMax + 1)) throw new RangeError(`dft: out needs length ${dftSize(n)}`);
  const { cos, sin } = twiddlesFor(n);
  for (let k = 0; k <= kMax; k++) {
    let re = 0;
    let im = 0;
    for (let p = 0; p < n; p++) {
      const w = input[p] as number;
      if (w === 0) continue;
      const j = (k * p) % n;
      re += w * (cos[j] as number);
      im -= w * (sin[j] as number);
    }
    out[2 * k] = re;
    out[2 * k + 1] = im;
  }
  return out;
}

export function magnitude(spectrum: Float64Array, k: number): number {
  return Math.hypot(spectrum[2 * k] as number, spectrum[2 * k + 1] as number);
}

/** |F_k| / F_0, in [0, 1] for non-negative weights; 0 when there is no weight. */
export function normMagnitude(spectrum: Float64Array, k: number): number {
  const f0 = spectrum[0] as number;
  return f0 > 0 ? magnitude(spectrum, k) / f0 : 0;
}

/** arg F_k in radians, (−π, π]. */
export function phase(spectrum: Float64Array, k: number): number {
  return Math.atan2(spectrum[2 * k + 1] as number, spectrum[2 * k] as number);
}

/**
 * arg F_5 of a 12-point spectrum as a circle-of-fifths position in [0, 12):
 * C = 0, G = 1, D = 2 … A single pitch class p lands exactly on 7p mod 12.
 * Draw position q at q·30° clockwise from the top.
 */
export function fifthsPosition(spectrum: Float64Array): number {
  return mod((phase(spectrum, 5) * 12) / TWO_PI, 12);
}

/** |F_k| for any k (including k > n/2) straight from the input, without allocating. */
export function magnitudeAt(input: ArrayLike<number>, k: number): number {
  const n = input.length;
  const { cos, sin } = twiddlesFor(n);
  const kk = mod(k, n);
  let re = 0;
  let im = 0;
  for (let p = 0; p < n; p++) {
    const w = input[p] as number;
    if (w === 0) continue;
    const j = (kk * p) % n;
    re += w * (cos[j] as number);
    im -= w * (sin[j] as number);
  }
  return Math.hypot(re, im);
}
