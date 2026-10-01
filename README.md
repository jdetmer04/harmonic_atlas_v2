# Harmonic Atlas v2

A local scratchpad for sketching harmonic ideas as paths through fixed spaces: a Tonnetz, a pitch-class DFT panel and Euclidean rhythm necklaces, sharing one sketch and one playhead. The full design is in [SPEC.md](SPEC.md).

**Status:** M2 — sketch, chart and playback. Build a progression on the Tonnetz or type it as a chart, hear it loop with smooth auto-voicing, watch its trail drift across the lattice, and undo anything. Sketches autosave and come back on reload. (M1's explorer is all still there.)

## Running it

Needs Node 22+ and Firefox 108+ (Web MIDI asks for a site permission the first time). Chromium also works.

```sh
npm install
npm run dev        # http://localhost:5173 — open in Firefox
npm test           # Vitest: core fixtures, properties, lint-rule checks
npm run lint       # ESLint, including architecture boundary rules
npm run build      # type-check (tsc -b) + production build
```

The MIDI spike page is at <http://localhost:5173/spike/midi.html>.

### Using the explorer

| Input | Does |
| --- | --- |
| Click a triangle | Make that triad current and hear it |
| Click a node | Add or remove it from the current chord (build any set) |
| P, L, R | Flip the current triad |
| S, H, N | Slide (LPR), hexatonic pole (LPL), RLP |
| Custom keys | Type e.g. `Q=PRL, W=LRLR` in the right column |
| Drag, wheel | Pan, zoom |
| Esc | Clear |
| `` ` `` | Frame-time overlay |

Held MIDI notes override the current chord while held, with a ring on the lowest note. Pick the input in the top bar.

### Building and playing a sketch

| Input | Does |
| --- | --- |
| Enter, Shift-click | Append the current chord (one bar) at the insert point; later chords move back |
| Shift + P/L/R/S/H/N | Transform and append |
| C | Chart drawer: type or paste chords (syntax help is in the drawer) |
| Space | Play / stop (loops the loop region, or the whole sketch) |
| Click a timeline block | Hear it and make it current; P/L/R continue from it |
| ← → | Move the insert point |
| Backspace | Delete the selected chord |
| Drag in the timeline ruler | Set the loop (bars; Shift for beats). Click the ruler to clear |
| Ctrl+Z, Ctrl+Shift+Z | Undo, redo |

The top bar has tempo, meter, metronome, count-in, the sketch name, the sound (E-piano, Pad, Pluck), the voicing mode (smooth, close, drop2, spread) and undo/redo. The right column lists saved sketches.

The trail places each chord at the copy nearest the previous one and never re-centers, so it drifts. A ii–V–I loop winds sideways around the lattice, and chromatic moves can slip into flat or sharp spellings. That is the geometry talking (SPEC "Path embedding").

Labels are spelled by lattice position, so they drift as you move: three rows up from C the same pitch is B♯. Past double accidentals a name is compacted (C♭³) and shows its everyday name as a hint (=A).

Per-milestone manual checks live in [docs/smoke](docs/smoke).

## Layout

```text
src/core/     pure music math, no DOM/audio (pcset, spell, tonnetz, ops, dft, rhythm,
              voicing, chart, embed)
src/state/    Zustand store: the sketch (changed only by commands.ts, one undo stack),
              session state, selectors, IndexedDB autosave
src/engine/   Tone.js Transport and patches, audition synth, Web MIDI in
src/views/    Tonnetz canvas (tiled static layer + per-frame layer), timeline, piano
              strip, chart drawer, top bar, readout, sketch list
src/app/      composition root: wires engine to views, keymap, layout
spike/        throwaway pages (MIDI → Reaper spike)
tests/core/   one test file per core module
tests/state/  store actions and selectors
tests/views/  camera and hit-test math
tests/lint/   proves the boundary lint rules fire
docs/smoke/   manual checklists per milestone
```

Boundaries are enforced, not just documented:

- `src/core/` may import only sibling core modules and `tonal`. ESLint rejects anything else, and `tsconfig.core.json` type-checks core without DOM or Node types, so `window`, `AudioContext` or `console` in core fail the build.
- `src/views/` may not import `src/engine/`.
- Only `src/state/commands.ts` may import `state/mutate` (the raw sketch setter).

## MIDI into Reaper

**Confirmed route (M0 spike, Sep 2026): Route A.** A note from the spike page landed on a Reaper track via Midi Through → PipeWire → Reaper on JACK. Getting Reaper's MIDI input to appear in qpwgraph took some fiddling on the Reaper side. _TODO: record the exact steps here._

The browser's Web MIDI sends to ALSA sequencer ports. Reaper has to see that port. On this machine (PipeWire 1.6), PipeWire's MIDI bridge already mirrors the kernel's `Midi Through Port-0` as the graph node `Midi-Bridge:Midi Through: Port-0 (capture)`, so route A needs nothing new installed.

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

This creates a `VirMIDI` card that is both an ALSA sequencer port (the browser sends to it) and a raw MIDI device (Reaper's ALSA mode can open it). Refresh the spike page and pick the VirMIDI output. In Reaper, enable the matching VirMIDI input. To load it at boot, add `snd-virmidi` to `/etc/modules-load.d/virmidi.conf` and `options snd-virmidi midi_devs=1` to `/etc/modprobe.d/virmidi.conf`.

### Route C: a2jmidid

Fallback if neither of the above works: `a2jmidid -e` bridges every ALSA sequencer port to JACK MIDI.

### Spike page checks

- **Loopback latency** sends a quiet note and times its return. `Midi Through` echoes whatever it receives, so this checks the browser side of route A without Reaper.
- **Arpeggio** schedules its notes ahead with Web MIDI timestamps, the way the engine will. Listen for even spacing in Reaper.
- **Panic** sends All Notes Off and All Sound Off on all 16 channels.
