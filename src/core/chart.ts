// Chart text ⇄ chords (SPEC "Chart syntax").
//
//   @tempo 96
//   @meter 4/4
//   # comment
//   | Dm7 G7 | Cmaj7 . | C >P >L | [0 4 7 11] | {C E G B}/E | _ | % |
//
// Bars split evenly among their tokens. `.` holds the previous chord for one
// slot, `_` rests, `%` repeats the previous bar, `>P` (any operator string)
// transforms the previous triad. Beats are quarter notes, so a 6/8 bar is 3.
//
// `tonal` is used for chord-symbol parsing only; everything else is ours.

import { Chord } from 'tonal';
import { applyOps, parseOps, triadOf, triadPcs } from './ops';
import { fromPcs, popcount, toPcs, type PC, type PcSet } from './pcset';
import { asciiName, defaultQ, nameToQ, qToPc } from './spell';

export type Meter = [number, number];

export interface ChartChord {
  start: number; // beats
  dur: number;
  pcs: PcSet;
  bass?: PC;
  label: string; // the token as typed, or a generated name for `>P`
  origin: 'typed' | 'operator';
  from: number; // source span of the token that made it
  to: number;
}

export interface ChartError {
  from: number;
  to: number;
  message: string;
}

export interface ParsedChart {
  tempo: number | null; // null when the text has no @tempo
  meter: Meter | null;
  chords: ChartChord[];
  bars: number;
  errors: ChartError[];
}

export const DEFAULT_METER: Meter = [4, 4];

export function barBeats(meter: Meter): number {
  return (meter[0] * 4) / meter[1];
}

// Chord symbols

export interface Harmony {
  pcs: PcSet;
  bass?: PC;
}

/** What the voicing puts in the bass: the chord's bass, else its root, else its lowest pitch class. */
export function bassOf(c: { pcs: PcSet; bass?: PC; label?: string }): PC {
  if (c.bass !== undefined) return c.bass;
  const root = c.label ? symbolRoot(c.label) : null;
  if (root !== null && (c.pcs & (1 << root)) !== 0) return root;
  return triadOf(c.pcs)?.root ?? toPcs(c.pcs)[0] ?? 0;
}

const rootCache = new Map<string, PC | null>();

/** The tonic of a chord symbol, if the label is one ("Am7" → 9). */
function symbolRoot(label: string): PC | null {
  const hit = rootCache.get(label);
  if (hit !== undefined) return hit;
  let s = label;
  for (const [re, to] of ALIASES) s = s.replace(re, to);
  const tonic = label.startsWith('[') || label.startsWith('{') ? null : Chord.get(s).tonic;
  const root = tonic ? noteToPc(tonic) : null;
  if (rootCache.size > 4096) rootCache.clear();
  rootCache.set(label, root);
  return root;
}

const ALIASES: [RegExp, string][] = [
  [/ø7?/u, 'm7b5'],
  [/°/u, 'dim'],
];

const symbolCache = new Map<string, Harmony | null>();

/** Parse a chord symbol with `tonal`: "Dm7/G" → { pcs: D F A C, bass: G }. Null if not a chord. */
export function parseSymbol(symbol: string): Harmony | null {
  const cached = symbolCache.get(symbol);
  if (cached !== undefined) return cached;
  const result = parseSymbolUncached(symbol);
  if (symbolCache.size > 4096) symbolCache.clear();
  symbolCache.set(symbol, result);
  return result;
}

function parseSymbolUncached(symbol: string): Harmony | null {
  let s = symbol;
  for (const [re, to] of ALIASES) s = s.replace(re, to);
  const full = Chord.get(s);
  if (full.empty || !full.tonic) return null;
  if (!full.bass) return { pcs: chromas(full.notes) };
  // A slash chord: tonal adds the bass to `notes`, but pcs is the harmony
  // above it, so take the notes of the part before the slash.
  const upper = Chord.get(s.slice(0, s.lastIndexOf('/')));
  const bass = noteToPc(full.bass);
  if (upper.empty || bass === null) return null;
  return { pcs: chromas(upper.notes), bass };
}

function chromas(notes: readonly string[]): PcSet {
  const pcs: number[] = [];
  for (const n of notes) {
    const pc = noteToPc(n);
    if (pc !== null) pcs.push(pc);
  }
  return fromPcs(pcs);
}

function noteToPc(name: string): PC | null {
  const q = nameToQ(name);
  return q === null ? null : qToPc(q);
}

// Tokens

type Token =
  | { kind: 'bar'; from: number; to: number }
  | { kind: 'word'; text: string; from: number; to: number }
  | { kind: 'directive'; text: string; from: number; to: number };

function tokenize(text: string, errors: ChartError[]): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i] as string;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '|') {
      tokens.push({ kind: 'bar', from: i, to: i + 1 });
      i++;
      continue;
    }
    if (ch === '#' || ch === '@') {
      // Comments and directives run to the end of the line. '#' only starts a
      // comment at a token boundary, so F#m is still a chord.
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      if (ch === '@') tokens.push({ kind: 'directive', text: text.slice(i, j).trimEnd(), from: i, to: j });
      i = j;
      continue;
    }
    if (ch === '[' || ch === '{') {
      const close = ch === '[' ? ']' : '}';
      let j = i + 1;
      while (j < n && text[j] !== close && text[j] !== '\n' && text[j] !== '|') j++;
      if (text[j] !== close) {
        errors.push({ from: i, to: j, message: `Missing "${close}"` });
        i = j;
        continue;
      }
      j++;
      // Optional slash bass: [0 4 7]/4, {C E G}/E
      if (text[j] === '/') while (j < n && !/[\s|]/.test(text[j] as string)) j++;
      tokens.push({ kind: 'word', text: text.slice(i, j), from: i, to: j });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !/[\s|]/.test(text[j] as string)) j++;
    tokens.push({ kind: 'word', text: text.slice(i, j), from: i, to: j });
    i = j;
  }
  return tokens;
}

/** A single chord token: symbol, [pcs], {notes}, each with an optional /bass. Null if it isn't one. */
export function parseChordToken(text: string): Harmony | null {
  if (text.startsWith('[') || text.startsWith('{')) return parseSetToken(text);
  return parseSymbol(text);
}

function parseSetToken(text: string): Harmony | null {
  const numeric = text.startsWith('[');
  const close = text.indexOf(numeric ? ']' : '}');
  if (close < 0) return null;
  const items = text.slice(1, close).trim().split(/[\s,]+/).filter(Boolean);
  const rest = text.slice(close + 1);
  const pcs: number[] = [];
  for (const item of items) {
    const pc = numeric ? parsePcNumber(item) : noteToPc(item);
    if (pc === null) return null;
    pcs.push(pc);
  }
  if (pcs.length === 0) return null;
  const set = fromPcs(pcs);
  if (rest === '') return { pcs: set };
  if (!rest.startsWith('/')) return null;
  const bass = numeric ? parsePcNumber(rest.slice(1)) : noteToPc(rest.slice(1));
  return bass === null ? null : { pcs: set, bass };
}

function parsePcNumber(s: string): PC | null {
  if (!/^(?:[0-9]|1[01]|[tTeE])$/.test(s)) return null;
  if (s === 't' || s === 'T') return 10;
  if (s === 'e' || s === 'E') return 11;
  return Number(s) as PC;
}

// Parsing

type Slot =
  | { kind: 'chord'; pcs: PcSet; bass?: PC; label: string; origin: ChartChord['origin'] }
  | { kind: 'hold' }
  | { kind: 'rest' };

interface Bar {
  slots: Slot[];
  spans: { from: number; to: number }[];
}

export function parseChart(text: string): ParsedChart {
  const errors: ChartError[] = [];
  const tokens = tokenize(text, errors);
  let tempo: number | null = null;
  let meter: Meter | null = null;

  // Group words into bars, splitting on '|' and skipping empty segments.
  const groups: Extract<Token, { kind: 'word' }>[][] = [];
  let group: Extract<Token, { kind: 'word' }>[] = [];
  for (const t of tokens) {
    if (t.kind === 'directive') {
      const d = parseDirective(t.text);
      if ('error' in d) errors.push({ from: t.from, to: t.to, message: d.error });
      else if (d.tempo !== undefined) tempo = d.tempo;
      else if (d.meter) meter = d.meter;
    } else if (t.kind === 'bar') {
      if (group.length > 0) groups.push(group);
      group = [];
    } else group.push(t);
  }
  if (group.length > 0) groups.push(group);

  const bars: Bar[] = [];
  let prev: Harmony | null = null; // the last chord, for >P
  for (const words of groups) {
    const first = words[0] as (typeof words)[number];
    if (first.text === '%') {
      if (words.length > 1) {
        errors.push({ from: first.from, to: (words[words.length - 1] as Token).to, message: '"%" must fill the bar' });
      }
      const last = bars[bars.length - 1];
      if (!last) {
        errors.push({ from: first.from, to: first.to, message: 'No previous bar to repeat' });
        bars.push({ slots: [{ kind: 'rest' }], spans: [first] });
        continue;
      }
      bars.push({ slots: last.slots, spans: last.slots.map(() => first) });
      for (const s of last.slots) if (s.kind === 'chord') prev = s;
      continue;
    }
    const slots: Slot[] = [];
    for (const w of words) {
      const slot = parseSlot(w.text, prev);
      if ('error' in slot) {
        errors.push({ from: w.from, to: w.to, message: slot.error });
        slots.push({ kind: 'rest' });
        continue;
      }
      if (slot.kind === 'chord') prev = slot;
      slots.push(slot);
    }
    bars.push({ slots, spans: words });
  }

  // Lay the slots out in time.
  const beats = barBeats(meter ?? DEFAULT_METER);
  const chords: ChartChord[] = [];
  let holding: ChartChord | null = null;
  bars.forEach((bar, i) => {
    const slotBeats = beats / bar.slots.length;
    bar.slots.forEach((slot, j) => {
      const start = i * beats + j * slotBeats;
      const span = bar.spans[j] as { from: number; to: number };
      if (slot.kind === 'chord') {
        holding = {
          start,
          dur: slotBeats,
          pcs: slot.pcs,
          label: slot.label,
          origin: slot.origin,
          from: span.from,
          to: span.to,
        };
        if (slot.bass !== undefined) holding.bass = slot.bass;
        chords.push(holding);
      } else if (slot.kind === 'hold') {
        if (holding) holding.dur = start + slotBeats - holding.start;
        else errors.push({ from: span.from, to: span.to, message: 'Nothing to hold' });
      } else holding = null;
    });
  });

  return { tempo, meter, chords, bars: bars.length, errors };
}

function parseSlot(text: string, prev: Harmony | null): Slot | { error: string } {
  if (text === '.') return { kind: 'hold' };
  if (text === '_') return { kind: 'rest' };
  if (text === '%') return { error: '"%" must fill the bar' };
  if (text.startsWith('>')) {
    let ops;
    try {
      ops = parseOps(text.slice(1));
    } catch {
      return { error: `Unknown operator in "${text}"` };
    }
    if (ops.length === 0) return { error: 'Write an operator after ">", e.g. >P' };
    const triad = prev ? triadOf(prev.pcs) : null;
    if (!triad) return { error: `"${text}" needs a major or minor triad before it` };
    const next = applyOps(triad, ops);
    return {
      kind: 'chord',
      pcs: triadPcs(next),
      label: rootName(next.root) + (next.quality === 'min' ? 'm' : ''),
      origin: 'operator',
    };
  }
  const h = parseChordToken(text);
  if (!h) return { error: `Not a chord: "${text}"` };
  const slot: Slot = { kind: 'chord', pcs: h.pcs, label: text, origin: 'typed' };
  if (h.bass !== undefined) slot.bass = h.bass;
  return slot;
}

function parseDirective(text: string): { tempo?: number; meter?: Meter } | { error: string } {
  const m = /^@(\w+)\s*(.*)$/.exec(text);
  const name = m?.[1] ?? '';
  const arg = (m?.[2] ?? '').trim();
  if (name === 'tempo') {
    const bpm = Number(arg);
    if (!arg || !Number.isFinite(bpm) || bpm < 20 || bpm > 400) return { error: 'Tempo must be 20–400 bpm' };
    return { tempo: bpm };
  }
  if (name === 'meter') {
    const mm = /^(\d+)\s*\/\s*(\d+)$/.exec(arg);
    const num = Number(mm?.[1]);
    const den = Number(mm?.[2]);
    if (!mm || num < 1 || num > 32 || ![1, 2, 4, 8, 16, 32].includes(den)) return { error: 'Meter looks like 4/4 or 6/8' };
    return { meter: [num, den] };
  }
  return { error: `Unknown directive "@${name}"` };
}

// Printing

export interface PrintableChord {
  start: number;
  dur: number;
  pcs: PcSet;
  bass?: PC;
  label?: string;
}

export interface PrintInput {
  tempo: number;
  meter: Meter;
  chords: readonly PrintableChord[];
  /** Comment lines to keep at the top, e.g. from leadingComments(previousText). */
  header?: readonly string[];
}

const BARS_PER_LINE = 4;
const MAX_SLOTS = 48;
const EPS = 1e-6;

/**
 * Canonical chart text. Uses each chord's label when it still means the same
 * harmony, else a generated symbol, else {note names}. Never emits % or >P.
 */
export function printChart(input: PrintInput): string {
  const { meter, chords } = input;
  const lines: string[] = [...(input.header ?? [])];
  lines.push(`@tempo ${formatNumber(input.tempo)}`, `@meter ${meter[0]}/${meter[1]}`);

  const beats = barBeats(meter);
  const end = chords.reduce((e, c) => Math.max(e, c.start + c.dur), 0);
  const barCount = Math.ceil(end / beats - EPS);
  const bars: string[] = [];
  let ci = 0;
  for (let i = 0; i < barCount; i++) {
    const barStart = i * beats;
    const barEnd = barStart + beats;
    while (ci < chords.length && (chords[ci] as PrintableChord).start + (chords[ci] as PrintableChord).dur <= barStart + EPS) ci++;
    const inBar: PrintableChord[] = [];
    for (let j = ci; j < chords.length && (chords[j] as PrintableChord).start < barEnd - EPS; j++) {
      inBar.push(chords[j] as PrintableChord);
    }
    bars.push(printBar(inBar, barStart, beats));
  }
  for (let i = 0; i < bars.length; i += BARS_PER_LINE) {
    lines.push(`| ${bars.slice(i, i + BARS_PER_LINE).join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

function printBar(inBar: readonly PrintableChord[], barStart: number, beats: number): string {
  // The coarsest even split that puts every chord boundary on a slot edge.
  const edges: number[] = [];
  for (const c of inBar) edges.push(c.start - barStart, c.start + c.dur - barStart);
  const fits = (n: number) =>
    edges.every((e) => {
      if (e <= EPS || e >= beats - EPS) return true;
      const x = (e / beats) * n;
      return Math.abs(x - Math.round(x)) < EPS * n;
    });
  let slots = 1;
  while (slots < MAX_SLOTS && !fits(slots)) slots++;

  const slotBeats = beats / slots;
  const out: string[] = [];
  for (let j = 0; j < slots; j++) {
    const t = barStart + j * slotBeats;
    const c = inBar.find((x) => x.start - EPS <= t && t < x.start + x.dur - EPS);
    if (!c) out.push('_');
    else if (c.start > t - EPS) out.push(chordText(c));
    else out.push('.');
  }
  return out.join(' ');
}

function formatNumber(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000);
}

/** Text for one chord that parses back to the same harmony. */
export function chordText(c: { pcs: PcSet; bass?: PC; label?: string }): string {
  const same = (h: Harmony | null) => h !== null && h.pcs === c.pcs && h.bass === c.bass;
  if (c.label && isOneWord(c.label) && same(parseChordToken(c.label))) return c.label;
  const symbol = chordSymbol(c.pcs, c.bass);
  if (symbol && same(parseChordToken(symbol))) return symbol;
  const notes = `{${toPcs(c.pcs).map(pcName).join(' ')}}`;
  return c.bass === undefined ? notes : `${notes}/${pcName(c.bass)}`;
}

function isOneWord(text: string): boolean {
  const errors: ChartError[] = [];
  const tokens = tokenize(text, errors);
  return errors.length === 0 && tokens.length === 1 && tokens[0]?.kind === 'word' && tokens[0].text === text;
}

const SUFFIXES = [
  '', 'm', '7', 'maj7', 'm7', 'm7b5', 'dim', 'dim7', 'aug', 'sus4', 'sus2', '6', 'm6', '5',
  '9', 'maj9', 'm9', '7b9', '7#9', '7#11', '7b5', '7#5', '7sus4', 'add9', 'madd9', 'mMaj7',
  '69', '11', 'm11', '13', 'maj7#11', 'maj9#11', 'm7b9',
];

let symbolTable: Map<PcSet, string> | null = null;

/** A plain chord symbol for a pitch-class set, if a common one fits: "Am7", "C/E". */
export function chordSymbol(pcs: PcSet, bass?: PC): string | null {
  if (popcount(pcs) === 0) return null;
  const triad = triadOf(pcs);
  let name: string | null = triad ? rootName(triad.root) + (triad.quality === 'min' ? 'm' : '') : null;
  if (!name) {
    if (!symbolTable) symbolTable = buildSymbolTable();
    name = symbolTable.get(pcs) ?? null;
  }
  if (!name) return null;
  return bass === undefined ? name : `${name}/${pcName(bass)}`;
}

function buildSymbolTable(): Map<PcSet, string> {
  const table = new Map<PcSet, string>();
  // Suffixes in order of preference; the first name found for a set wins.
  for (const suffix of SUFFIXES) {
    for (let pc = 0; pc < 12; pc++) {
      const name = rootName(pc) + suffix;
      const h = parseSymbol(name);
      if (h && h.bass === undefined && !table.has(h.pcs)) table.set(h.pcs, name);
    }
  }
  return table;
}

function rootName(pc: number): string {
  return asciiName(defaultQ(pc));
}

function pcName(pc: number): string {
  return asciiName(defaultQ(pc));
}

/** The comment lines at the top of a chart, kept when chords are edited elsewhere and the text is rewritten. */
export function leadingComments(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#')) out.push(line.trimEnd());
    else if (t === '' || t.startsWith('@')) continue;
    else break;
  }
  return out;
}
