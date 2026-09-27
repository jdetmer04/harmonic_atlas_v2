# Harmonic Atlas v2 — Spec

Sep 27, 2026 · Jack

## Purpose and principles

Harmonic Atlas v2 is a from-scratch rewrite: a snappy local scratchpad where chords, progressions and rhythms are drawn as paths through fixed spaces, so you can try an idea, see its shape, hear it, and send it to Reaper. It is a sketching instrument, not a finished-piece generator.

Three coordinated views share one piece of state and one playhead:

1. **Tonnetz** — local voice-leading texture. Chords are shapes; a progression is a trail.
2. **DFT panel** — the tonal quality and drift of whatever is sounding, computed from pitch content alone.
3. **Rhythm scratchpad** — Euclidean patterns on necklaces, which can drive the harmony (arpeggios, chord changes, Tonnetz walks).

Design principles:

- **Fixed geometry.** Position always means the same thing. Songs make shapes; the map never rearranges itself around a selection.
- **Lenses, not a mega-graph.** Each view answers one question well. No view tries to show every relationship at once.
- **No global key.** Nothing requires choosing a key first. Key-ish readings (the fifths comet) are computed from notes, never asserted.
- **Everything auditions.** Click anything that represents sound and you hear it within one frame.
- **Generate, then commit.** Generators are seeded and deterministic. Their output stays live and disposable until you commit it into the sketch.
- **Everything undoes.** Every edit, commit and transform goes through one undo stack.
- **Snappy over complete.** 60 fps views, no server, no 3D in v2. A feature that cannot meet the performance budget waits.

## Stack and runtime

A local Vite + TypeScript web app, run with `npm run dev` and opened in Chromium on Pop!_OS. The browser already has everything this needs: Canvas 2D for drawing, Web Audio for sound, and Web MIDI for talking to Reaper.

| Layer | Choice | Why |
| --- | --- | --- |
| Build | Vite + TypeScript (strict) | Instant reload, no install beyond Node |
| UI chrome | React | Panels, forms and lists only |
| Views | Canvas 2D, one `<canvas>` per view | Hundreds of shapes at 60 fps; no DOM-per-node like Cytoscape |
| State | Zustand + a command-based undo stack | Small, selector-based, easy to snapshot |
| Audio | Tone.js (Transport, PolySynth, a few synthesized drums) | Sample-accurate scheduling and loop regions for free |
| MIDI | Web MIDI API + `@tonejs/midi` for .mid export | Live out/in to Reaper, and drag-in files |
| Chord parsing | `tonal` (parsing only) | Handles chord symbols and slash chords; all other math is ours |
| Tests | Vitest | Core math is pure and easy to test |

**Reaper routing on Linux.** Chromium's Web MIDI talks to ALSA sequencer ports. Reaper under PipeWire/JACK needs to see one of those ports, for example through a virtual MIDI port or PipeWire's ALSA–JACK MIDI bridge. Confirm the exact route in a short spike during M0 before building MIDI features on it. The .mid file export works regardless.

**Rejected alternatives.**

- *Python (pygame, Qt):* audio latency and redraw speed are worse, and the web view code would be rewritten anyway.
- *Rust (egui, nannou):* fast, but slower to iterate on visuals and UI.
- *Electron or Tauri now:* adds packaging with no benefit for a single-user local tool. Tauri remains an option later.

## Core data model

One `Sketch` object is the single source of truth. Every view derives its drawing from the sketch and the playhead time, and nothing else is stored.

```ts
type PC = 0|1|2|3|4|5|6|7|8|9|10|11;      // C = 0
type PcSet = number;                       // 12-bit mask, bit p = pitch class p present
type PcVector = Float32Array;              // length 12, weights (duration, doubling)

interface ChordEvent {
  id: string;
  start: number;           // beats from sketch start
  dur: number;             // beats
  pcs: PcSet;              // the harmony, always present
  bass?: PC;               // slash-chord bass, independent of pcs
  voicing?: number[];      // MIDI notes; absent = auto-voice
  label?: string;          // what the user typed, e.g. "Dm7/G"
  origin: 'typed' | 'tonnetz' | 'operator' | 'walker' | 'midi-in';
}

interface Lane {                               // rhythm scratchpad row
  id: string;
  steps: number;             // n
  hits: number;              // k
  rotation: number;
  stepBeats: number;         // length of one step in beats (0.25 = 16ths)
  role: LaneRole;            // what a hit does, see Rhythm scratchpad
  seed: number;
  mute: boolean;
  accents?: boolean[];
}

interface Sketch {
  name: string;
  tempo: number;             // bpm
  meter: [number, number];   // [4, 4]
  loop: [number, number] | null;  // beats
  chords: ChordEvent[];      // sorted by start, non-overlapping
  lanes: Lane[];
  chartText: string;         // last text form, kept in sync
  view: ViewPrefs;           // camera, toggles; saved but not undoable
}
```

Rules:

- **Pitch-class sets are masks.** Set ops are bitwise, and transposition is a 12-bit rotate. `popcount` gives cardinality.
- **Harmony and voicing are separate.** Views read `pcs` (and `bass`), while audio and MIDI read the voicing. An absent voicing is auto-voiced at render time.
- **Derived per frame:** the active chord at time t, and the windowed `PcVector` used by the DFT panel. Neither is stored.
- **Generated but uncommitted material** (walker output, arpeggios) lives in a separate `preview` slice. It plays and draws like real events but is not in `chords` until committed.

## Tonnetz view

The Tonnetz is an infinite triangular lattice with one axis of fifths and one of major thirds. Major and minor triads are its triangles, P/L/R are flips across a shared edge, and a progression is drawn as a trail of shapes.

### Lattice math

A node at integer coordinates (a, b) has pitch class `pc(a, b) = (7a + 4b) mod 12`.

The third direction, (a+1, b−1), is a minor third (+3). Screen position uses a skewed basis with spacing s: x = s·(a + b/2), y = −s·b·√3/2.

| Shape | Nodes (root at a, b) | Orientation |
| --- | --- | --- |
| Major triad | (a,b) root, (a+1,b) fifth, (a,b+1) major third | Up-pointing |
| Minor triad | (a,b) root, (a+1,b) fifth, (a+1,b−1) minor third | Down-pointing |

The transforms are edge flips. **P** keeps the fifth edge (C → Cm), **R** keeps the major-third edge (C → Am), and **L** keeps the minor-third edge (C → Em).

The lattice repeats with period vectors (4, −1) and (0, 3), whose determinant is 12. That repetition gives the torus view.

### Spelling from position

Label each node by its line-of-fifths index q = a + 4b rather than by its pitch class (F = −1, C = 0, G = 1, F# = 6, Bb = −2). The infinite plane then spells notes for free: a path that wanders eight fifths sharp shows G# where one that went flatward shows Ab.

### Path embedding

Every chord appears infinitely often on the plane, so the view must pick which copy to draw.

1. **Compact placement.** For a set of pitch classes, choose the lattice copy of each pitch class that minimizes total pairwise distance. Brute force is fine.
2. **Continuity.** For each chord after the first, choose the whole-shape translate (by a period vector) whose centroid is nearest the previous chord's centroid. The first chord goes nearest the camera center.
3. **Drift is information.** Don't re-center a long progression back to home.

### Rendering

- Nodes are small circles with spelled labels. Idle triangles get a faint fill; nodes in the current chord are lit.
- **Triads** fill their triangle. **Other sets** light their nodes and draw a convex hull, with lattice-adjacent pairs joined by thick edges (sevenths appear as rhombuses). **Collinear sets** collapse to a thick capsule along the axis they lie on: sus, quartal and stacked fifths along the fifths axis, augmented along major thirds, diminished along minor thirds.
- The **bass note** gets a ring, drawn on its nearest copy to the chord.
- The **trail** runs centroid to centroid with small arrowheads, fading over the last N chords (default 8). Segments are colored by move type: single P/L/R flip, compound move, or jump.
- **Ghost neighbors:** hovering a triad shows its P, L and R images outlined with their letters.
- **Toggles:** infinite plane (default) vs torus; follow playhead; label as notes vs pitch-class numbers.

### Interaction

| Input | Action |
| --- | --- |
| Click a triangle | Audition that triad and make it current |
| Click a node | Toggle it in the draft chord (build any set) and audition |
| Enter / Shift-click | Append current or draft chord to the sketch at the insert point |
| P, L, R keys | Transform the current triad and audition; with Shift, also append |
| Compound keys | S = slide (LPR), H = hexatonic pole (LPL), N = RLP; user-definable strings |
| Drag, wheel | Pan, zoom (the geometry itself never moves) |

Compound tests, applied left to right from C major: LPR → C#m, LPL → Abm, RLP → Fm.

## DFT panel

The DFT panel computes a 12-point discrete Fourier transform of whatever pitch content is sounding. It reports what *kind* of collection it is and where it sits on the circle of fifths, with no key detection involved.

### The transform

For a weight vector w (weight per pitch class p, default = sounding duration):

`F_k = Σ_{p=0..11} w_p · e^(−2πi·k·p/12),  k = 0..6`

F_0 is the total weight. Magnitudes are normalized as |F_k| / F_0, in [0, 1]. Components 7–11 mirror 1–5 and are ignored. Weight options: duration (default), count doubled notes in the voicing (toggle), and a bass multiplier (default 1).

| k | Period | Reads as | Hits 1.0 on |
| --- | --- | --- | --- |
| 1 | 12 | Chromatic clustering | A single note or tight cluster |
| 2 | 6 semitones | Tritone-axis balance | A tritone pair |
| 3 | 4 semitones | Augmented / hexatonic pull; triads score high | Augmented triad |
| 4 | 3 semitones | Diminished / octatonic pull | Diminished seventh |
| 5 | Fifths | Diatonicity; phase = position on circle of fifths | Single note (diatonic scale ≈ 0.53) |
| 6 | 2 semitones | Whole-tone quality | Whole-tone scale |

### Calibration: phase lands on the circle of fifths for free

With the sign convention above, a single pitch class p gets arg F_5 = −2π·5p/12. Since −5p ≡ 7p (mod 12), that phase times 12/2π is exactly p's circle-of-fifths index (C = 0, G = 1, D = 2 …). Draw index q at q·30° clockwise from the top.

**Gotcha:** a collection's phase points at its *center of mass*, not its tonic. The C major scale (F through B on the line of fifths) centers on **D**. The C major triad sits at 1.5 and A minor at 2.5. Draw two label rings:

- **Outer ring:** single-note names at their own positions.
- **Inner ring:** "diatonic collection" labels, with key X printed two fifths clockwise of X. So "C / Am" appears at D's position.

### Three displays

1. **Fingerprint.** Six small bars for |F_1| … |F_6| of the current chord, plus a matching glyph on every chord in the timeline.
2. **Fifths comet.** A point at angle arg F_5 and radius |F_5|/F_0, computed from a decaying window over recent time: `w_p(t) = ∫ x_p(τ) · 2^(−(t−τ)/H) dτ`. Two comets: *local* (half-life H = 2 beats) and *long* (H = 16 beats), each with a fading tail. Ambiguous or chromatic passages pull toward the center.
3. **Phase torus.** A wrapped square with arg F_3 on x and arg F_5 on y. Each chord is a dot; each move is a wrap-aware segment (shortest way around). Major and minor triads fall on separate diagonal lines.

The same `dft(vector, n)` function, run with n = step count, powers rhythm evenness in the Rhythm scratchpad.

Further reading (unchecked): Ian Quinn and Emmanuel Amiot on the pitch-class DFT; Jason Yust on Fourier phase spaces.

## Rhythm scratchpad

A stack of Euclidean lanes, each drawn as a necklace. Each lane has a role that decides what its hits do to the harmony. A 12-step necklace *is* a pitch-class circle, so the math is shared.

### Lanes

- Each lane is E(k, n) from Bjorklund's algorithm, plus rotation, step length, optional accents, and mute.
- Lanes run polymetrically. Each loops on its own n × stepBeats; the header shows the combined cycle length (LCM).
- **Necklace view:** n dots on a circle, hits filled and joined into a polygon, plus a sweeping playhead. Drag the polygon to rotate; scroll on the necklace to change k.
- **Evenness readout:** |F_k| / k of the onset vector, from `dft(onsets, n)`. It is 1.0 only when k divides n; Euclidean patterns maximize it.

### Lane roles (what a hit does)

| Role | On each hit | Notes |
| --- | --- | --- |
| `drum` | Plays a synthesized kick, snare, hat, rim or click | Accents raise velocity |
| `comp` | Plays the active chord's full voicing | Stabs |
| `arp` | Plays the next chord tone | Order: up, down, up-down, seeded random; octave span 1–3 |
| `bass` | Plays the bass note (or root), optionally alternating with the fifth | Uses `bass` when set |
| `changes` | Advances to the next chord in a pool (sketch chords or a selection) | Re-times harmonic rhythm without editing chords |
| `walker` | Applies the next operator from a string such as `PL` or `LRP` to the current triad | Draws a live Tonnetz path |

### Tonnetz walker

E(3, 8) with operator string `PLR` walks the six triads around one note in tresillo rhythm: the trail circles that single note on the Tonnetz. With `PL` instead, the walker runs the hexatonic cycle (C, Cm, Ab, Abm, E, Em): the trail is a straight strip along the major-thirds axis that drifts on the infinite plane (and closes on the torus), while the long comet sinks to the center (the hexatonic collection is symmetric under major-third transposition, so its F_5 is zero).

- Operators come from a cycling string or a weighted seeded random choice (e.g. P 0.5, L 0.3, R 0.2).
- Output goes to the preview slice, where it plays and draws but can be discarded.
- **Commit** freezes the preview into `ChordEvent`s, each duration equal to the gap between onsets.

### Pitch ↔ rhythm bridge

- **Set → lane:** any pitch-class set becomes a 12-step lane, hits at its members, rotated so a chosen note is step 0. The C major scale gives x.x.xx.x.x.x (the 12/8 bell pattern, a rotation of E(7, 12)).
- **Lane → set:** a 12-step lane becomes a draft chord or scale on the Tonnetz. E(5, 12) is the pentatonic.
- The DFT fingerprint works on both.

Presets: E(3,8), E(5,8), E(7,12), E(5,12), E(5,16), E(4,9), E(7,16). **Tests:** E(3,8) = x..x..x., E(5,8) = x.xx.xx., E(7,12) = x.xx.x.xx.x. — normalize rotation before comparing against Toussaint's published table.

## Chart input, voicing and I/O

Chords come in by typing a chart, clicking or transforming on the Tonnetz, or playing a MIDI keyboard. They leave as live MIDI to Reaper, a .mid file, or saved JSON.

### Chart syntax

```text
@tempo 96
@meter 4/4
# Porter-ish lift, then a hexatonic detour
| Dm7 G7 | Cmaj7 . | Ebmaj7 Ab7 | Dbmaj7 |
| C >P >L >P | [0 4 7 11] | {C E G B} | _ |
| C/E . F G | % |
```

- Bars are split evenly among their tokens.
- `.` holds the previous chord for one slot, `_` is a rest, `%` repeats the previous bar.
- Chord symbols and slash chords are parsed by `tonal`, with `^7` accepted as maj7.
- `[..]` takes raw pitch-class numbers; `{..}` takes note names.
- `>P`, `>L`, `>R`, `>S`, `>H`, `>N` apply an operator to the previous triad.
- **Round trip:** editing text replaces the chords (one undo step); editing chords rewrites the text in canonical form. A parse error underlines the token while the last valid parse keeps playing.

### Auto-voicing

When a chord has no stored voicing, pick one from its pitch-class set and the previous voicing.

1. **Candidates:** every placement of each pitch class within the upper range (default C3–C5, MIDI 48–72), at most ~3^6 combinations.
2. **Cost:** total semitones moved between sorted voices of previous and new voicing, doubling allowed when sizes differ. Penalty for any interval smaller than a third below E3.
3. **Bass:** voiced separately in E1–C3, nearest the previous bass. Uses `bass` if set, else root, else lowest pitch class.
4. **Modes:** `smooth` (default), `close`, `drop2`, `spread`. A voicing can be pinned via the piano strip or MIDI in.

### Transport and sound

- Space plays/stops. Drag on the timeline to set the loop region. Tempo, metronome, one-bar count-in.
- Tone.js Transport schedules all audio. Views read `Transport.seconds` each animation frame and never schedule sound.
- Clicked auditions use a separate synth so they never cut into playback.
- Three patches: FM electric piano, soft pad, pluck.

### MIDI

| Direction | Behavior |
| --- | --- |
| Out (live) | Choose a port. Chords ch 1, arp 2, bass 3, drums 10; editable per lane |
| In (live) | Held notes light the Tonnetz and DFT in real time, overriding the playhead view while held |
| Capture | Sustain pedal (CC64) or Enter commits the held chord, voicing pinned, at the insert point |
| Replay buffer | Last 8 bars of MIDI in are always kept; one click commits them as chord events |
| Export | .mid with one track per lane plus chords |

### Persistence

- Autosave to IndexedDB, debounced ~500 ms, with a sketch list in the sidebar.
- Export/import each sketch as .json and its chart as .txt.
- Optional: bind a folder on disk (File System Access API).

## Layout, interaction and performance

One screen, no modes. Selecting a chord anywhere highlights it in every view.

Layout (top to bottom):

- **Top bar** (full width): play/stop · tempo · meter · loop · sketch name · MIDI in/out ports · undo.
- **Main row:** Tonnetz canvas on the left (~2/3 width, the primary view); DFT panel on the right (~1/3): fifths comet circle on top, fingerprint bars below it, a tab for the phase torus.
- **Timeline** (full width): chord blocks with fingerprint glyphs, loop region, insert point; piano strip under the selected chord.
- **Rhythm lanes** (full width): one row per lane with necklace, E(k, n), rotation, role, mute.
- **Chart drawer:** toggled with C; slides over the DFT column when open. At narrow widths the DFT column moves below the Tonnetz.

### Keyboard map

| Keys | Action |
| --- | --- |
| Space | Play / stop |
| P L R S H N | Transform current triad (Shift also appends) |
| Enter | Commit draft chord, held MIDI chord, or preview |
| Backspace | Delete selected chord |
| Left / Right | Move insert point by one chord |
| [ and ] | Rotate the focused lane |
| C | Toggle chart drawer |
| 1 / 2 / 3 | Focus Tonnetz / DFT / rhythm |
| Ctrl+Z, Ctrl+Shift+Z | Undo, redo |

### Performance budgets

Measured on a 2022 Legion 5 laptop in Chromium. A feature that breaks a budget waits.

| Measure | Budget |
| --- | --- |
| Frame time, all views during playback | ≤ 8 ms |
| Click to audible audition | ≤ 30 ms plus device output latency |
| P/L/R keypress to redraw and sound | Next frame |
| Chart re-parse per keystroke, 64 bars | ≤ 5 ms |
| Dev server running to interactive | ≤ 1 s |

Rendering rules:

- Cache the static lattice and label rings to offscreen canvases; each frame draws only the dynamic layer.
- Redraw a view only when its inputs or the playhead change. Handle devicePixelRatio.
- No allocations in per-frame loops. Recomputing the DFT every frame is fine.
- Audio is scheduled ahead (~100 ms lookahead) by the Transport, never by animation frames.

## Architecture and code layout

Four layers, one rule: only commands change the sketch, and all music math lives in a pure core.

```text
Views  (React chrome + canvases; draw only, never mutate)
  │ commands ↓        ↑ selectors, each frame
State  (Zustand: sketch, preview slice, selection, view prefs;
        every edit is a command with an inverse; derived selectors for time t)
  │ schedule + preview ↓   ↑ playhead time, MIDI in
Engine (Tone.js Transport + synths, Web MIDI out/in, .mid export, IndexedDB)

Core   (pure TS, no DOM, no audio, fully unit-tested; imported by every layer)
```

```text
src/
  core/          pcset.ts  spell.ts  tonnetz.ts  ops.ts  dft.ts  window.ts
                 rhythm.ts  voicing.ts  chart.ts  walker.ts
  state/         store.ts  commands.ts  selectors.ts  persist.ts
  engine/        transport.ts  synths.ts  midi-out.ts  midi-in.ts  export-mid.ts
  views/
    tonnetz/     TonnetzCanvas.tsx  draw.ts  hit-test.ts  embed.ts
    dft/         Comet.tsx  Fingerprint.tsx  Torus.tsx
    timeline/    Timeline.tsx  PianoStrip.tsx
    rhythm/      LaneRow.tsx  Necklace.tsx
    chart/       ChartDrawer.tsx
  app/           App.tsx  keymap.ts  layout.css
tests/core/      one file per core module
```

**Boundary rules** (ESLint `no-restricted-imports`):

- `core/` imports nothing outside `core/`.
- `views/` never imports `engine/`.
- Only `state/commands.ts` mutates the sketch. Each command has `do` and `undo`.

### Testing

Vitest plus property tests (fast-check) on core. Views get a manual smoke checklist per milestone and a frame-time dev overlay.

| Module | Property or fixture |
| --- | --- |
| `ops` | P, L, R are involutions; C → Cm, Am, Em; LPR, LPL, RLP from C give C#m, Abm, Fm |
| `tonnetz` | Triangles contain exactly their triad; period vectors map a node to the same pitch class |
| `spell` | Line-of-fifths index maps F, C, G, F#, Bb to −1, 0, 1, 6, −2 |
| `dft` | Magnitudes unchanged by transposition; single note = 1 for all k; aggregate = 0 for k ≥ 1; augmented |F3| = 1, dim7 |F4| = 1; C major scale phase lands on D |
| `rhythm` | E(k, n) has k hits in n steps; fixtures above; Euclidean patterns maximize |F_k| |
| `voicing` | Stays in range; a repeated chord never moves; motion minimal vs brute force |
| `chart` | parse(print(sketch)) = sketch for random sketches; errors point at the right token |

## Milestones

Each milestone ends in something playable.

1. **M0 — Skeleton and core.** Vite + TS strict, ESLint boundary rules, Vitest, core modules `pcset`, `spell`, `tonnetz`, `ops`, `dft`, `rhythm`. MIDI routing spike into Reaper; document the working route in the README.
   - *Done when:* all fixtures pass, and a note sent from a test page lands on a Reaper track.
2. **M1 — Tonnetz explorer.** Cached lattice with spelled labels, click-to-audition, draft-chord builder, P/L/R/S/H/N keys with ghost neighbors, pan/zoom, torus toggle.
   - *Done when:* PLPLPL walks by keyboard at 60 fps, and any clicked set draws the right hull or capsule.
3. **M2 — Sketch, chart and playback.** Store with commands and undo, chart drawer round trip, auto-voicing, Transport with loop, timeline, Tonnetz trail with path embedding, autosave.
   - *Done when:* a pasted 32-bar set of changes loops, its trail draws and drifts, every edit undoes, reload restores.
4. **M3 — DFT panel.** Fingerprint and timeline glyphs, dual comets with both label rings, phase torus.
   - *Done when:* ii–V–I keeps the long comet in the C/Am region, a half-step lift visibly jumps, a PL cycle collapses the long comet to center.
5. **M4 — Rhythm scratchpad.** Lanes and necklaces, polymeter, drum/comp/arp/bass/changes roles, walker with preview/commit, pitch ↔ rhythm bridge.
   - *Done when:* an E(3,8) `PL` walker plays and draws; commit yields chords timed by onset gaps; C major converts to the bell pattern and back.
6. **M5 — MIDI and export.** Live MIDI out per lane channel, MIDI in with capture and replay buffer, .mid export, optional folder binding.
   - *Done when:* a chord on the 88-key lights the Tonnetz within a frame, four pedal captures become four chords, exported .mid opens in Reaper with one track per lane.

MIDI-in live view could move up into M1 once the M0 spike works.

## Non-goals, later rabbit holes, open questions

### Not in v2

- Automatic key finding or Roman-numeral analysis.
- Chord recognition from audio.
- 3D spaces (Tymoczko's orbifolds, Chew's spiral array).
- The v1 functional lens, and any code ported from v1.
- Notation display, a server, accounts, or sound design beyond three patches.

### Later, sorted by pain

| Idea | Pain | Why |
| --- | --- | --- |
| Tauri desktop wrapper | Low | App icon; no browser tab |
| Keyscape strip (Krumhansl–Schmuckler windows) | Medium | Whole-song tonal architecture at a glance |
| iReal Pro chart import | Medium | Hundreds of standards |
| Seventh-chord operators (Douthett–Steinbach style) | Medium | Jazz voice leading beyond triads |
| MIDI clock sync with Reaper | Medium | Lanes locked to DAW tempo |
| n-EDO generalization (19, 31) | Medium–high | DFT and Euclid already generic over n |
| Tymoczko-style voice-leading space | High | The "true" geometry |

### Open questions

- [ ] React for UI chrome, or plain TS with a few web components? Default: React.
- [ ] Timeline on a beat grid with bars from meter (default), or free beats?
- [ ] Rhythm lanes per sketch (default) or a shared pattern bank?
- [ ] Spelling from lattice position (default), or a per-sketch sharps/flats preference?
- [ ] Which MIDI route into Reaper works on this machine? Answered by the M0 spike.
