// Pitch classes and pitch-class sets as 12-bit masks (bit p = pitch class p).
// Set ops are bitwise, transposition is a 12-bit rotate.

export type PC = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11; // C = 0
export type PcSet = number;
export type PcVector = Float32Array; // length 12, weight per pitch class

export const EMPTY: PcSet = 0;
export const AGGREGATE: PcSet = 0xfff;

/** Always-non-negative modulo. */
export function mod(x: number, m: number): number {
  return ((x % m) + m) % m;
}

export function toPc(x: number): PC {
  return mod(Math.round(x), 12) as PC;
}

export function fromPcs(pcs: Iterable<number>): PcSet {
  let set = EMPTY;
  for (const p of pcs) set |= 1 << toPc(p);
  return set;
}

/** Members in ascending order. */
export function toPcs(set: PcSet): PC[] {
  const out: PC[] = [];
  for (let p = 0; p < 12; p++) if (set & (1 << p)) out.push(p as PC);
  return out;
}

export function has(set: PcSet, p: number): boolean {
  return (set & (1 << toPc(p))) !== 0;
}

export function add(set: PcSet, p: number): PcSet {
  return set | (1 << toPc(p));
}

export function remove(set: PcSet, p: number): PcSet {
  return set & ~(1 << toPc(p)) & AGGREGATE;
}

export function toggle(set: PcSet, p: number): PcSet {
  return set ^ (1 << toPc(p));
}

export function union(a: PcSet, b: PcSet): PcSet {
  return a | b;
}

export function intersect(a: PcSet, b: PcSet): PcSet {
  return a & b;
}

export function difference(a: PcSet, b: PcSet): PcSet {
  return a & ~b & AGGREGATE;
}

export function complement(set: PcSet): PcSet {
  return ~set & AGGREGATE;
}

export function isSubset(sub: PcSet, of: PcSet): boolean {
  return (sub & ~of & AGGREGATE) === 0;
}

export function popcount(set: PcSet): number {
  let x = set & AGGREGATE;
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

/** T_n: every member p moves to p + n. */
export function transpose(set: PcSet, n: number): PcSet {
  const s = mod(Math.round(n), 12);
  const x = set & AGGREGATE;
  return ((x << s) | (x >>> (12 - s))) & AGGREGATE;
}

/** I_n: every member p moves to n − p. */
export function invert(set: PcSet, n = 0): PcSet {
  let out = EMPTY;
  for (let p = 0; p < 12; p++) if (set & (1 << p)) out |= 1 << mod(n - p, 12);
  return out;
}

/** Weight 1 per member. Writes into `out` when given so per-frame callers don't allocate. */
export function toVector(set: PcSet, out: PcVector = new Float32Array(12)): PcVector {
  for (let p = 0; p < 12; p++) out[p] = set & (1 << p) ? 1 : 0;
  return out;
}
