import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AGGREGATE, fromPcs, toVector } from '../../src/core/pcset';
import { dft, dftSize, fifthsPosition, magnitude, magnitudeAt, normMagnitude, phase } from '../../src/core/dft';

const spectrumOf = (pcs: number[]) => dft(toVector(fromPcs(pcs)), new Float64Array(dftSize(12)));
const mags = (pcs: number[]) => [1, 2, 3, 4, 5, 6].map((k) => normMagnitude(spectrumOf(pcs), k));
const weights = fc.array(fc.double({ min: 0, max: 10, noNaN: true }), { minLength: 12, maxLength: 12 });

/** Distance between two positions on a 12-cycle. */
const cyclicGap = (x: number, y: number) => {
  const d = Math.abs(x - y) % 12;
  return Math.min(d, 12 - d);
};

describe('dft', () => {
  it('fixture: a single note has |F_k| = 1 for all k', () => {
    for (let p = 0; p < 12; p++) for (const m of mags([p])) expect(m).toBeCloseTo(1, 12);
  });

  it('fixture: the aggregate has |F_k| = 0 for k ≥ 1', () => {
    const s = dft(toVector(AGGREGATE), new Float64Array(dftSize(12)));
    expect(s[0]).toBe(12);
    for (let k = 1; k <= 6; k++) expect(normMagnitude(s, k)).toBeCloseTo(0, 12);
  });

  it('fixture: augmented |F3| = 1, dim7 |F4| = 1', () => {
    expect(mags([0, 4, 8])[2]).toBeCloseTo(1, 12);
    expect(mags([0, 3, 6, 9])[3]).toBeCloseTo(1, 12);
  });

  it('tritone |F2| = 1, whole-tone |F6| = 1, diatonic |F5| ≈ 0.53', () => {
    expect(mags([0, 6])[1]).toBeCloseTo(1, 12);
    expect(mags([0, 2, 4, 6, 8, 10])[5]).toBeCloseTo(1, 12);
    expect(mags([0, 2, 4, 5, 7, 9, 11])[4]).toBeCloseTo((2 + Math.sqrt(3)) / 7, 12);
  });

  it('fixture: magnitudes are unchanged by transposition', () => {
    fc.assert(
      fc.property(weights, fc.integer({ min: 1, max: 11 }), (w, n) => {
        const rotated = w.map((_, p) => w[(p - n + 12) % 12] as number);
        const a = dft(w, new Float64Array(dftSize(12)));
        const b = dft(rotated, new Float64Array(dftSize(12)));
        for (let k = 0; k <= 6; k++) expect(magnitude(b, k)).toBeCloseTo(magnitude(a, k), 9);
      }),
    );
  });

  it('calibration: a single pitch class p sits at fifths position 7p mod 12', () => {
    for (let p = 0; p < 12; p++) expect(cyclicGap(fifthsPosition(spectrumOf([p])), (7 * p) % 12)).toBeCloseTo(0, 9);
  });

  it('fixture: C major scale phase lands on D; C triad at 1.5, A minor at 2.5', () => {
    expect(cyclicGap(fifthsPosition(spectrumOf([0, 2, 4, 5, 7, 9, 11])), 2)).toBeCloseTo(0, 9);
    expect(cyclicGap(fifthsPosition(spectrumOf([0, 4, 7])), 1.5)).toBeCloseTo(0, 9);
    expect(cyclicGap(fifthsPosition(spectrumOf([9, 0, 4])), 2.5)).toBeCloseTo(0, 9);
  });

  it('transposing by n moves the fifths position by 7n', () => {
    fc.assert(
      fc.property(weights, fc.integer({ min: 1, max: 11 }), (w, n) => {
        const a = dft(w, new Float64Array(dftSize(12)));
        fc.pre(normMagnitude(a, 5) > 1e-3);
        const rotated = w.map((_, p) => w[(p - n + 12) % 12] as number);
        const b = dft(rotated, new Float64Array(dftSize(12)));
        expect(cyclicGap(fifthsPosition(b), fifthsPosition(a) + 7 * n)).toBeCloseTo(0, 6);
      }),
    );
  });

  it('works for any n and matches the direct per-k magnitude', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 5, noNaN: true }), { minLength: 1, maxLength: 32 }), (w) => {
        const s = dft(w, new Float64Array(dftSize(w.length)));
        for (let k = 0; k <= Math.floor(w.length / 2); k++) {
          expect(magnitudeAt(w, k)).toBeCloseTo(magnitude(s, k), 9);
          // Real input: F_(n−k) mirrors F_k.
          expect(magnitudeAt(w, w.length - k)).toBeCloseTo(magnitude(s, k), 9);
        }
      }),
    );
  });

  it('reuses the output buffer and rejects one that is too small', () => {
    const out = new Float64Array(dftSize(12));
    expect(dft(toVector(fromPcs([0])), out)).toBe(out);
    expect(phase(out, 0)).toBe(0);
    expect(() => dft(new Float32Array(12), new Float64Array(4))).toThrow(RangeError);
  });

  it('reports 0 normalized magnitude for silence', () => {
    const s = dft(new Float32Array(12), new Float64Array(dftSize(12)));
    for (let k = 0; k <= 6; k++) expect(normMagnitude(s, k)).toBe(0);
  });
});
