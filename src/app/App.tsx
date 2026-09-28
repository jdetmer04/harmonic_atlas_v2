import { useEffect } from 'react';
import { startMidiIn } from '../engine/midi-in';
import { playAudition, startAudio } from '../engine/synths';
import { AuditionContext } from '../views/audition';
import { FrameOverlay } from '../views/dev/FrameOverlay';
import { ChordReadout } from '../views/readout/ChordReadout';
import { TonnetzCanvas } from '../views/tonnetz/TonnetzCanvas';
import { TopBar } from '../views/topbar/TopBar';
import { installKeymap } from './keymap';

// app/ is the only layer that sees both engine/ and views/: it hands views
// the audition function and wires keys and MIDI in.

export function App() {
  useEffect(() => installKeymap(playAudition), []);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void startMidiIn().then((fn) => {
      if (cancelled) fn();
      else stop = fn;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  // Browsers only start audio inside a user gesture; do it on the first one so
  // later auditions are instant.
  useEffect(() => {
    const unlock = () => void startAudio();
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };
  }, []);

  return (
    <AuditionContext.Provider value={playAudition}>
      <div className="app">
        <TopBar />
        <main className="main-row">
          <section className="tonnetz-pane">
            <TonnetzCanvas />
            <FrameOverlay />
          </section>
          <ChordReadout />
        </main>
      </div>
    </AuditionContext.Provider>
  );
}
