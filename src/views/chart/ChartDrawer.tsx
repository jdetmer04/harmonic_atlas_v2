import { useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { toggleChart } from '../../state/actions';
import { editChart, sealHistory } from '../../state/commands';
import { selectChart } from '../../state/selectors';
import { store } from '../../state/store';

// Chart drawer (SPEC "Chart syntax"): edit the sketch as text. A clean parse
// replaces the chords; a parse error underlines its token while the last valid
// chords keep playing. Errors are drawn in a mirrored backdrop behind a
// transparent textarea, since a textarea can't style ranges.

export function ChartDrawer() {
  const open = useStore(store, (s) => s.view.chartOpen);
  const text = useStore(store, (s) => s.sketch.chartText);
  const parsed = useStore(store, selectChart);
  const backdrop = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const marked: ReactNode[] = [];
  let at = 0;
  const errors = [...parsed.errors].sort((x, y) => x.from - y.from);
  errors.forEach((e, i) => {
    if (e.from < at) return;
    marked.push(text.slice(at, e.from));
    marked.push(
      <mark key={i} title={e.message}>
        {text.slice(e.from, Math.max(e.to, e.from + 1)) || ' '}
      </mark>,
    );
    at = Math.max(e.to, e.from + 1);
  });
  marked.push(text.slice(at) + '\n');

  return (
    <section className="chart-drawer" aria-label="Chart">
      <header>
        <h2>Chart</h2>
        <span className="chart-status">
          {errors.length === 0 ? `${parsed.bars} bars · ${parsed.chords.length} chords` : `${errors.length} error${errors.length > 1 ? 's' : ''} — playing the last valid chart`}
        </span>
        <button type="button" onClick={toggleChart} title="Close (C)">
          ×
        </button>
      </header>
      <div className="chart-editor">
        <div className="chart-backdrop" ref={backdrop} aria-hidden="true">
          {marked}
        </div>
        <textarea
          className="chart-text"
          value={text}
          spellCheck={false}
          autoFocus
          onChange={(e) => editChart(e.target.value)}
          onBlur={sealHistory}
          onScroll={(e) => {
            if (backdrop.current) {
              backdrop.current.scrollTop = e.currentTarget.scrollTop;
              backdrop.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.currentTarget.blur();
              toggleChart();
            }
          }}
        />
      </div>
      {errors.length > 0 && (
        <ul className="chart-errors">
          {errors.map((e, i) => (
            <li key={i}>
              <code>{text.slice(e.from, e.to) || '…'}</code> {e.message}
            </li>
          ))}
        </ul>
      )}
      <details className="chart-help">
        <summary>Syntax</summary>
        <dl>
          <dt>| Dm7 G7 |</dt>
          <dd>Bars split evenly among their chords</dd>
          <dt>.  _  %</dt>
          <dd>Hold one slot · rest · repeat the previous bar</dd>
          <dt>C/E  C^7</dt>
          <dd>Slash bass · ^7 = maj7</dd>
          <dt>[0 4 7]  {'{C E G}'}</dt>
          <dd>Pitch-class numbers · note names</dd>
          <dt>&gt;P &gt;L &gt;R &gt;S &gt;H &gt;N</dt>
          <dd>Transform the previous triad</dd>
          <dt>@tempo 96  @meter 3/4</dt>
          <dd>Tempo and meter · # starts a comment</dd>
        </dl>
      </details>
    </section>
  );
}
