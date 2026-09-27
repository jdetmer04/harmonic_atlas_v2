import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { asciiName, defaultName, defaultQ, nameToQ, noteLabel, noteName, qToPc, spell } from '../../src/core/spell';

describe('spell', () => {
  it('fixture: line-of-fifths index of F, C, G, F#, Bb is −1, 0, 1, 6, −2', () => {
    expect(['F', 'C', 'G', 'F#', 'Bb'].map(nameToQ)).toEqual([-1, 0, 1, 6, -2]);
    expect([-1, 0, 1, 6, -2].map(asciiName)).toEqual(['F', 'C', 'G', 'F#', 'Bb']);
  });

  it('names across the line of fifths', () => {
    const line = [-16, -15, -10, -9, -8, -7, -6, -1, 0, 5, 6, 12, 13, 19, 20, 21];
    expect(line.map(noteName)).toEqual([
      'B♭³', 'F♭♭', 'E♭♭', 'B♭♭', 'F♭', 'C♭', 'G♭', 'F', 'C', 'B', 'F♯', 'B♯', 'F♯♯', 'B♯♯', 'F♯³', 'C♯³',
    ]);
  });

  it('pitch class follows from q', () => {
    expect([0, 1, 4, -2, 6, 12].map(qToPc)).toEqual([0, 7, 4, 10, 6, 0]);
    fc.assert(fc.property(fc.integer({ min: -60, max: 60 }), (q) => qToPc(q + 12) === qToPc(q)));
  });

  it('compacts past double accidentals and adds the everyday name as a hint', () => {
    // C triple-flat is A.
    const cbbb = nameToQ('Cbbb') as number;
    expect(noteLabel(cbbb)).toEqual({ text: 'C♭³', hint: 'A' });
    expect(noteLabel(nameToQ('Bbb') as number)).toEqual({ text: 'B♭♭', hint: null });
    expect(noteLabel(nameToQ('Dbb') as number)).toEqual({ text: 'D♭♭', hint: null });
    expect(asciiName(cbbb)).toBe('Cbbb');
  });

  it('parses ASCII, Unicode and compact names', () => {
    expect(nameToQ('Fx')).toBe(nameToQ('F##'));
    expect(nameToQ('F𝄪')).toBe(13);
    expect(nameToQ('B𝄫')).toBe(-9);
    expect(nameToQ('C♭³')).toBe(nameToQ('Cbbb'));
    expect(nameToQ('bb')).toBe(-2);
    expect(nameToQ('H')).toBeNull();
    expect(nameToQ('C?')).toBeNull();
  });

  it('noteName and nameToQ round-trip for any q', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (q) => {
        expect(nameToQ(noteName(q))).toBe(q);
        expect(nameToQ(asciiName(q))).toBe(q);
        expect(spell(q).accidentals).toBe(Math.floor((q + 1) / 7));
      }),
    );
  });

  it('default spelling runs D♭ … F♯ (q in −5..6)', () => {
    expect(Array.from({ length: 12 }, (_, pc) => defaultName(pc))).toEqual([
      'C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B',
    ]);
    for (let pc = 0; pc < 12; pc++) {
      const q = defaultQ(pc);
      expect(q).toBeGreaterThanOrEqual(-5);
      expect(q).toBeLessThanOrEqual(6);
      expect(qToPc(q)).toBe(pc);
    }
  });
});
