import { useStore } from 'zustand';
import { toPcs } from '../../core/pcset';
import { setCustomOpsText } from '../../state/actions';
import { selectCustomOps, selectDisplay } from '../../state/selectors';
import { store } from '../../state/store';

// Right column until the DFT panel arrives in M3: what is lit, and the keys.

export function ChordReadout() {
  const display = useStore(store, selectDisplay);
  const lastMove = useStore(store, (s) => s.explorer.lastMove);
  const opsText = useStore(store, (s) => s.view.customOpsText);
  const customOps = useStore(store, selectCustomOps);

  return (
    <aside className="readout">
      <section>
        <div className="readout-source">{sourceLabel(display.source)}</div>
        <div className="readout-name">{display.name || '—'}</div>
        {display.hint && <div className="readout-hint">= {display.hint}</div>}
        <div className="readout-pcs">{display.pcs ? `{${toPcs(display.pcs).join(' ')}}` : ''}</div>
        {lastMove && display.source === 'explorer' && <div className="readout-move">via {lastMove}</div>}
      </section>

      <section className="keys">
        <h2>Keys</h2>
        <dl>
          <dt>P L R</dt>
          <dd>Flip the current triad</dd>
          <dt>S H N</dt>
          <dd>Slide (LPR), hexatonic pole (LPL), RLP</dd>
          <dt>Click</dt>
          <dd>Triangle: make current · Node: add/remove</dd>
          <dt>Drag · Wheel</dt>
          <dd>Pan · Zoom</dd>
          <dt>Esc</dt>
          <dd>Clear</dd>
          <dt>`</dt>
          <dd>Frame-time overlay</dd>
        </dl>
      </section>

      <section>
        <h2>
          <label htmlFor="custom-ops">Custom keys</label>
        </h2>
        <input
          id="custom-ops"
          className="custom-ops"
          placeholder="Q=PRL, W=LRLR"
          value={opsText}
          onChange={(e) => setCustomOpsText(e.target.value)}
          spellCheck={false}
        />
        {Object.keys(customOps.bindings).length > 0 && (
          <div className="custom-ops-ok">
            {Object.entries(customOps.bindings)
              .map(([k, v]) => `${k} → ${v}`)
              .join(' · ')}
          </div>
        )}
        {customOps.errors.map((err) => (
          <div key={err} className="custom-ops-err">
            {err}
          </div>
        ))}
      </section>
    </aside>
  );
}

function sourceLabel(source: string): string {
  if (source === 'midi') return 'MIDI in (held)';
  if (source === 'explorer') return 'Current';
  return 'Click a triangle or press P, L, R';
}
