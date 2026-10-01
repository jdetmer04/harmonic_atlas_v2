import { useStore } from 'zustand';
import { toPcs } from '../../core/pcset';
import { setCustomOpsText } from '../../state/actions';
import { selectCustomOps, selectDisplay } from '../../state/selectors';
import { store } from '../../state/store';
import { SketchList } from '../library/SketchList';

// Right column until the DFT panel arrives in M3: what is lit, the keys, and the sketch list.

export function ChordReadout() {
  const display = useStore(store, selectDisplay);
  const lastMove = useStore(store, (s) => s.explorer.lastMove);
  const opsText = useStore(store, (s) => s.view.customOpsText);
  const customOps = useStore(store, selectCustomOps);

  return (
    <aside className="readout">
      <section>
        <div className="readout-source">{sourceLabel(display.source)}</div>
        <div className="readout-name">{display.label ?? (display.name || '—')}</div>
        {display.label && display.name && <div className="readout-spelled">{display.name}</div>}
        {display.hint && <div className="readout-hint">= {display.hint}</div>}
        <div className="readout-pcs">{display.pcs ? `{${toPcs(display.pcs).join(' ')}}` : ''}</div>
        {lastMove && display.source === 'explorer' && <div className="readout-move">via {lastMove}</div>}
      </section>

      <SketchList />

      <section className="keys">
        <h2>Keys</h2>
        <dl>
          <dt>P L R</dt>
          <dd>Flip the current triad (Shift: also append)</dd>
          <dt>S H N</dt>
          <dd>Slide (LPR), hexatonic pole (LPL), RLP</dd>
          <dt>Click</dt>
          <dd>Triangle: make current · Node: add/remove</dd>
          <dt>Enter · Shift-click</dt>
          <dd>Append the current chord at the insert point</dd>
          <dt>Space</dt>
          <dd>Play / stop</dd>
          <dt>← →</dt>
          <dd>Move the insert point</dd>
          <dt>Backspace</dt>
          <dd>Delete the selected chord</dd>
          <dt>Ctrl+Z · Ctrl+Shift+Z</dt>
          <dd>Undo · redo</dd>
          <dt>C</dt>
          <dd>Chart drawer</dd>
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
  if (source === 'playhead') return 'Playing';
  return 'Click a triangle or press P, L, R';
}
