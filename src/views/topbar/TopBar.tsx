import { useState } from 'react';
import { useStore } from 'zustand';
import { barBeats, type Meter } from '../../core/chart';
import { VOICING_MODES, type VoicingMode } from '../../core/voicing';
import {
  selectMidiInput,
  setAutoPan,
  setCountIn,
  setLabels,
  setMetronome,
  setPlaying,
  setTorus,
  toggleChart,
  toggleFrameOverlay,
} from '../../state/actions';
import { redo, renameSketch, setLoop, setMeter, setPatch, setTempo, setVoicingMode, undo } from '../../state/commands';
import { store, type Patch } from '../../state/store';

const METERS: Meter[] = [
  [4, 4],
  [3, 4],
  [2, 4],
  [5, 4],
  [6, 8],
  [7, 8],
  [12, 8],
];

const PATCHES: { id: Patch; name: string }[] = [
  { id: 'epiano', name: 'E-piano' },
  { id: 'pad', name: 'Pad' },
  { id: 'pluck', name: 'Pluck' },
];

export function TopBar() {
  const live = useStore(store, (s) => s.live);
  const view = useStore(store, (s) => s.view);
  const transport = useStore(store, (s) => s.transport);
  const sketch = useStore(store, (s) => s.sketch);
  const canUndo = useStore(store, (s) => s.history.past.length > 0);
  const canRedo = useStore(store, (s) => s.history.future.length > 0);

  const bar = barBeats(sketch.meter);
  const loopText = sketch.loop
    ? `${formatBar(sketch.loop[0] / bar + 1)}–${formatBar(sketch.loop[1] / bar + 1)}`
    : 'all';

  return (
    <header className="topbar">
      <span className="brand">Harmonic Atlas</span>

      <div className="group">
        <button
          type="button"
          className={transport.playing ? 'play on' : 'play'}
          onClick={() => setPlaying(!transport.playing)}
          title="Play / stop (Space)"
        >
          {transport.playing ? '■ Stop' : '▶ Play'}
        </button>
        <TempoInput tempo={sketch.tempo} />
        <select
          value={`${sketch.meter[0]}/${sketch.meter[1]}`}
          onChange={(e) => {
            const [n, d] = e.target.value.split('/').map(Number);
            setMeter([n as number, d as number]);
          }}
          title="Meter"
        >
          {METERS.map(([n, d]) => (
            <option key={`${n}/${d}`}>{`${n}/${d}`}</option>
          ))}
        </select>
        <span className="field" title="Drag in the timeline ruler to set the loop; click the ruler to clear it">
          Loop {loopText}
          {sketch.loop && (
            <button type="button" className="mini" onClick={() => setLoop(null)} title="Clear loop">
              ×
            </button>
          )}
        </span>
        <Toggle label="Click" on={transport.metronome} onChange={setMetronome} title="Metronome" />
        <Toggle label="Count-in" on={transport.countIn} onChange={setCountIn} title="One bar of clicks before playing" />
      </div>

      <div className="group">
        <input
          className="sketch-name"
          value={sketch.name}
          onChange={(e) => renameSketch(e.target.value)}
          aria-label="Sketch name"
          spellCheck={false}
        />
        <select value={sketch.patch} onChange={(e) => setPatch(e.target.value as Patch)} title="Sound">
          {PATCHES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={sketch.voicingMode}
          onChange={(e) => setVoicingMode(e.target.value as VoicingMode)}
          title="Auto-voicing"
        >
          {VOICING_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => undo()} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button type="button" onClick={() => redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <Toggle label="Chart" on={view.chartOpen} onChange={() => toggleChart()} title="Chart drawer (C)" />
      </div>

      <label className="field">
        MIDI in
        <select
          value={live.inputId ?? ''}
          onChange={(e) => selectMidiInput(e.target.value || null)}
          disabled={live.midiStatus !== 'ready'}
        >
          <option value="">{midiPlaceholder(live.midiStatus, live.inputs.length)}</option>
          {live.inputs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {live.held.length > 0 && <span className="held-dot" title="Notes held" />}
      </label>

      <div className="toggles">
        <Toggle label="Torus" on={view.torus} onChange={setTorus} />
        <Toggle label="Numbers" on={view.labels === 'pcs'} onChange={(on) => setLabels(on ? 'pcs' : 'notes')} />
        <Toggle label="Follow" on={view.autoPan} onChange={setAutoPan} title="Keep the current / playing chord in view" />
        <Toggle label="Frame time" on={view.frameOverlay} onChange={() => toggleFrameOverlay()} />
      </div>
    </header>
  );
}

/** Commits on Enter or blur, so typing "120" doesn't pass through 1 and 12 bpm. */
function TempoInput({ tempo }: { tempo: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && Number.isFinite(Number(draft)) && draft.trim() !== '') setTempo(Number(draft));
    setDraft(null);
  };
  return (
    <label className="field" title="Tempo (bpm)">
      <input
        className="tempo"
        type="number"
        min={20}
        max={400}
        value={draft ?? tempo}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      bpm
    </label>
  );
}

function formatBar(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0+$/, '');
}

function midiPlaceholder(status: string, count: number): string {
  if (status === 'pending') return 'Connecting…';
  if (status === 'unavailable') return 'No Web MIDI in this browser';
  if (status === 'denied') return 'MIDI permission denied';
  return count === 0 ? 'No inputs' : 'None';
}

function Toggle(props: { label: string; on: boolean; onChange: (on: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      className={props.on ? 'toggle on' : 'toggle'}
      aria-pressed={props.on}
      title={props.title}
      onClick={() => props.onChange(!props.on)}
    >
      {props.label}
    </button>
  );
}
