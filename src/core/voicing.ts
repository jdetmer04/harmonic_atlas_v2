// Voicing: turning a pitch-class set into MIDI notes.
//
// M1 only needs something to audition, so this is a plain close voicing.
// M2 adds the smooth auto-voicing from SPEC.md "Auto-voicing".

import { toPcs, type PC, type PcSet } from './pcset';
import { triadOf } from './ops';

/** Bass in C2–B2, then every pitch class once, stacked in A3–G♯4. */
export function closeVoicing(set: PcSet, bass?: PC): number[] {
  const pcs = toPcs(set);
  if (pcs.length === 0) return [];
  const low = bass ?? triadOf(set)?.root ?? (pcs[0] as PC);
  const upper = pcs.map((pc) => 57 + ((pc - 9 + 12) % 12)).sort((x, y) => x - y);
  return [36 + low, ...upper];
}
