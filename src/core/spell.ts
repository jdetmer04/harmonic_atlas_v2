// Note spelling from the line of fifths.
//
// A note's line-of-fifths index q counts fifths from C (F = −1, C = 0, G = 1,
// F# = 6, Bb = −2). Its pitch class is 7q mod 12, and its name follows from q
// alone: the letter cycles FCGDAEB, and every 7 steps adds a sharp (or flat).

import { mod, type PC } from './pcset';

const LETTERS = 'FCGDAEB';
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

export interface Spelling {
  letter: string; // 'A'..'G'
  accidentals: number; // + sharps, − flats
}

export function qToPc(q: number): PC {
  return mod(7 * q, 12) as PC;
}

export function spell(q: number): Spelling {
  return {
    letter: LETTERS[mod(q + 1, 7)] as string,
    accidentals: Math.floor((q + 1) / 7),
  };
}

/**
 * Display name. Up to two accidentals are written out (F♯, B♭♭); beyond that
 * they are compacted with a superscript count (C♭³).
 */
export function noteName(q: number): string {
  const { letter, accidentals } = spell(q);
  const count = Math.abs(accidentals);
  const sign = accidentals > 0 ? '♯' : '♭';
  if (count === 0) return letter;
  if (count <= 2) return letter + sign.repeat(count);
  return letter + sign + toSuperscript(count);
}

/** Plain-text name for charts and files: F#, Bb, Cbbb. */
export function asciiName(q: number): string {
  const { letter, accidentals } = spell(q);
  return letter + (accidentals > 0 ? '#' : 'b').repeat(Math.abs(accidentals));
}

/** A node label, plus the everyday name when the spelling has drifted past double accidentals. */
export interface NoteLabel {
  text: string; // 'C♭³'
  hint: string | null; // 'A', or null when `text` is already readable
}

export function noteLabel(q: number): NoteLabel {
  const drifted = Math.abs(spell(q).accidentals) > 2;
  return { text: noteName(q), hint: drifted ? noteName(defaultQ(qToPc(q))) : null };
}

/**
 * Spelling for a pitch class with no lattice position (chart text, DFT ring):
 * the q in −5..6, i.e. D♭ A♭ E♭ B♭ F C G D A E B F♯.
 */
export function defaultQ(pc: number): number {
  return mod(7 * pc + 5, 12) - 5;
}

export function defaultName(pc: number): string {
  return noteName(defaultQ(pc));
}

/**
 * Parse a note name into its line-of-fifths index. Accepts ASCII (F#, Bb, Cbb,
 * C##, Fx), Unicode (F♯, B♭, 𝄪, 𝄫) and compact counts (C♭³). Returns null if
 * the string is not a note name.
 */
export function nameToQ(name: string): number | null {
  const m = /^([A-Ga-g])(.*)$/u.exec(name.trim());
  if (!m) return null;
  const letterIndex = LETTERS.indexOf((m[1] as string).toUpperCase());
  const acc = parseAccidentals(m[2] as string);
  if (acc === null) return null;
  return letterIndex - 1 + 7 * acc;
}

function parseAccidentals(s: string): number | null {
  if (s === '') return 0;
  const compact = /^([♯#♭b])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/u.exec(s);
  if (compact) {
    const sign = compact[1] === '♯' || compact[1] === '#' ? 1 : -1;
    return sign * fromSuperscript(compact[2] as string);
  }
  let total = 0;
  for (const ch of s) {
    if (ch === '#' || ch === '♯') total += 1;
    else if (ch === 'x' || ch === '𝄪') total += 2;
    else if (ch === 'b' || ch === '♭') total -= 1;
    else if (ch === '𝄫') total -= 2;
    else return null;
  }
  return total;
}

function toSuperscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPT[Number(d)])
    .join('');
}

function fromSuperscript(s: string): number {
  let n = 0;
  for (const ch of s) n = n * 10 + SUPERSCRIPT.indexOf(ch);
  return n;
}
