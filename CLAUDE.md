# Harmonic Atlas v2

Local Vite + TypeScript web app: Tonnetz, pitch-class DFT and Euclidean rhythm views for sketching harmonic ideas. Full spec: @SPEC.md

## Working rules

- Build one milestone at a time (see SPEC.md "Milestones"). Don't start the next milestone until the current one's "Done when" criteria pass and I've tried it.
- Before writing code for a milestone, propose a short plan (files, order, open questions) and wait for my OK.
- This is a from-scratch rewrite. Do not copy or port code from the v1 project.
- Respect the architecture boundaries: `core/` is pure (no DOM, no audio, imports nothing outside `core/`); `views/` never import `engine/`; only `state/commands.ts` mutates the sketch.
- All music math goes in `core/` with Vitest tests. Use the fixtures listed in SPEC.md "Testing"; if a fixture looks wrong, stop and tell me rather than changing it to make tests pass.
- Keep the performance budgets in SPEC.md. Views draw on Canvas 2D; audio is scheduled only by the Tone.js Transport.
- Ask before adding dependencies beyond: react, zustand, tone, tonal, @tonejs/midi, vitest, fast-check, eslint.

## Commands

- `npm run dev` — dev server (open in Chromium)
- `npm test` — Vitest
- `npm run lint` — ESLint (includes import-boundary rules)
- `npm run build` — type-check + production build

## Environment

Pop!_OS (KDE), Chromium for Web MIDI, Reaper on PipeWire/JACK as the DAW.
