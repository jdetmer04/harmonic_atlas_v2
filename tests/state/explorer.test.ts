import { beforeEach, describe, expect, it } from 'vitest';
import { fromPcs } from '../../src/core/pcset';
import { triangleName, type Triangle } from '../../src/core/tonnetz';
import { initialState, store } from '../../src/state/store';
import {
  parseCustomOps,
  selectMidiInput,
  selectTriangle,
  setHeld,
  setHover,
  toggleNode,
  transform,
} from '../../src/state/actions';
import { selectCustomOps, selectDisplay } from '../../src/state/selectors';

const C: Triangle = { a: 0, b: 0, orient: 'up' };
const current = () => store.getState().explorer.current;

beforeEach(() => store.setState(initialState(), true));

describe('explorer', () => {
  it('clicking a triangle makes it the current triad', () => {
    selectTriangle(C);
    expect(current()).toEqual({ kind: 'triad', triangle: C });
    expect(selectDisplay(store.getState()).name).toBe('C');
  });

  it('PLPLPL walks the hexatonic strip, one keypress at a time', () => {
    selectTriangle(C);
    const names = [];
    for (const op of 'PLPLPL') {
      const next = transform(op);
      if (next?.kind === 'triad') names.push(triangleName(next.triangle));
    }
    expect(names).toEqual(['Cm', 'A♭', 'A♭m', 'F♭', 'F♭m', 'D♭♭']);
    expect(store.getState().explorer.lastMove).toBe('L');
  });

  it('a compound string is one move', () => {
    selectTriangle(C);
    transform('lpr');
    expect(current()).toMatchObject({ kind: 'triad' });
    expect(selectDisplay(store.getState()).name).toBe('C♯m');
    expect(store.getState().explorer.lastMove).toBe('LPR');
  });

  it('transform does nothing without a current triad', () => {
    expect(transform('P')).toBeNull();
    toggleNode({ a: 0, b: 0 });
    expect(transform('P')).toBeNull();
  });

  it('toggling nodes builds any set; a triad breaks into nodes and reforms', () => {
    selectTriangle(C);
    toggleNode({ a: 1, b: 1 }); // add B → Cmaj7
    expect(current()?.kind).toBe('nodes');
    const d = selectDisplay(store.getState());
    expect(d.pcs).toBe(fromPcs([0, 4, 7, 11]));
    expect(d.shape.kind).toBe('hull');

    toggleNode({ a: 1, b: 1 }); // remove B → back to a triad
    expect(current()).toEqual({ kind: 'triad', triangle: C });

    toggleNode({ a: 0, b: 0 });
    toggleNode({ a: 1, b: 0 });
    toggleNode({ a: 0, b: 1 });
    expect(current()).toBeNull();
  });

  it('hover ignores repeats of the same triangle', () => {
    setHover(C);
    const before = store.getState();
    setHover({ ...C });
    expect(store.getState()).toBe(before);
  });
});

describe('live MIDI', () => {
  it('held notes override the current chord, with a bass ring on the lowest note', () => {
    selectTriangle(C);
    setHeld([64, 57, 60]); // A3 C4 E4 → A minor, bass A
    const d = selectDisplay(store.getState());
    expect(d.source).toBe('midi');
    expect(d.pcs).toBe(fromPcs([9, 0, 4]));
    expect(d.shape.kind).toBe('triad');
    expect(d.bass).not.toBeNull();

    setHeld([]);
    expect(selectDisplay(store.getState()).source).toBe('explorer');
  });

  it('places near the current chord, and each new chord near the last', () => {
    selectTriangle({ a: 8, b: -3, orient: 'up' });
    setHeld([60, 64, 67]);
    const first = store.getState().live.placed;
    for (const p of first) expect(Math.abs(p.a - 8) + Math.abs(p.b + 3)).toBeLessThanOrEqual(4);
    setHeld([62, 65, 69]); // Dm, straight after
    for (const p of store.getState().live.placed) expect(Math.abs(p.a - 8) + Math.abs(p.b + 3)).toBeLessThanOrEqual(5);
  });

  it('octave doublings and repeats collapse; identical updates do not re-render', () => {
    setHeld([48, 60, 64]);
    const s = store.getState();
    setHeld([60, 48, 64]);
    expect(store.getState()).toBe(s);
    expect(store.getState().live.placed).toHaveLength(2);
  });

  it('switching inputs clears held notes', () => {
    setHeld([60]);
    selectMidiInput('other');
    expect(store.getState().live.held).toEqual([]);
  });
});

describe('custom operator strings', () => {
  it('parses bindings and reports problems', () => {
    expect(parseCustomOps('Q=PRL, w = lrlr')).toEqual({ bindings: { Q: 'PRL', W: 'LRLR' }, errors: [] });
    const bad = parseCustomOps('P=LR; X=PZ; nonsense; Y=S');
    expect(bad.bindings).toEqual({ Y: 'S' });
    expect(bad.errors).toHaveLength(3);
  });

  it('selector memoizes on the text', () => {
    store.setState((s) => ({ view: { ...s.view, customOpsText: 'Q=PRL' } }));
    const a = selectCustomOps(store.getState());
    store.setState((s) => ({ view: { ...s.view, torus: true } }));
    expect(selectCustomOps(store.getState())).toBe(a);
  });
});
