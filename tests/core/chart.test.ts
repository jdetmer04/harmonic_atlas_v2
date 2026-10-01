import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  barBeats,
  bassOf,
  chordSymbol,
  chordText,
  leadingComments,
  parseChart,
  parseChordToken,
  parseSymbol,
  printChart,
  type Meter,
  type PrintableChord,
} from '../../src/core/chart';
import { fromPcs, type PC } from '../../src/core/pcset';
import { must } from '../must';

const SPEC_CHART = `@tempo 96
@meter 4/4
# Porter-ish lift, then a hexatonic detour
| Dm7 G7 | Cmaj7 . | Ebmaj7 Ab7 | Dbmaj7 |
| C >P >L >P | [0 4 7 11] | {C E G B} | _ |
| C/E . F G | % |
`;

const brief = (cs: ReturnType<typeof parseChart>['chords']) =>
  cs.map((c) => [c.label, c.start, c.dur, c.pcs, c.bass ?? null]);

describe('parseSymbol (tonal)', () => {
  it('splits slash chords into harmony and bass', () => {
    expect(parseSymbol('Dm7/G')).toEqual({ pcs: fromPcs([2, 5, 9, 0]), bass: 7 });
    expect(parseSymbol('C/E')).toEqual({ pcs: fromPcs([0, 4, 7]), bass: 4 });
  });

  it('accepts ^7 as maj7, and ø', () => {
    expect(parseSymbol('C^7')).toEqual(parseSymbol('Cmaj7'));
    expect(parseSymbol('Bø7')).toEqual(parseSymbol('Bm7b5'));
  });

  it('keeps 6/9 as a chord, not a slash', () => {
    expect(parseSymbol('C6/9')).toEqual({ pcs: fromPcs([0, 4, 7, 9, 2]) });
  });

  it('rejects non-chords', () => {
    expect(parseSymbol('Xyz')).toBeNull();
    expect(parseSymbol('C/Q')).toBeNull();
  });
});

describe('bassOf', () => {
  it('takes the slash bass, then the symbol root, then a triad root, then the lowest note', () => {
    expect(bassOf({ pcs: fromPcs([0, 4, 7]), bass: 4 })).toBe(4);
    expect(bassOf({ pcs: fromPcs([9, 0, 4, 7]), label: 'Am7' })).toBe(9);
    expect(bassOf({ pcs: fromPcs([9, 0, 4, 7]), label: 'C6' })).toBe(0);
    expect(bassOf({ pcs: fromPcs([9, 0, 4]) })).toBe(9);
    expect(bassOf({ pcs: fromPcs([2, 3, 4]) })).toBe(2);
    // A stale label whose root is no longer in the chord is ignored.
    expect(bassOf({ pcs: fromPcs([1, 5, 8]), label: 'G' })).toBe(1);
  });
});

describe('parseChordToken', () => {
  it('reads raw pitch classes and note names, with optional bass', () => {
    expect(parseChordToken('[0 4 7 11]')).toEqual({ pcs: fromPcs([0, 4, 7, 11]) });
    expect(parseChordToken('[0 4 t e]')).toEqual({ pcs: fromPcs([0, 4, 10, 11]) });
    expect(parseChordToken('{C E G B}')).toEqual({ pcs: fromPcs([0, 4, 7, 11]) });
    expect(parseChordToken('{C E G}/E')).toEqual({ pcs: fromPcs([0, 4, 7]), bass: 4 });
    expect(parseChordToken('[0 4 7]/4')).toEqual({ pcs: fromPcs([0, 4, 7]), bass: 4 });
    expect(parseChordToken('[0 12]')).toBeNull();
    expect(parseChordToken('{C H}')).toBeNull();
  });
});

describe('parseChart', () => {
  it('reads the spec example', () => {
    const p = parseChart(SPEC_CHART);
    expect(p.errors).toEqual([]);
    expect(p.tempo).toBe(96);
    expect(p.meter).toEqual([4, 4]);
    expect(p.bars).toBe(10);
    const maj = (r: number) => fromPcs([r, r + 4, r + 7]);
    const min = (r: number) => fromPcs([r, r + 3, r + 7]);
    expect(brief(p.chords)).toEqual([
      ['Dm7', 0, 2, fromPcs([2, 5, 9, 0]), null],
      ['G7', 2, 2, fromPcs([7, 11, 2, 5]), null],
      ['Cmaj7', 4, 4, fromPcs([0, 4, 7, 11]), null],
      ['Ebmaj7', 8, 2, fromPcs([3, 7, 10, 2]), null],
      ['Ab7', 10, 2, fromPcs([8, 0, 3, 6]), null],
      ['Dbmaj7', 12, 4, fromPcs([1, 5, 8, 0]), null],
      ['C', 16, 1, maj(0), null],
      ['Cm', 17, 1, min(0), null],
      ['Ab', 18, 1, maj(8), null],
      ['Abm', 19, 1, min(8), null],
      ['[0 4 7 11]', 20, 4, fromPcs([0, 4, 7, 11]), null],
      ['{C E G B}', 24, 4, fromPcs([0, 4, 7, 11]), null],
      // bar 8 is a rest
      ['C/E', 32, 2, maj(0), 4],
      ['F', 34, 1, maj(5), null],
      ['G', 35, 1, maj(7), null],
      ['C/E', 36, 2, maj(0), 4],
      ['F', 38, 1, maj(5), null],
      ['G', 39, 1, maj(7), null],
    ]);
    expect(p.chords.filter((c) => c.origin === 'operator').map((c) => c.label)).toEqual(['Cm', 'Ab', 'Abm']);
  });

  it('holds across bar lines and repeats chords as new attacks', () => {
    const p = parseChart('| C | . | C C |');
    expect(brief(p.chords).map(([, s, d]) => [s, d])).toEqual([
      [0, 8],
      [8, 2],
      [10, 2],
    ]);
  });

  it('uses the meter for bar length (beats are quarter notes)', () => {
    expect(barBeats([6, 8])).toBe(3);
    const p = parseChart('@meter 3/4\n| C G | F |');
    expect(brief(p.chords).map(([, s, d]) => [s, d])).toEqual([
      [0, 1.5],
      [1.5, 1.5],
      [3, 3],
    ]);
  });

  it('ignores # inside chord names but not at a token start', () => {
    const p = parseChart('| F#m C# | # a comment\n| G |');
    expect(p.errors).toEqual([]);
    expect(p.chords.map((c) => c.label)).toEqual(['F#m', 'C#', 'G']);
  });

  it('points errors at the offending token', () => {
    const text = '| C Xyz G |';
    const p = parseChart(text);
    expect(p.errors).toHaveLength(1);
    const e = must(p.errors[0]);
    expect(text.slice(e.from, e.to)).toBe('Xyz');
    // The bad token keeps its slot so timing doesn't shift.
    expect(brief(p.chords).map(([l, s]) => [l, s])).toEqual([
      ['C', 0],
      ['G', 4 * (2 / 3)],
    ]);
  });

  it.each([
    ['| . C |', '.', 'Nothing to hold'],
    ['| Cmaj7 >P |', '>P', 'triad'],
    ['| C >Q |', '>Q', 'operator'],
    ['| % |', '%', 'previous bar'],
    ['| C | % D |', '%', 'fill the bar'],
    ['@tempo fast\n| C |', '@tempo fast', 'Tempo'],
    ['@meter 4/5\n| C |', '@meter 4/5', 'Meter'],
    ['@key C\n| C |', '@key C', 'Unknown directive'],
  ])('%s → error at %s', (text, token, message) => {
    const p = parseChart(text);
    expect(p.errors.length).toBeGreaterThan(0);
    const e = must(p.errors[0]);
    expect(text.slice(e.from, e.to).startsWith(token)).toBe(true);
    expect(e.message).toContain(message);
  });

  it('flags an unclosed bracket up to the bar line', () => {
    const text = '| [0 4 7 | G |';
    const e = must(parseChart(text).errors[0]);
    expect(text.slice(e.from, e.to)).toBe('[0 4 7 ');
  });

  it('records the source span of each chord', () => {
    const text = '| Dm7 G7 |';
    const [a, b] = parseChart(text).chords.map((c) => text.slice(c.from, c.to));
    expect([a, b]).toEqual(['Dm7', 'G7']);
  });
});

describe('printChart', () => {
  it('writes the canonical form of the spec example', () => {
    const p = parseChart(SPEC_CHART);
    const text = printChart({ tempo: 96, meter: [4, 4], chords: p.chords, header: leadingComments(SPEC_CHART) });
    expect(text).toBe(
      [
        '# Porter-ish lift, then a hexatonic detour',
        '@tempo 96',
        '@meter 4/4',
        '| Dm7 G7 | Cmaj7 | Ebmaj7 Ab7 | Dbmaj7 |',
        '| C Cm Ab Abm | [0 4 7 11] | {C E G B} | _ |',
        '| C/E . F G | C/E . F G |',
        '',
      ].join('\n'),
    );
  });

  it('prints the coarsest even split', () => {
    const chords: PrintableChord[] = [
      { start: 0, dur: 3, pcs: fromPcs([0, 4, 7]) },
      { start: 3, dur: 1, pcs: fromPcs([5, 9, 0]) },
      { start: 4, dur: 6, pcs: fromPcs([7, 11, 2]) },
      { start: 11, dur: 1, pcs: fromPcs([0, 4, 7]) },
    ];
    expect(printChart({ tempo: 120, meter: [4, 4], chords }).split('\n')[2]).toBe('| C . . F | G | . . _ C |');
  });

  it('names unlabeled chords, falling back to note names', () => {
    expect(chordText({ pcs: fromPcs([9, 0, 4, 7]) })).toBe('Am7');
    expect(chordText({ pcs: fromPcs([0, 4, 7]), bass: 4 })).toBe('C/E');
    expect(chordText({ pcs: fromPcs([0, 1, 2]) })).toBe('{C Db D}');
    expect(chordText({ pcs: fromPcs([0, 1, 2]), bass: 7 })).toBe('{C Db D}/G');
    // A stale label (harmony since changed) is not reused.
    expect(chordText({ pcs: fromPcs([0, 3, 7]), label: 'C' })).toBe('Cm');
    expect(chordSymbol(fromPcs([0, 4, 7, 10]))).toBe('C7');
  });

  it('keeps only the leading comment block', () => {
    expect(leadingComments('# one\n\n# two\n@tempo 90\n| C | # not this\n# nor this')).toEqual(['# one', '# two']);
  });
});

// Random sketches laid on an even grid within each bar, so any of them can be
// written as a chart.
const METERS: Meter[] = [
  [4, 4],
  [3, 4],
  [6, 8],
  [5, 4],
  [7, 8],
];
const SYMBOLS = ['Dm7', 'G7', 'C^7', 'Bbsus4', 'F#m7b5', 'Eb/G', 'Ab7/Gb', '[0 1 6]', '{C E G#}', 'C6/9'];

const slotArb: fc.Arbitrary<GenSlot> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('chord' as const), pcs: fc.integer({ min: 1, max: 0xfff }), bass: fc.option(fc.integer({ min: 0, max: 11 }), { nil: undefined }), label: fc.option(fc.constantFrom(...SYMBOLS), { nil: undefined }) }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'hold' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'rest' as const }) },
);
const barArb = fc.constantFrom(1, 2, 3, 4, 6, 8).chain((n) => fc.array(slotArb, { minLength: n, maxLength: n }));
const sketchArb = fc.record({
  tempo: fc.integer({ min: 40, max: 240 }),
  meter: fc.constantFrom(...METERS),
  bars: fc.array(barArb, { minLength: 0, maxLength: 12 }),
});

type GenSlot =
  | { kind: 'chord'; pcs: number; bass: number | undefined; label: string | undefined }
  | { kind: 'hold' }
  | { kind: 'rest' };

function layOut(s: { meter: Meter; bars: GenSlot[][] }) {
  const beats = barBeats(s.meter);
  const chords: PrintableChord[] = [];
  let holding: PrintableChord | null = null;
  s.bars.forEach((bar, i) => {
    bar.forEach((slot, j) => {
      const start = i * beats + (j * beats) / bar.length;
      const dur = beats / bar.length;
      if (slot.kind === 'chord') {
        const label = slot.label;
        const h = label ? must(parseChordToken(label)) : { pcs: slot.pcs, bass: slot.bass as PC | undefined };
        holding = { start, dur, pcs: h.pcs };
        if (h.bass !== undefined) holding.bass = h.bass;
        if (label) holding.label = label;
        chords.push(holding);
      } else if (slot.kind === 'hold' && holding) holding.dur = start + dur - holding.start;
      else holding = null;
    });
  });
  return chords;
}

const close = (x: number, y: number) => Math.abs(x - y) < 1e-6;

describe('chart round trip', () => {
  it('parse(print(sketch)) = sketch', () => {
    fc.assert(
      fc.property(sketchArb, (s) => {
        const chords = layOut(s);
        const text = printChart({ tempo: s.tempo, meter: s.meter, chords });
        const p = parseChart(text);
        expect(p.errors).toEqual([]);
        expect(p.tempo).toBe(s.tempo);
        expect(p.meter).toEqual(s.meter);
        expect(p.chords).toHaveLength(chords.length);
        p.chords.forEach((c, i) => {
          const want = must(chords[i]);
          expect(close(c.start, want.start) && close(c.dur, want.dur)).toBe(true);
          expect(c.pcs).toBe(want.pcs);
          expect(c.bass).toBe(want.bass);
          if (want.label) expect(c.label).toBe(want.label);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('printing is idempotent', () => {
    fc.assert(
      fc.property(sketchArb, (s) => {
        const once = printChart({ tempo: s.tempo, meter: s.meter, chords: layOut(s) });
        const p = parseChart(once);
        expect(printChart({ tempo: must(p.tempo), meter: must(p.meter), chords: p.chords })).toBe(once);
      }),
      { numRuns: 100 },
    );
  });
});

describe('performance', () => {
  it('re-parses a 64-bar chart in ≤ 5 ms', () => {
    const bar = ['| Dm7 G7 | C^7 . | Ebmaj7 Ab7/Gb | Dbmaj7 >P |', '| C >P >L >P | [0 4 7 11] | {C E G B} | F#m7b5 B7b9 |'];
    const text = `@tempo 120\n${Array.from({ length: 32 }, (_, i) => bar[i % 2]).join('\n')}\n`;
    expect(parseChart(text).bars).toBe(64 * 2);
    const sixtyFour = `@tempo 120\n${Array.from({ length: 16 }, (_, i) => bar[i % 2]).join('\n')}\n`;
    expect(parseChart(sixtyFour).bars).toBe(64);
    // Warm (the symbol cache is what makes per-keystroke parses cheap).
    for (let i = 0; i < 20; i++) parseChart(sixtyFour);
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      parseChart(sixtyFour + (i % 2 ? ' ' : ''));
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(5);
  });
});
