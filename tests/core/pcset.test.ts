import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  AGGREGATE,
  EMPTY,
  add,
  complement,
  difference,
  fromPcs,
  has,
  intersect,
  invert,
  isSubset,
  popcount,
  remove,
  toPcs,
  toVector,
  toggle,
  transpose,
  union,
} from '../../src/core/pcset';

const pcSet = fc.integer({ min: 0, max: AGGREGATE });
const pcList = fc.array(fc.integer({ min: 0, max: 11 }));
const reference = (set: number) => new Set(toPcs(set));

describe('pcset', () => {
  it('round-trips through member lists', () => {
    fc.assert(fc.property(pcSet, (s) => fromPcs(toPcs(s)) === s));
    expect(toPcs(fromPcs([7, 0, 4, 12, -1]))).toEqual([0, 4, 7, 11]);
  });

  it('matches a Set<number> reference for set operations', () => {
    fc.assert(
      fc.property(pcList, pcList, (xs, ys) => {
        const a = fromPcs(xs);
        const b = fromPcs(ys);
        const ra = new Set(xs);
        const rb = new Set(ys);
        expect(reference(union(a, b))).toEqual(new Set([...ra, ...rb]));
        expect(reference(intersect(a, b))).toEqual(new Set([...ra].filter((p) => rb.has(p))));
        expect(reference(difference(a, b))).toEqual(new Set([...ra].filter((p) => !rb.has(p))));
        expect(popcount(a)).toBe(ra.size);
        expect(isSubset(intersect(a, b), a)).toBe(true);
      }),
    );
  });

  it('adds, removes and toggles single members', () => {
    fc.assert(
      fc.property(pcSet, fc.integer({ min: 0, max: 11 }), (s, p) => {
        expect(has(add(s, p), p)).toBe(true);
        expect(has(remove(s, p), p)).toBe(false);
        expect(toggle(toggle(s, p), p)).toBe(s);
      }),
    );
  });

  it('complements within 12 bits', () => {
    expect(complement(EMPTY)).toBe(AGGREGATE);
    fc.assert(fc.property(pcSet, (s) => union(s, complement(s)) === AGGREGATE && intersect(s, complement(s)) === 0));
  });

  it('transposes as a 12-bit rotate', () => {
    const cMajor = fromPcs([0, 4, 7]);
    expect(toPcs(transpose(cMajor, 2))).toEqual([2, 6, 9]);
    expect(toPcs(transpose(cMajor, -1))).toEqual([3, 6, 11]);
    expect(toPcs(transpose(fromPcs([11]), 1))).toEqual([0]);
  });

  it('transposition: T12 = identity, preserves size, T−n undoes Tn', () => {
    fc.assert(
      fc.property(pcSet, fc.integer({ min: -30, max: 30 }), (s, n) => {
        expect(transpose(s, 12)).toBe(s);
        expect(popcount(transpose(s, n))).toBe(popcount(s));
        expect(transpose(transpose(s, n), -n)).toBe(s);
        expect(transpose(s, n)).toBe(transpose(s, n + 12));
      }),
    );
  });

  it('inverts around an axis', () => {
    expect(toPcs(invert(fromPcs([0, 4, 7])))).toEqual([0, 5, 8]); // C major → F minor
    fc.assert(fc.property(pcSet, fc.integer({ min: 0, max: 11 }), (s, n) => invert(invert(s, n), n) === s));
  });

  it('writes a weight vector into a supplied buffer', () => {
    const out = new Float32Array(12).fill(9);
    const v = toVector(fromPcs([0, 4, 7]), out);
    expect(v).toBe(out);
    expect([...v]).toEqual([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]);
  });
});
