import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fromPcs, toPcs, type PC } from '../../src/core/pcset';
import { autoVoice, BASS_RANGE, closeVoicing, motion, UPPER_RANGE, VOICING_MODES } from '../../src/core/voicing';

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

const setArb = (max: number) =>
  fc.uniqueArray(fc.integer({ min: 0, max: 11 }), { minLength: 1, maxLength: max }).map((xs) => fromPcs(xs));
const pcArb = fc.integer({ min: 0, max: 11 }).map((p) => p as PC);
const modeArb = fc.constantFrom(...VOICING_MODES);

/** Independent brute force: every placement in range, ranked by the same DTW motion (re-derived here). */
function bruteMotion(a: readonly number[], b: readonly number[]): number {
  const memo = new Map<string, number>();
  const go = (i: number, j: number): number => {
    const k = `${i},${j}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const d = Math.abs((a[i] as number) - (b[j] as number));
    let r: number;
    if (i === 0 && j === 0) r = d;
    else if (i === 0) r = d + go(0, j - 1);
    else if (j === 0) r = d + go(i - 1, 0);
    else r = d + Math.min(go(i - 1, j - 1), go(i - 1, j), go(i, j - 1));
    memo.set(k, r);
    return r;
  };
  return go(a.length - 1, b.length - 1);
}

function allPlacements(set: number): number[][] {
  let out: number[][] = [[]];
  for (const pc of toPcs(set)) {
    const copies: number[] = [];
    for (let n = 48; n <= 72; n++) if (n % 12 === pc) copies.push(n);
    out = out.flatMap((v) => copies.map((n) => [...v, n]));
  }
  return out.map((v) => v.sort((x, y) => x - y));
}

const muddy = (v: readonly number[]) => v.some((n, i) => i > 0 && (v[i - 1] as number) < 52 && n - (v[i - 1] as number) < 3);

describe('autoVoice', () => {
  it('voices a first C major chord in the middle, bass on its own', () => {
    expect(autoVoice(fromPcs([0, 4, 7]), { bass: 0, prev: null })).toEqual([36, 60, 64, 67]);
  });

  it('leads ii–V–I smoothly: common tones hold, the rest step', () => {
    const dm7 = autoVoice(fromPcs([2, 5, 9, 0]), { bass: 2, prev: null });
    const g7 = autoVoice(fromPcs([7, 11, 2, 5]), { bass: 7, prev: dm7 });
    const c = autoVoice(fromPcs([0, 4, 7, 11]), { bass: 0, prev: g7 });
    const up = (v: number[]) => v.slice(1);
    expect(motion(up(dm7), up(g7))).toBeLessThanOrEqual(3);
    expect(motion(up(g7), up(c))).toBeLessThanOrEqual(3);
  });

  it('stays in range', () => {
    fc.assert(
      fc.property(setArb(7), pcArb, fc.option(setArb(5)), modeArb, (set, bass, prevSet, mode) => {
        const prev = prevSet === null ? null : autoVoice(prevSet, { bass: toPcs(prevSet)[0] as PC, prev: null, mode });
        const v = autoVoice(set, { bass, prev, mode });
        const [b, ...upper] = v;
        expect(b).toBeGreaterThanOrEqual(BASS_RANGE[0]);
        expect(b).toBeLessThanOrEqual(BASS_RANGE[1]);
        expect((b as number) % 12).toBe(bass);
        for (const n of upper) {
          expect(n).toBeGreaterThanOrEqual(UPPER_RANGE[0]);
          expect(n).toBeLessThanOrEqual(UPPER_RANGE[1]);
          expect(n).toBeGreaterThan(b as number);
        }
        expect(fromPcs(upper)).toBe(set);
        expect(upper).toHaveLength(toPcs(set).length);
      }),
    );
  });

  it('never moves a repeated chord', () => {
    fc.assert(
      fc.property(setArb(6), setArb(6), pcArb, modeArb, (first, set, bass, mode) => {
        const before = autoVoice(first, { bass: toPcs(first)[0] as PC, prev: null, mode });
        const v = autoVoice(set, { bass, prev: before, mode });
        expect(autoVoice(set, { bass, prev: v, mode })).toEqual(v);
      }),
    );
  });

  it('smooth mode moves least, against brute force', () => {
    fc.assert(
      fc.property(setArb(5), setArb(5), (prevSet, set) => {
        const prev = autoVoice(prevSet, { bass: toPcs(prevSet)[0] as PC, prev: null });
        const v = autoVoice(set, { bass: toPcs(set)[0] as PC, prev });
        const pool = allPlacements(set).filter((c) => !muddy(c));
        const best = Math.min(...(pool.length ? pool : allPlacements(set)).map((c) => bruteMotion(prev.slice(1), c)));
        expect(motion(prev.slice(1), v.slice(1))).toBe(best);
        expect(bruteMotion(prev.slice(1), v.slice(1))).toBe(best);
      }),
    );
  });

  it('avoids mud below E3 when it can', () => {
    fc.assert(
      fc.property(setArb(5), setArb(5), (prevSet, set) => {
        const prev = autoVoice(prevSet, { bass: 0, prev: null });
        expect(muddy(autoVoice(set, { bass: 0, prev }).slice(1))).toBe(false);
      }),
    );
  });

  it('modes give their shapes', () => {
    const cmaj7 = fromPcs([0, 4, 7, 11]);
    const span = (v: number[]) => (v[v.length - 1] as number) - (v[1] as number);
    expect(span(autoVoice(cmaj7, { bass: 0, prev: null, mode: 'close' }))).toBeLessThan(12);
    const drop2 = autoVoice(cmaj7, { bass: 0, prev: null, mode: 'drop2' }).slice(1);
    expect(drop2.map((n) => n % 12)).toEqual([7, 0, 4, 11]); // G below C E B: 2nd from top of C E G B dropped
    const spread = autoVoice(cmaj7, { bass: 0, prev: null, mode: 'spread' }).slice(1);
    expect(spread.every((n, i) => i === 0 || n - (spread[i - 1] as number) >= 3)).toBe(true);
    expect(span([0, ...spread])).toBeGreaterThanOrEqual(12);
  });

  it('puts the bass nearest the previous bass', () => {
    const c = autoVoice(fromPcs([0, 4, 7]), { bass: 0, prev: null });
    const g = autoVoice(fromPcs([7, 11, 2]), { bass: 7, prev: c });
    expect(g[0]).toBe(31); // G1, five below C2 rather than seven above
  });
});

describe('motion', () => {
  it('is zero only for identical voicings and symmetric', () => {
    expect(motion([60, 64, 67], [60, 64, 67])).toBe(0);
    expect(motion([60, 64, 67], [60, 65, 69])).toBe(3);
    // Doubling: three voices into two
    expect(motion([60, 64, 67], [60, 67])).toBe(3);
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 40, max: 80 }), { minLength: 1, maxLength: 5 }), fc.array(fc.integer({ min: 40, max: 80 }), { minLength: 1, maxLength: 5 }), (a, b) => {
        const sa = a.sort((x, y) => x - y);
        const sb = b.sort((x, y) => x - y);
        expect(motion(sa, sb)).toBe(motion(sb, sa));
        expect(motion(sa, sb)).toBe(bruteMotion(sa, sb));
      }),
    );
  });
});
