// Audio. M1 has only the audition voice: an FM electric piano on its own
// PolySynth, so auditions never cut into playback (which arrives in M2).

import * as Tone from 'tone';

// Created at load, suspended until the first user gesture resumes it.
Tone.setContext(new Tone.Context({ latencyHint: 'interactive' }));

let audition: Tone.PolySynth<Tone.FMSynth> | null = null;

function auditionSynth(): Tone.PolySynth<Tone.FMSynth> {
  if (!audition) {
    const volume = new Tone.Volume(-14).toDestination();
    audition = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 8,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: { attack: 0.002, decay: 1.4, sustain: 0.25, release: 1.2 },
      modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.1, release: 0.6 },
    }).connect(volume);
    audition.maxPolyphony = 32;
  }
  return audition;
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
