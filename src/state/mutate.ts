// The one raw sketch writer. Lint lets only state/commands.ts import it, so
// every sketch change goes through a command (and the undo stack).

import { store, type AppState, type History, type Sketch, type TimelineState } from './store';

export function writeSketch(sketch: Sketch, history?: History, timeline?: Partial<TimelineState>) {
  store.setState((s: AppState) => {
    const next: Partial<AppState> = { sketch };
    if (history) next.history = history;
    // Keep the selection and insert point pointing at chords that exist.
    const t = { ...s.timeline, ...timeline };
    if (t.selection !== null && !sketch.chords.some((c) => c.id === t.selection)) t.selection = null;
    t.insertIndex = Math.max(0, Math.min(t.insertIndex, sketch.chords.length));
    if (t.selection !== s.timeline.selection || t.insertIndex !== s.timeline.insertIndex) next.timeline = t;
    return next;
  });
}
