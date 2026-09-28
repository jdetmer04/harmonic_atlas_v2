// M0 spike: prove the browser's Web MIDI output reaches a Reaper track on this
// machine. Throwaway page; the real engine/midi-out.ts arrives in M5.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusEl = $<HTMLSpanElement>('status');
const outputSel = $<HTMLSelectElement>('output');
const channelSel = $<HTMLSelectElement>('channel');
const outputsList = $<HTMLUListElement>('outputs');
const inputsList = $<HTMLUListElement>('inputs');
const logEl = $<HTMLDivElement>('log');
const buttons = {
  note: $<HTMLButtonElement>('note'),
  chord: $<HTMLButtonElement>('chord'),
  arp: $<HTMLButtonElement>('arp'),
  loopback: $<HTMLButtonElement>('loopback'),
  panic: $<HTMLButtonElement>('panic'),
};

const STORAGE_KEY = 'ha2.midiSpike.output';
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CC = 0xb0;

let access: MIDIAccess | null = null;
let loopbackStart: { note: number; sentAt: number } | null = null;

for (let ch = 1; ch <= 16; ch++) channelSel.add(new Option(String(ch), String(ch)));

function log(line: string) {
  const t = (performance.now() / 1000).toFixed(3).padStart(9);
  logEl.textContent += `${t}  ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function hex(data: ArrayLike<number>) {
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

function setStatus(text: string, kind: 'ok' | 'err' | '') {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function selectedOutput(): MIDIOutput | null {
  return access?.outputs.get(outputSel.value) ?? null;
}

function channel(): number {
  return Number(channelSel.value) - 1;
}

function send(data: number[], at?: number) {
  const out = selectedOutput();
  if (!out) return log('no output selected');
  out.send(data, at);
  const when = at === undefined ? 'now' : `+${Math.round(at - performance.now())} ms`;
  log(`→ ${out.name}  [${hex(data)}]  ${when}`);
}

function playNotes(notes: number[], velocity: number, startIn: number, length: number) {
  const now = performance.now();
  const ch = channel();
  for (const n of notes) {
    send([NOTE_ON | ch, n, velocity], now + startIn);
    send([NOTE_OFF | ch, n, 0], now + startIn + length);
  }
}

function portLine(p: MIDIPort) {
  return `${p.name ?? '(unnamed)'} · ${p.manufacturer || '—'} · ${p.state}/${p.connection}`;
}

function renderPorts() {
  if (!access) return;
  const previous = outputSel.value || readStoredOutput();
  outputSel.replaceChildren();
  outputsList.replaceChildren();
  inputsList.replaceChildren();

  for (const out of access.outputs.values()) {
    outputSel.add(new Option(out.name ?? out.id, out.id));
    outputsList.append(Object.assign(document.createElement('li'), { textContent: portLine(out) }));
  }
  for (const input of access.inputs.values()) {
    inputsList.append(Object.assign(document.createElement('li'), { textContent: portLine(input) }));
    input.onmidimessage = onMessage;
  }
  if (previous && access.outputs.has(previous)) outputSel.value = previous;

  const hasOutput = access.outputs.size > 0;
  for (const b of Object.values(buttons)) b.disabled = !hasOutput;
  if (!hasOutput) setStatus('MIDI access granted, but no output ports. See README routing steps.', 'err');
  else setStatus(`MIDI access granted · ${access.outputs.size} out · ${access.inputs.size} in`, 'ok');
}

function onMessage(this: MIDIInput, e: MIDIMessageEvent) {
  if (!e.data) return;
  const [status = 0, note = 0, velocity = 0] = e.data;
  const isNoteOn = (status & 0xf0) === NOTE_ON && velocity > 0;
  if (loopbackStart && isNoteOn && note === loopbackStart.note) {
    log(`loopback: round trip ${(e.timeStamp - loopbackStart.sentAt).toFixed(2)} ms via ${this.name}`);
    loopbackStart = null;
  }
  log(`← ${this.name}  [${hex(e.data)}]`);
}

function readStoredOutput(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

outputSel.addEventListener('change', () => {
  try {
    localStorage.setItem(STORAGE_KEY, outputSel.value);
  } catch {
    // Per-browser convenience only.
  }
});

buttons.note.addEventListener('click', () => playNotes([60], 100, 0, 500));
buttons.chord.addEventListener('click', () => playNotes([60, 64, 67, 71], 90, 0, 1000));
buttons.arp.addEventListener('click', () => {
  // Scheduled with Web MIDI timestamps, the way the real engine will send ahead.
  [60, 64, 67, 72].forEach((n, i) => playNotes([n], 90, 50 + i * 150, 140));
});
buttons.loopback.addEventListener('click', () => {
  const note = 61;
  loopbackStart = { note, sentAt: performance.now() };
  playNotes([note], 1, 0, 50);
  setTimeout(() => {
    if (loopbackStart?.note === note) {
      log('loopback: nothing came back within 1 s (output is not wired to any input)');
      loopbackStart = null;
    }
  }, 1000);
});
buttons.panic.addEventListener('click', () => {
  for (let ch = 0; ch < 16; ch++) {
    send([CC | ch, 123, 0]); // all notes off
    send([CC | ch, 120, 0]); // all sound off
  }
});

async function init() {
  if (!('requestMIDIAccess' in navigator)) {
    setStatus('This browser has no Web MIDI. Use Firefox 108+ or Chromium.', 'err');
    return;
  }
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (err) {
    setStatus(`MIDI access refused: ${String(err)}. Check the site's MIDI permission in the browser.`, 'err');
    return;
  }
  access.onstatechange = (e) => {
    const port = (e as MIDIConnectionEvent).port;
    if (port) log(`port ${port.type} ${portLine(port)}`);
    renderPorts();
  };
  renderPorts();
}

void init();
