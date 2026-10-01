import { useStore } from 'zustand';
import { newSketch } from '../../state/commands';
import { deleteSketch, openSketch } from '../../state/persist';
import { store } from '../../state/store';

// Saved sketches (autosaved to IndexedDB), newest first.

export function SketchList() {
  const library = useStore(store, (s) => s.library);
  const currentId = useStore(store, (s) => s.sketch.id);
  const currentName = useStore(store, (s) => s.sketch.name);
  const unsaved = !library.some((x) => x.id === currentId);

  return (
    <section className="sketch-list">
      <h2>
        Sketches
        <button type="button" className="mini" onClick={() => newSketch()} title="Start a new sketch">
          + New
        </button>
      </h2>
      <ul>
        {unsaved && (
          <li className="current">
            <span>{currentName}</span>
            <span className="muted">unsaved until it has a chord</span>
          </li>
        )}
        {library.map((x) => (
          <li key={x.id} className={x.id === currentId ? 'current' : undefined}>
            <button type="button" className="link" onClick={() => void openSketch(x.id)} disabled={x.id === currentId}>
              {x.id === currentId ? currentName : x.name}
            </button>
            <span className="muted">{ago(x.updated)}</span>
            <button
              type="button"
              className="mini"
              title="Delete"
              onClick={() => {
                if (confirm(`Delete "${x.name}"? This can't be undone.`)) {
                  void deleteSketch(x.id).then(() => {
                    if (x.id === store.getState().sketch.id) newSketch();
                  });
                }
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
