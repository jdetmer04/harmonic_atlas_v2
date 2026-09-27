import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fromPcs } from '../../src/core/pcset';
import {
  euclid,
  evenness,
  hitCount,
  isRotationOf,
  patternFromPcSet,
  patternFromString,
  patternToString,
  pcSetFromPattern,
  rotate,
} from '../../src/core/rhythm';
import { magnitudeAt } from '../../src/core/dft';

const E = (k: number, n: number) => patternToString(euclid(k, n));
const kn = fc.integer({ min: 1, max: 32 }).chain((n) => fc.tuple(fc.integer({ min: 0, max: n }), fc.constant(n)));

/** Every k-subset of n steps, as onset vectors. */
function* subsets(k: number, n: number, start = 0, chosen: number[] = []): Generator<number[]> {
  if (chosen.length === k) {
    const v = new Array<number>(n).fill(0);
    for (const i of chosen) v[i] = 1;
    yield v;
    return;
  }
  for (let i = start; i <= n - (k - chosen.length); i++) yield* subsets(k, n, i + 1, [...chosen, i]);
}

describe('rhythm', () => {
  it('fixture: E(3,8) = x..x..x., E(5,8) = x.xx.xx., E(7,12) = x.xx.x.xx.x.', () => {
    expect(E(3, 8)).toBe('x..x..x.');
    expect(E(5, 8)).toBe('x.xx.xx.');
    expect(E(7, 12)).toBe('x.xx.x.xx.x.');
  });

  it("other presets match Toussaint's table up to rotation", () => {
    const table: [number, number, string][] = [
      [5, 12, 'x..x.x..x.x.'],
      [5, 16, 'x..x..x..x..x...'],
      [4, 9, 'x.x.x.x..'],
      [7, 16, 'x..x.x.x..x.x.x.'],
    ];
    for (const [k, n, s] of table) expect(isRotationOf(euclid(k, n), patternFromString(s))).toBe(true);
  });

  it('fixture: E(k, n) has k hits in n steps', () => {
    fc.assert(
      fc.property(kn, ([k, n]) => {
        const p = euclid(k, n);
        expect(p).toHaveLength(n);
        expect(hitCount(p)).toBe(k);
      }),
    );
  });

  it('rejects impossible k and n', () => {
    expect(() => euclid(5, 4)).toThrow(RangeError);
    expect(() => euclid(-1, 4)).toThrow(RangeError);
    expect(() => euclid(1, 0)).toThrow(RangeError);
    expect(() => euclid(1.5, 4)).toThrow(RangeError);
  });

  it('rotation: +r moves hits later, r = n is identity, −r undoes +r', () => {
    expect(patternToString(rotate(euclid(3, 8), 1))).toBe('.x..x..x');
    fc.assert(
      fc.property(kn, fc.integer({ min: -40, max: 40 }), ([k, n], r) => {
        const p = euclid(k, n);
        expect(rotate(p, n)).toEqual(p);
        expect(rotate(rotate(p, r), -r)).toEqual(p);
      }),
    );
  });

  it('evenness is 1 exactly when k divides n', () => {
    fc.assert(
      fc.property(kn, ([k, n]) => {
        fc.pre(k > 0);
        const e = evenness(euclid(k, n));
        if (n % k === 0) expect(e).toBeCloseTo(1, 9);
        else expect(e).toBeLessThan(1 - 1e-9);
      }),
    );
    expect(evenness(euclid(0, 8))).toBe(0);
  });

  it('fixture: Euclidean patterns maximize |F_k| (brute force, n ≤ 14)', () => {
    for (let n = 2; n <= 14; n++) {
      for (let k = 1; k < n; k++) {
        const euclidMag = magnitudeAt(euclid(k, n).map(Number), k);
        let best = 0;
        for (const v of subsets(k, n)) best = Math.max(best, magnitudeAt(v, k));
        expect(euclidMag, `E(${k},${n})`).toBeCloseTo(best, 9);
      }
    }
  });

  it('bridge: C major is the 12/8 bell pattern, a rotation of E(7,12), and converts back', () => {
    const cMajor = fromPcs([0, 2, 4, 5, 7, 9, 11]);
    const bell = patternFromPcSet(cMajor, 0);
    expect(patternToString(bell)).toBe('x.x.xx.x.x.x');
    expect(isRotationOf(bell, euclid(7, 12))).toBe(true);
    expect(pcSetFromPattern(bell, 0)).toBe(cMajor);
  });

  it('bridge: E(5,12) is a pentatonic, and start picks step 0', () => {
    const penta = pcSetFromPattern(euclid(5, 12), 0);
    // x..x.x..x.x. → C Eb F Ab Bb, the C minor pentatonic.
    expect(penta).toBe(fromPcs([0, 3, 5, 8, 10]));
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xfff }), fc.integer({ min: 0, max: 11 }), (s, start) => {
        expect(pcSetFromPattern(patternFromPcSet(s, start as 0), start as 0)).toBe(s);
      }),
    );
  });
});
