import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { triadPcs } from '../../src/core/ops';
import { fromPcs, type PC } from '../../src/core/pcset';
import { appendCurrent, moveInsert, selectChord, selectTriangle, setInsertIndex } from '../../src/state/actions';
import {
  appendChord,
  deleteChord,
  editChart,
  loadSketch,
  redo,
  renameSketch,
  setCamera,
  setLoop,
  setMeter,
  setPatch,
  setTempo,
  setVoicingMode,
  undo,
} from '../../src/state/commands';
import { reviveSketch } from '../../src/state/revive';
import { chordIndexAt, selectMoves, selectTrail, selectVoicings } from '../../src/state/selectors';
import { emptySketch, initialState, store, type Sketch } from '../../src/state/store';
import { must } from '../must';

const C = triadPcs({ root: 0, quality: 'maj' });
const F = triadPcs({ root: 5, quality: 'maj' });
const G = triadPcs({ root: 7, quality: 'maj' });
const Am = triadPcs({ root: 9, quality: 'min' });

const sk = () => store.getState().sketch;
const shape = () => sk().chords.map((c) => [c.pcs, c.start, c.dur]);
/** Everything undo restores: the sketch minus its view. */
const undoable = (s: Sketch) => ({ ...s, view: null });

let clock = 1_000_000;
beforeEach(() => {
  store.setState(initialState(undefined, emptySketch('test')), true);
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});
afterEach(() => vi.useRealTimers());
const later = (ms = 5000) => {
  clock += ms;
  vi.setSystemTime(clock);
};

describe('appendChord', () => {
  it('adds one bar at the insert point and advances it', () => {
    appendChord({ pcs: C, origin: 'tonnetz' });
    appendChord({ pcs: F, origin: 'tonnetz' });
    expect(shape()).toEqual([
      [C, 0, 4],
      [F, 4, 4],
    ]);
    expect(store.getState().timeline.insertIndex).toBe(2);
    expect(store.getState().timeline.selection).toBe(sk().chords[1]?.id);
  });

  it('pushes later chords back when inserting in the middle', () => {
    appendChord({ pcs: C, origin: 'tonnetz' });
    appendChord({ pcs: G, origin: 'tonnetz' });
    setInsertIndex(1);
    appendChord({ pcs: F, origin: 'tonnetz' });
    expect(shape()).toEqual([
      [C, 0, 4],
      [F, 4, 4],
      [G, 8, 4],
    ]);
  });

  it('uses the meter for "one bar"', () => {
    setMeter([3, 4]);
    appendChord({ pcs: C, origin: 'tonnetz' });
    expect(shape()).toEqual([[C, 0, 3]]);
  });

  it('keeps the chart text in canonical form, with its leading comments', () => {
    editChart('# my tune\n@tempo 100\n| C |');
    appendChord({ pcs: Am, origin: 'tonnetz' });
    expect(sk().chartText).toBe('# my tune\n@tempo 100\n@meter 4/4\n| C | Am |\n');
  });

  it('fixes the trail anchor once, where the first chord was drawn', () => {
    appendChord({ pcs: C, origin: 'tonnetz', near: { a: 5.4, b: -2.2 } });
    expect(sk().view.anchor).toEqual({ a: 5, b: -2 });
    setCamera({ a: 40, b: 40, zoom: 30 });
    appendChord({ pcs: F, origin: 'tonnetz', near: { a: 40, b: 40 } });
    expect(sk().view.anchor).toEqual({ a: 5, b: -2 });
    undo();
    undo();
    expect(sk().view.anchor).toEqual({ a: 5, b: -2 });
    expect(sk().view.camera.a).toBe(40);
  });
});

describe('deleteChord', () => {
  it('removes a chord and closes the gap', () => {
    for (const pcs of [C, F, G]) appendChord({ pcs, origin: 'tonnetz' });
    deleteChord(must(sk().chords[1]).id);
    expect(shape()).toEqual([
      [C, 0, 4],
      [G, 4, 4],
    ]);
    expect(store.getState().timeline.selection).toBe(sk().chords[1]?.id);
  });
});

describe('undo / redo', () => {
  it('undoes and redoes each edit exactly', () => {
    const states = [undoable(sk())];
    appendChord({ pcs: C, origin: 'tonnetz' });
    states.push(undoable(sk()));
    later();
    setTempo(120);
    states.push(undoable(sk()));
    later();
    deleteChord(must(sk().chords[0]).id);
    states.push(undoable(sk()));
    for (let i = states.length - 2; i >= 0; i--) {
      undo();
      expect(undoable(sk())).toEqual(states[i]);
    }
    expect(undo()).toBeNull();
    for (let i = 1; i < states.length; i++) {
      redo();
      expect(undoable(sk())).toEqual(states[i]);
    }
    expect(redo()).toBeNull();
  });

  it('a new edit clears the redo stack', () => {
    appendChord({ pcs: C, origin: 'tonnetz' });
    undo();
    appendChord({ pcs: F, origin: 'tonnetz' });
    expect(redo()).toBeNull();
    expect(shape()).toEqual([[F, 0, 4]]);
  });

  it('a burst of typing is one undo step', () => {
    const typed = ['| C', '| C |', '| C | F', '| C | F |'];
    for (const t of typed) {
      editChart(t);
      later(300);
    }
    expect(store.getState().history.past).toHaveLength(1);
    undo();
    expect(sk().chords).toEqual([]);
    later(5000);
    editChart('| G |');
    expect(store.getState().history.past).toHaveLength(1);
  });

  it('tempo drags coalesce; separate drags do not', () => {
    for (const bpm of [100, 104, 108]) setTempo(bpm);
    later(5000);
    setTempo(140);
    expect(store.getState().history.past.map((e) => e.label)).toEqual(['Tempo', 'Tempo']);
    undo();
    expect(sk().tempo).toBe(108);
    undo();
    expect(sk().tempo).toBe(96);
  });

  it('camera moves are saved but never undone', () => {
    appendChord({ pcs: C, origin: 'tonnetz' });
    setCamera({ a: 9, b: 9, zoom: 50 });
    expect(store.getState().history.past).toHaveLength(1);
    undo();
    expect(sk().view.camera).toEqual({ a: 9, b: 9, zoom: 50 });
  });

  it('undoing any random sequence of edits returns to the start', () => {
    const op = fc.oneof(
      fc.record({ k: fc.constant('add' as const), pcs: fc.integer({ min: 1, max: 0xfff }), at: fc.nat(8) }),
      fc.record({ k: fc.constant('del' as const), at: fc.nat(8) }),
      fc.record({ k: fc.constant('tempo' as const), bpm: fc.integer({ min: 30, max: 300 }) }),
      fc.record({ k: fc.constant('meter' as const), m: fc.constantFrom<[number, number]>([4, 4], [3, 4], [6, 8]) }),
      fc.record({ k: fc.constant('loop' as const), a: fc.nat(16), len: fc.nat(8) }),
      fc.record({ k: fc.constant('chart' as const), text: fc.constantFrom('| C G |', '| Dm7 . | G7 |', '| C Xyz |', '@tempo 77\n| Am |') }),
      fc.record({ k: fc.constant('misc' as const), n: fc.nat(2) }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 15 }), (ops) => {
        loadSketch(emptySketch('prop'));
        const start = undoable(sk());
        for (const o of ops) {
          later();
          if (o.k === 'add') {
            setInsertIndex(o.at);
            appendChord({ pcs: o.pcs, origin: 'tonnetz' });
          } else if (o.k === 'del') {
            const c = sk().chords[o.at % Math.max(1, sk().chords.length)];
            if (c) deleteChord(c.id);
          } else if (o.k === 'tempo') setTempo(o.bpm);
          else if (o.k === 'meter') setMeter(o.m);
          else if (o.k === 'loop') setLoop(o.len ? [o.a, o.a + o.len] : null);
          else if (o.k === 'chart') editChart(o.text);
          else if (o.n === 0) renameSketch(`n${clock}`);
          else if (o.n === 1) setVoicingMode('drop2');
          else setPatch('pad');
          // Invariant: chords sorted and non-overlapping.
          sk().chords.forEach((c, i, cs) => {
            if (i > 0) expect(c.start).toBeGreaterThanOrEqual(must(cs[i - 1]).start + must(cs[i - 1]).dur - 1e-9);
          });
        }
        while (undo());
        expect(undoable(sk())).toEqual(start);
      }),
      { numRuns: 60 },
    );
  });
});

describe('editChart', () => {
  it('replaces the chords on a clean parse, keeping ids by position', () => {
    editChart('| C F |');
    const ids = sk().chords.map((c) => c.id);
    later();
    editChart('| C G |');
    expect(sk().chords.map((c) => c.id)).toEqual(ids);
    expect(shape()).toEqual([
      [C, 0, 2],
      [G, 2, 2],
    ]);
  });

  it('keeps the last valid chords while the text has errors', () => {
    editChart('| C F |');
    later();
    const result = editChart('| C Fq |');
    expect(result.errors).toHaveLength(1);
    expect(sk().chartText).toBe('| C Fq |');
    expect(shape()).toEqual([
      [C, 0, 2],
      [F, 2, 2],
    ]);
  });

  it('takes tempo and meter from the directives', () => {
    editChart('@tempo 132\n@meter 3/4\n| C |');
    expect(sk().tempo).toBe(132);
    expect(sk().meter).toEqual([3, 4]);
    expect(shape()).toEqual([[C, 0, 3]]);
  });

  it('setTempo rewrites only the @tempo line', () => {
    editChart('# keep\n@tempo 90\n| C >P | % |');
    later();
    setTempo(100);
    expect(sk().chartText).toBe('# keep\n@tempo 100\n| C >P | % |');
  });
});

describe('selection and insert point', () => {
  it('selecting a chord makes it current, so P/L/R continue from it', () => {
    appendChord({ pcs: C, origin: 'tonnetz' });
    appendChord({ pcs: Am, origin: 'tonnetz' });
    selectChord(must(sk().chords[0]).id);
    const s = store.getState();
    expect(s.timeline.insertIndex).toBe(1);
    expect(s.explorer.current?.kind).toBe('triad');
  });

  it('appendCurrent anchors the trail at the drawn chord', () => {
    selectTriangle({ a: 3, b: 1, orient: 'up' });
    appendCurrent();
    const first = must(selectTrail(store.getState())[0]);
    expect(first.shape).toEqual({ kind: 'triad', triangle: { a: 3, b: 1, orient: 'up' } });
  });

  it('Left / Right move the insert point by one chord', () => {
    for (const pcs of [C, F, G]) appendChord({ pcs, origin: 'tonnetz' });
    moveInsert(-1);
    moveInsert(-1);
    expect(store.getState().timeline.insertIndex).toBe(1);
    moveInsert(-5);
    expect(store.getState().timeline.insertIndex).toBe(0);
    moveInsert(9);
    expect(store.getState().timeline.insertIndex).toBe(3);
  });
});

describe('selectors', () => {
  it('finds the chord at a beat, -1 in rests', () => {
    editChart('| C F | _ | G |');
    const cs = sk().chords;
    expect([0, 1.99, 2, 3.5, 4, 7.9, 8, 11.9, 12].map((t) => chordIndexAt(cs, t))).toEqual([0, 0, 1, 1, -1, -1, 2, 2, -1]);
  });

  it('voices the whole sketch, pinned voicings first', () => {
    editChart('| C | C | F |');
    const v = selectVoicings(store.getState());
    expect(v).toHaveLength(3);
    expect(v[1]).toEqual(v[0]); // repeated chord holds still
    expect(selectVoicings(store.getState())).toBe(v); // memoized
  });

  it('classifies moves and memoizes the trail', () => {
    editChart('| C Am | F G |');
    const s = store.getState();
    expect(selectMoves(s).map((m) => m?.kind ?? null)).toEqual([null, 'flip', 'flip', 'jump']);
    expect(selectTrail(s)).toBe(selectTrail(store.getState()));
    setCamera({ a: 30, b: 30, zoom: 64 });
    expect(selectTrail(store.getState())).toBe(selectTrail(s)); // panning never re-embeds
  });
});

describe('reviveSketch', () => {
  it('round-trips a sketch through JSON', () => {
    editChart('# t\n@tempo 101\n| Dm7/G . | [0 1 2] |');
    setLoop([0, 4]);
    const s = sk();
    expect(reviveSketch(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('repairs damaged records instead of failing', () => {
    expect(reviveSketch(null)).toBeNull();
    expect(reviveSketch({ name: 'no id' })).toBeNull();
    const r = must(
      reviveSketch({
        id: 'x',
        tempo: 'fast',
        meter: [0, 4],
        chords: [
          { id: 'a', start: 0, dur: 4, pcs: C, bass: 4 as PC, origin: 'typed' },
          { id: 'b', start: 2, dur: 4, pcs: F, origin: 'typed' }, // overlaps: dropped
          { id: 'c', start: 8, dur: 0, pcs: G, origin: 'typed' }, // zero length: dropped
          { id: 'd', start: 8, dur: 4, pcs: fromPcs([1]), origin: 'bogus' },
        ],
        voicingMode: 'weird',
      }),
    );
    expect(r.tempo).toBe(96);
    expect(r.meter).toEqual([4, 4]);
    expect(r.chords.map((c) => c.id)).toEqual(['a', 'd']);
    expect(r.chords[1]?.origin).toBe('typed');
    expect(r.voicingMode).toBe('smooth');
  });
});
