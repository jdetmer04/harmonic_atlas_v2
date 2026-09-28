import { useStore } from 'zustand';
import { selectMidiInput, setAutoPan, setLabels, setTorus, toggleFrameOverlay } from '../../state/actions';
import { store } from '../../state/store';

export function TopBar() {
  const live = useStore(store, (s) => s.live);
  const view = useStore(store, (s) => s.view);

  return (
    <header className="topbar">
      <span className="brand">Harmonic Atlas</span>

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
        <Toggle label="Auto-pan" on={view.autoPan} onChange={setAutoPan} />
        <Toggle label="Frame time" on={view.frameOverlay} onChange={() => toggleFrameOverlay()} />
      </div>
    </header>
  );
}

function midiPlaceholder(status: string, count: number): string {
  if (status === 'pending') return 'Connecting…';
  if (status === 'unavailable') return 'No Web MIDI (use Chromium)';
  if (status === 'denied') return 'MIDI permission denied';
  return count === 0 ? 'No inputs' : 'None';
}

function Toggle(props: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className={props.on ? 'toggle on' : 'toggle'}
      aria-pressed={props.on}
      onClick={() => props.onChange(!props.on)}
    >
      {props.label}
    </button>
  );
}
