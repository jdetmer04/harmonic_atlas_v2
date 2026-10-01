// Audio voices. Auditions have their own PolySynth so they never cut into
// playback; playback uses the sketch's patch (SPEC: FM electric piano, soft
// pad, pluck) plus a click for the metronome and count-in.

import * as Tone from 'tone';
import type { Patch } from '../state/store';

// Created at load, suspended until the first user gesture resumes it.
Tone.setContext(new Tone.Context({ latencyHint: 'interactive' }));

let audition: Tone.PolySynth<Tone.FMSynth> | null = null;

const EPIANO = {
  harmonicity: 3,
  modulationIndex: 8,
  oscillator: { type: 'sine' },
  modulation: { type: 'sine' },
  envelope: { attack: 0.002, decay: 1.4, sustain: 0.25, release: 1.2 },
  modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.1, release: 0.6 },
} as const;

function auditionSynth(): Tone.PolySynth<Tone.FMSynth> {
  if (!audition) {
    const volume = new Tone.Volume(-14).toDestination();
    audition = new Tone.PolySynth(Tone.FMSynth, EPIANO).connect(volume);
    audition.maxPolyphony = 32;
  }
  return audition;
}

// Playback patches, built on first use.

type AnySynth = Tone.PolySynth<Tone.FMSynth> | Tone.PolySynth<Tone.Synth>;
const patches = new Map<Patch, AnySynth>();

function buildPatch(patch: Patch): AnySynth {
  switch (patch) {
    case 'epiano': {
      const synth = new Tone.PolySynth(Tone.FMSynth, EPIANO).connect(new Tone.Volume(-15).toDestination());
      synth.maxPolyphony = 48;
      return synth;
    }
    case 'pad': {
      const filter = new Tone.Filter(1400, 'lowpass').connect(new Tone.Volume(-24).toDestination());
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
        envelope: { attack: 0.35, decay: 0.6, sustain: 0.75, release: 1.4 },
      }).connect(filter);
      synth.maxPolyphony = 48;
      return synth;
    }
    case 'pluck': {
      const filter = new Tone.Filter(2600, 'lowpass').connect(new Tone.Volume(-13).toDestination());
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.002, decay: 0.45, sustain: 0.04, release: 0.35 },
      }).connect(filter);
      synth.maxPolyphony = 48;
      return synth;
    }
  }
}

export function patchSynth(patch: Patch): AnySynth {
  let synth = patches.get(patch);
  if (!synth) {
    synth = buildPatch(patch);
    patches.set(patch, synth);
  }
  return synth;
}

/** Play MIDI notes on a patch at an audio-context time (from the Transport). */
export function playChord(patch: Patch, notes: readonly number[], seconds: number, time: number, velocity = 0.7) {
  if (notes.length === 0 || seconds <= 0) return;
  patchSynth(patch).triggerAttackRelease(
    notes.map((n) => Tone.Frequency(n, 'midi').toFrequency()),
    seconds,
    time,
    velocity,
  );
}

export function releasePlayback(time?: number) {
  for (const synth of patches.values()) synth.releaseAll(time);
}

let click: Tone.Synth | null = null;

/** Metronome / count-in tick; accented on the downbeat. */
export function playClick(time: number, accent: boolean) {
  click ??= new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
  }).connect(new Tone.Volume(-22).toDestination());
  click.triggerAttackRelease(accent ? 1760 : 1175, 0.03, time, accent ? 1 : 0.6);
}

/** Resume the audio context. Browsers only allow this inside a user gesture. */
export async function startAudio(): Promise<void> {
  if (Tone.getContext().state !== 'running') await Tone.start();
}

export function audioRunning(): boolean {
  return Tone.getContext().state === 'running';
}

/**
 * Play MIDI notes now, cutting off the previous audition. Uses
 * Tone.immediate(), not Tone.now(): now() adds the context's scheduling
 * lookahead, which would blow the ≤ 30 ms click-to-sound budget.
 */
export function playAudition(notes: readonly number[], seconds = 1.4) {
  if (notes.length === 0) return;
  const play = () => {
    const synth = auditionSynth();
    const t = Tone.immediate();
    synth.releaseAll(t);
    synth.triggerAttackRelease(
      notes.map((n) => Tone.Frequency(n, 'midi').toFrequency()),
      seconds,
      t,
      0.75,
    );
  };
  if (audioRunning()) play();
  else void startAudio().then(play);
}
