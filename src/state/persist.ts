// View prefs survive reloads via localStorage. (Sketch autosave to IndexedDB
// arrives with the sketch in M2.)

import { DEFAULT_VIEW, store, type ViewPrefs } from './store';

const KEY = 'ha2.view.v1';

export function loadViewPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_VIEW;
    const saved = JSON.parse(raw) as Partial<ViewPrefs>;
    return { ...DEFAULT_VIEW, ...saved, camera: { ...DEFAULT_VIEW.camera, ...saved.camera } };
  } catch {
    return DEFAULT_VIEW;
  }
}

/** Save view prefs ~500 ms after they stop changing. Returns an unsubscribe. */
export function autosaveViewPrefs(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return store.subscribe((s, prev) => {
    if (s.view === prev.view) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(s.view));
      } catch {
        // Private window or blocked storage: prefs just don't persist.
      }
    }, 500);
  });
}
