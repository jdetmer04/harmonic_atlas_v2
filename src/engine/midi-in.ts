// Live MIDI in: track physically held notes on the chosen input and report
// them to state. The sustain pedal is ignored for now; M5 uses it for capture.

import { selectMidiInput, setHeld, setMidiInputs, setMidiStatus } from '../state/actions';
import { store } from '../state/store';

const STORAGE_KEY = 'ha2.midiIn';
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CC = 0xb0;
const ALL_NOTES_OFF = 123;

export async function startMidiIn(): Promise<() => void> {
  if (!('requestMIDIAccess' in navigator)) {
    setMidiStatus('unavailable');
    return () => {};
  }
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    setMidiStatus('denied');
    return () => {};
  }
  setMidiStatus('ready');

  const held = new Set<number>();
  let bound: MIDIInput | null = null;

  function onMessage(e: MIDIMessageEvent) {
    if (!e.data) return;
    const [status = 0, d1 = 0, d2 = 0] = e.data;
    const type = status & 0xf0;
    if (type === NOTE_ON && d2 > 0) held.add(d1);
    else if (type === NOTE_OFF || type === NOTE_ON) held.delete(d1);
    else if (type === CC && d1 === ALL_NOTES_OFF) held.clear();
    else return;
    setHeld([...held]);
  }

  function bind(id: string | null) {
    if (bound) bound.onmidimessage = null;
    bound = id ? (access.inputs.get(id) ?? null) : null;
    if (bound) bound.onmidimessage = onMessage;
    held.clear();
    setHeld([]);
  }

  function refresh() {
    const inputs = [...access.inputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id }));
    setMidiInputs(inputs);
    const current = store.getState().live.inputId;
    if (current && access.inputs.has(current)) {
      // A reconnected device can come back as a new port object.
      if (bound !== access.inputs.get(current)) bind(current);
      return;
    }
    // First run or the chosen port vanished: prefer the saved port, then any
    // real controller over the loopback "Midi Through".
    const saved = readSaved();
    const pick =
      inputs.find((p) => p.id === saved) ?? inputs.find((p) => !/through/i.test(p.name)) ?? null;
    selectMidiInput(pick?.id ?? null);
  }

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.live.inputId === prev.live.inputId) return;
    bind(s.live.inputId);
    if (s.live.inputId) save(s.live.inputId);
  });

  access.onstatechange = refresh;
  refresh();
  bind(store.getState().live.inputId);

  return () => {
    unsubscribe();
    access.onstatechange = null;
    if (bound) bound.onmidimessage = null;
  };
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function save(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Remembering the port is a convenience only.
  }
}
