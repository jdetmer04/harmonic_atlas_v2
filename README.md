# Harmonic Atlas v2

A local scratchpad for sketching harmonic ideas as paths through fixed spaces: a Tonnetz, a pitch-class DFT panel and Euclidean rhythm necklaces, sharing one sketch and one playhead. The full design is in [SPEC.md](SPEC.md).

**Status:** M0 (skeleton and core). No views yet.

## Running it

Needs Node 22+ and Chromium (for Web MIDI).

```sh
npm install
npm run dev        # http://localhost:5173 — open in Chromium
npm test           # Vitest: core fixtures, properties, lint-rule checks
npm run lint       # ESLint, including architecture boundary rules
npm run build      # type-check (tsc -b) + production build
```

The MIDI spike page is at <http://localhost:5173/spike/midi.html>.

## Layout

```text
src/core/     pure music math, no DOM/audio (pcset, spell, tonnetz, ops, dft, rhythm)
src/app/      React shell (placeholder until M1)
spike/        throwaway pages (MIDI → Reaper spike)
tests/core/   one test file per core module
tests/lint/   proves the boundary lint rules fire
```

Boundaries are enforced, not just documented:

- `src/core/` may import only sibling core modules and `tonal`. ESLint rejects anything else, and `tsconfig.core.json` type-checks core without DOM or Node types, so `window`, `AudioContext` or `console` in core fail the build.
- `src/views/` may not import `src/engine/`.
- Only `src/state/commands.ts` may import `state/mutate` (the raw sketch setter, arriving in M2).

## MIDI into Reaper

**Confirmed route:** _not yet confirmed. Fill in after the spike: which route below worked, and any fixes._

Chromium's Web MIDI sends to ALSA sequencer ports. Reaper has to see that port. On this machine (PipeWire 1.6), PipeWire's MIDI bridge already mirrors the kernel's `Midi Through Port-0` as the graph node `Midi-Bridge:Midi Through: Port-0 (capture)`, so route A needs nothing new installed.

### Route A: Midi Through → PipeWire → Reaper (JACK)

1. Start Reaper on PipeWire's JACK: `pw-jack reaper`. Or set Reaper's audio system to JACK in Preferences → Audio → Device.
2. In the same Preferences page, make sure Reaper provides at least one JACK MIDI input. Then under Preferences → Audio → MIDI Inputs, enable it.
3. In qpwgraph, connect **Midi-Bridge → Midi Through: Port-0 (capture)** to Reaper's MIDI input. The CLI equivalent is `pw-link "Midi-Bridge:Midi Through: Port-0 (capture)" "<reaper midi input port>"`. Run `pw-link -i | grep -i reaper` to find the input's name.
4. In Reaper: insert a track with ReaSynth, arm it, set its input to that MIDI device (or all MIDI inputs), and turn monitoring on.
5. Open the spike page, pick output **Midi Through Port-0**, and press **Note C4**.

### Route B: snd-virmidi (works with Reaper in ALSA mode too)

```sh
sudo modprobe snd-virmidi midi_devs=1
```

This creates a `VirMIDI` card that is both an ALSA sequencer port (Chromium sends to it) and a raw MIDI device (Reaper's ALSA mode can open it). Refresh the spike page and pick the VirMIDI output. In Reaper, enable the matching VirMIDI input. To load it at boot, add `snd-virmidi` to `/etc/modules-load.d/virmidi.conf` and `options snd-virmidi midi_devs=1` to `/etc/modprobe.d/virmidi.conf`.

### Route C: a2jmidid

Fallback if neither of the above works: `a2jmidid -e` bridges every ALSA sequencer port to JACK MIDI.

### Spike page checks

- **Loopback latency** sends a quiet note and times its return. `Midi Through` echoes whatever it receives, so this checks the Chromium side of route A without Reaper.
- **Arpeggio** schedules its notes ahead with Web MIDI timestamps, the way the engine will. Listen for even spacing in Reaper.
- **Panic** sends All Notes Off and All Sound Off on all 16 channels.
