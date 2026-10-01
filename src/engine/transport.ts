// Playback. The Tone.js Transport schedules every note (SPEC "Transport and
// sound"); nothing here schedules audio from animation frames. The engine
// listens to state: the sketch (re-scheduled whenever it changes, even while
// playing) and the transport flags (play/stop, metronome, count-in).

import * as Tone from 'tone';
import { barBeats } from '../core/chart';
import { setChordIndex } from '../state/actions';
import { sketchEnd } from '../state/commands';
import { chordIndexAt, selectVoicings } from '../state/selectors';
import { store, type AppState, type Sketch } from '../state/store';
import { playChord, playClick, releasePlayback, startAudio } from './synths';

/** Chords release a hair before the next one, so repeated chords re-strike cleanly. */
const LEGATO = 0.985;
const VELOCITY = 0.7;

const transport = () => Tone.getTransport();
const ticks = (beats: number) => `${Math.round(beats * transport().PPQ)}i`;

/** The loop region, or the whole sketch rounded up to a bar. */
export function loopRange(sk: Sketch): [number, number] {
  if (sk.loop) return sk.loop;
  const bar = barBeats(sk.meter);
  return [0, Math.max(bar, Math.ceil(sketchEnd(sk.chords) / bar - 1e-9) * bar)];
}

let scheduled: number[] = [];

function schedule(s: AppState) {
  const t = transport();
  for (const id of scheduled) t.clear(id);
  scheduled = [];

  const sk = s.sketch;
  const bar = barBeats(sk.meter);
  t.bpm.value = sk.tempo;
  t.timeSignature = bar;
  const [loopStart, loopEnd] = loopRange(sk);
  t.setLoopPoints(ticks(loopStart), ticks(loopEnd));
  t.loop = true;
  if (t.state === 'started') {
    // A moved loop region that no longer contains the playhead takes it back to its start.
    const now = t.getTicksAtTime(Tone.now()) / t.PPQ;
    if (now < loopStart || now >= loopEnd) t.ticks = Math.round(loopStart * t.PPQ);
  }

  const voicings = selectVoicings(s);
  const patch = sk.patch;
  sk.chords.forEach((c, i) => {
    const notes = voicings[i] ?? [];
    // Clip to the loop; a chord already sounding at the loop start re-strikes there.
    const from = Math.max(c.start, loopStart);
    const to = Math.min(c.start + c.dur, loopEnd);
    if (to <= from) return;
    const dur = Tone.Ticks(Math.round((to - from) * t.PPQ * LEGATO));
    scheduled.push(t.schedule((time) => playChord(patch, notes, dur.toSeconds(), time, VELOCITY), ticks(from)));
  });

  scheduled.push(
    t.scheduleRepeat(
      (time) => {
        if (!store.getState().transport.metronome) return;
        const beat = Math.round(t.getTicksAtTime(time) / t.PPQ);
        playClick(time, beat % bar === 0);
      },
      '4n',
      0,
    ),
  );
}

/**
 * The playhead in beats, as heard: the Transport position at the current
 * audio time minus the output latency. Null when stopped. Cheap enough to
 * call every frame.
 */
export function getBeat(): number | null {
  const t = transport();
  if (t.state !== 'started') return null;
  const raw = Tone.getContext().rawContext as AudioContext;
  const heard = Tone.immediate() - (raw.outputLatency || 0);
  return Math.max(0, t.getTicksAtTime(heard) / t.PPQ);
}

let frame = 0;

function watchPlayhead() {
  cancelAnimationFrame(frame);
  const tick = () => {
    const s = store.getState();
    if (!s.transport.playing) return;
    const beat = getBeat();
    const i = beat === null ? -1 : chordIndexAt(s.sketch.chords, beat);
    setChordIndex(i < 0 ? null : i);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

async function start() {
  await startAudio();
  const s = store.getState();
  if (!s.transport.playing) return; // stopped again while audio was starting
  const t = transport();
  schedule(s);
  t.ticks = Math.round(loopRange(s.sketch)[0] * t.PPQ);
  if (s.transport.countIn) {
    // One bar of clicks on the audio clock, then the Transport starts on the next downbeat.
    const now = Tone.now();
    const beat = 60 / s.sketch.tempo;
    const n = Math.max(1, Math.round(barBeats(s.sketch.meter)));
    for (let i = 0; i < n; i++) playClick(now + i * beat, i === 0);
    t.start(now + n * beat);
  } else {
    t.start();
  }
  watchPlayhead();
}

function stop() {
  const t = transport();
  t.stop();
  releasePlayback();
  cancelAnimationFrame(frame);
  setChordIndex(null);
}

/** Wire the Transport to state. Returns an unsubscribe. */
export function startTransport(): () => void {
  schedule(store.getState());
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.transport.playing !== prev.transport.playing) {
      if (s.transport.playing) void start();
      else stop();
    }
    const a = s.sketch;
    const b = prev.sketch;
    if (
      a.chords !== b.chords ||
      a.tempo !== b.tempo ||
      a.meter !== b.meter ||
      a.loop !== b.loop ||
      a.patch !== b.patch ||
      a.voicingMode !== b.voicingMode
    ) {
      schedule(s);
    }
  });
  return () => {
    unsubscribe();
    stop();
  };
}
