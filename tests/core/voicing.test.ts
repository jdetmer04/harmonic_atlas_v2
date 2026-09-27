import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fromPcs, toPcs, type PC } from '../../src/core/pcset';
import { closeVoicing } from '../../src/core/voicing';

describe('closeVoicing (M1 audition voicing)', () => {
  it('voices C major as C2 + A3–G#4 stack', () => {
    expect(closeVoicing(fromPcs([0, 4, 7]))).toEqual([36, 60, 64, 67]);
  });

  it('uses the triad root, then an explicit bass', () => {
    expect(closeVoicing(fromPcs([9, 0, 4]))[0]).toBe(36 + 9);
    expect(closeVoicing(fromPcs([0, 4, 7]), 4)[0]).toBe(40);
  });

  it('stays in range and covers exactly the set', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0xfff }), (set) => {
        const v = closeVoicing(set);
        const [bass, ...upper] = v;
        expect(bass).toBeGreaterThanOrEqual(36);
        expect(bass).toBeLessThanOrEqual(47);
        for (const n of upper) {
          expect(n).toBeGreaterThanOrEqual(57);
          expect(n).toBeLessThanOrEqual(68);
        }
        expect(fromPcs(upper)).toBe(set);
        expect(toPcs(set)).toContain(((bass as number) % 12) as PC);
      }),
    );
  });

  it('is empty for the empty set', () => {
    expect(closeVoicing(0)).toEqual([]);
  });
});
