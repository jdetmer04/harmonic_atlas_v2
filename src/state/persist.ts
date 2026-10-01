// Persistence. App-wide view prefs live in localStorage; sketches autosave to
// IndexedDB ~500 ms after they stop changing (SPEC "Persistence"), and the
// last one opened comes back on reload.

import { loadSketch } from './commands';
import { setLibrary } from './actions';
import { reviveCamera, reviveSketch } from './revive';
import {
  DEFAULT_CAMERA,
  DEFAULT_VIEW,
  emptySketch,
  store,
  type Camera,
  type Sketch,
  type SketchSummary,
  type ViewPrefs,
} from './store';

const VIEW_KEY = 'ha2.view.v2';
const OLD_VIEW_KEY = 'ha2.view.v1'; // M1 kept the camera in here
const LAST_KEY = 'ha2.lastSketch';
const DEBOUNCE_MS = 500;

// View prefs (localStorage)

export function loadViewPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(VIEW_KEY) ?? localStorage.getItem(OLD_VIEW_KEY);
    if (!raw) return DEFAULT_VIEW;
    const saved = JSON.parse(raw) as Partial<ViewPrefs>;
    const out = { ...DEFAULT_VIEW };
    for (const k of Object.keys(DEFAULT_VIEW) as (keyof ViewPrefs)[]) {
      if (typeof saved[k] === typeof DEFAULT_VIEW[k]) (out as Record<string, unknown>)[k] = saved[k];
    }
    return out;
  } catch {
    return DEFAULT_VIEW;
  }
}

/** The camera M1 saved, used once for the first sketch after upgrading. */
function legacyCamera(): Camera {
  try {
    const raw = localStorage.getItem(OLD_VIEW_KEY);
    const cam = raw ? (JSON.parse(raw) as { camera?: Partial<Camera> }).camera : undefined;
    return cam ? reviveCamera(cam) : DEFAULT_CAMERA;
  } catch {
    return DEFAULT_CAMERA;
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
        localStorage.setItem(VIEW_KEY, JSON.stringify(s.view));
      } catch {
        // Private window or blocked storage: prefs just don't persist.
      }
    }, DEBOUNCE_MS);
  });
}

// IndexedDB

interface SketchRecord {
  id: string;
  name: string;
  updated: number;
  sketch: Sketch;
}

const DB_NAME = 'harmonic-atlas-v2';
const STORE = 'sketches';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null); // Blocked storage: the app still runs, it just won't remember.
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function request<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return db().then(
    (d) =>
      new Promise<T | null>((resolve) => {
        if (!d) {
          resolve(null);
          return;
        }
        try {
          const req = fn(d.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

async function allRecords(): Promise<SketchRecord[]> {
  return ((await request<SketchRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SketchRecord[]>)) ?? []).sort(
    (x, y) => y.updated - x.updated,
  );
}

function summarize(records: SketchRecord[]): SketchSummary[] {
  return records.map(({ id, name, updated }) => ({ id, name, updated }));
}

export async function saveSketch(sketch: Sketch): Promise<void> {
  const record: SketchRecord = { id: sketch.id, name: sketch.name, updated: Date.now(), sketch };
  await request('readwrite', (s) => s.put(record));
  rememberLast(sketch.id);
  const others = store.getState().library.filter((x) => x.id !== sketch.id);
  setLibrary([{ id: record.id, name: record.name, updated: record.updated }, ...others]);
}

export async function openSketch(id: string): Promise<boolean> {
  await flushAutosave();
  const record = await request<SketchRecord>('readonly', (s) => s.get(id) as IDBRequest<SketchRecord>);
  const sketch = record ? reviveSketch(record.sketch) : null;
  if (!sketch) return false;
  loadSketch(sketch);
  rememberLast(id);
  return true;
}

export async function deleteSketch(id: string): Promise<void> {
  await request('readwrite', (s) => s.delete(id));
  setLibrary(store.getState().library.filter((x) => x.id !== id));
}

function rememberLast(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // ignore
  }
}

function lastId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** Open the last sketch (or the newest, or a fresh one) and fill the library list. */
export async function restoreSession(): Promise<void> {
  const records = await allRecords();
  setLibrary(summarize(records));
  const want = lastId();
  const record = records.find((r) => r.id === want) ?? records[0];
  const sketch = record ? reviveSketch(record.sketch) : null;
  loadSketch(sketch ?? emptySketch(undefined, legacyCamera()));
}

let pending: { timer: ReturnType<typeof setTimeout>; sketch: Sketch } | null = null;

async function flushAutosave(): Promise<void> {
  if (!pending) return;
  const { timer, sketch } = pending;
  clearTimeout(timer);
  pending = null;
  await saveSketch(sketch);
}

/** Autosave the sketch ~500 ms after it stops changing; empty untitled sketches aren't saved. Returns an unsubscribe. */
export function autosaveSketch(): () => void {
  const unsub = store.subscribe((s, prev) => {
    if (s.sketch === prev.sketch) return;
    if (pending) clearTimeout(pending.timer);
    if (prev.sketch.id !== s.sketch.id) pending = null; // switched sketches; the old one was flushed on open
    const sketch = s.sketch;
    const worthSaving = sketch.chords.length > 0 || sketch.name !== 'Untitled' || store.getState().library.some((x) => x.id === sketch.id);
    if (!worthSaving) return;
    pending = { sketch, timer: setTimeout(() => void flushAutosave(), DEBOUNCE_MS) };
  });
  const onHide = () => void flushAutosave();
  window.addEventListener('pagehide', onHide);
  return () => {
    unsub();
    window.removeEventListener('pagehide', onHide);
  };
}
