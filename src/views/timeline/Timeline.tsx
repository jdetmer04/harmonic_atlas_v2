import { useEffect, useRef } from 'react';
import { barBeats, chordText } from '../../core/chart';
import { triadOf } from '../../core/ops';
import { selectChord, setInsertIndex } from '../../state/actions';
import { insertBeat, sealHistory, setLoop, sketchEnd } from '../../state/commands';
import { selectVoicings } from '../../state/selectors';
import { store, type AppState, type ChordEvent } from '../../state/store';
import { useAudition, type Audition } from '../audition';
import { recordDraw } from '../dev/frameStats';
import { usePlayhead, type Playhead } from '../playhead';

// Timeline (SPEC "Layout"): chord blocks on a bar/beat grid, the loop region
// in the ruler, the insert point and the playhead. The grid, blocks and labels
// are cached offscreen; each frame during playback only blits that and draws
// the playhead.

export function Timeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audition = useAudition();
  const playhead = usePlayhead();
  const deps = useRef({ audition, playhead });
  useEffect(() => {
    deps.current = { audition, playhead };
  }, [audition, playhead]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return mountTimeline(
      canvas,
      (notes) => deps.current.audition(notes),
      () => deps.current.playhead(),
    );
  }, []);

  return <canvas ref={canvasRef} className="timeline-canvas" aria-label="Timeline" />;
}

const RULER_H = 18;
const BLOCK_TOP = 22;
const BLOCK_H = 46;
const PAD = 10;
const MIN_PX_PER_BEAT = 18;
const MIN_BARS = 8;

const C = {
  background: '#17181c',
  ruler: '#1d1f25',
  bar: 'rgba(255,255,255,0.16)',
  beat: 'rgba(255,255,255,0.05)',
  barLabel: '#80858f',
  loop: 'rgba(224,164,88,0.30)',
  loopShade: 'rgba(224,164,88,0.06)',
  major: 'rgba(224,164,88,0.38)',
  minor: 'rgba(95,168,211,0.38)',
  other: 'rgba(180,142,173,0.32)',
  blockEdge: 'rgba(255,255,255,0.18)',
  label: '#e6e6e6',
  selected: '#f2f2f2',
  insert: '#e0a458',
  playing: 'rgba(255,255,255,0.16)',
  playhead: '#7fd18b',
};

interface Layout {
  ppb: number; // CSS px per beat
  scroll: number; // beats at the left edge
  total: number; // beats of content
  bar: number;
}

function mountTimeline(canvas: HTMLCanvasElement, audition: Audition, playhead: Playhead): () => void {
  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) throw new Error('Canvas 2D unavailable');
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  let width = 1;
  let height = 1;
  let dpr = window.devicePixelRatio || 1;
  let scroll = 0;
  let frame = 0;
  const cache = document.createElement('canvas');
  let cacheKey: unknown[] = [];
  let drag: { from: number; moved: boolean; x: number } | null = null;

  function layout(s: AppState): Layout {
    const bar = barBeats(s.sketch.meter);
    const end = Math.max(sketchEnd(s.sketch.chords) + bar, s.sketch.loop?.[1] ?? 0, MIN_BARS * bar);
    const total = Math.ceil(end / bar) * bar;
    const ppb = Math.max(MIN_PX_PER_BEAT, (width - 2 * PAD) / total);
    const maxScroll = Math.max(0, total - (width - 2 * PAD) / ppb);
    scroll = Math.max(0, Math.min(scroll, maxScroll));
    return { ppb, scroll, total, bar };
  }

  const xAt = (l: Layout, beat: number) => PAD + (beat - l.scroll) * l.ppb;
  const beatAt = (l: Layout, x: number) => (x - PAD) / l.ppb + l.scroll;

  function blockFill(c: ChordEvent): string {
    const t = triadOf(c.pcs);
    return !t ? C.other : t.quality === 'maj' ? C.major : C.minor;
  }

  /** Grid, loop band, chord blocks with labels, selection and insert point. */
  function drawCached(s: AppState, l: Layout) {
    const key = [s.sketch.chords, s.sketch.meter, s.sketch.loop, s.timeline.selection, s.timeline.insertIndex, width, height, dpr, l.scroll, l.ppb];
    if (key.length === cacheKey.length && key.every((k, i) => k === cacheKey[i])) return;
    cacheKey = key;
    cache.width = Math.round(width * dpr);
    cache.height = Math.round(height * dpr);
    const g = cache.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.background;
    g.fillRect(0, 0, width, height);
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, width, RULER_H);

    // Loop region: band in the ruler, faint shade over the blocks.
    const loop = s.sketch.loop;
    if (loop) {
      const x0 = xAt(l, loop[0]);
      const x1 = xAt(l, loop[1]);
      g.fillStyle = C.loop;
      g.fillRect(x0, 2, x1 - x0, RULER_H - 4);
      g.fillStyle = C.loopShade;
      g.fillRect(x0, RULER_H, x1 - x0, height - RULER_H);
    }

    // Grid: beat ticks, bar lines and numbers.
    const firstBeat = Math.floor(l.scroll);
    const lastBeat = Math.ceil(beatAt(l, width));
    const labelEvery = l.bar * l.ppb < 26 ? 4 : 1;
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    for (let beat = firstBeat; beat <= Math.min(lastBeat, l.total); beat++) {
      const x = Math.round(xAt(l, beat)) + 0.5;
      const barIndex = beat / l.bar;
      const isBar = Math.abs(barIndex - Math.round(barIndex)) < 1e-9;
      g.fillStyle = isBar ? C.bar : C.beat;
      g.fillRect(x, isBar ? 0 : RULER_H, 1, isBar ? height : height - RULER_H);
      if (isBar && Math.round(barIndex) % labelEvery === 0 && beat < l.total) {
        g.fillStyle = C.barLabel;
        g.fillText(String(Math.round(barIndex) + 1), x + 3, RULER_H / 2 + 1);
      }
    }

    // Chord blocks.
    const sel = s.timeline.selection;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    for (const c of s.sketch.chords) {
      const x0 = xAt(l, c.start) + 1;
      const x1 = xAt(l, c.start + c.dur) - 1;
      if (x1 < 0 || x0 > width) continue;
      g.fillStyle = blockFill(c);
      roundRect(g, x0, BLOCK_TOP, x1 - x0, BLOCK_H, 4);
      g.fill();
      g.strokeStyle = c.id === sel ? C.selected : C.blockEdge;
      g.lineWidth = c.id === sel ? 2 : 1;
      g.stroke();
      const label = fitLabel(g, chordText(c), x1 - x0 - 8);
      if (label) {
        g.fillStyle = C.label;
        g.fillText(label, x0 + 5, BLOCK_TOP + BLOCK_H / 2);
      }
    }

    // Insert point: a caret between blocks.
    const ix = Math.round(xAt(l, insertBeat(s.sketch.chords, s.timeline.insertIndex)));
    g.fillStyle = C.insert;
    g.fillRect(ix - 1, BLOCK_TOP - 3, 2, BLOCK_H + 6);
    g.beginPath();
    g.moveTo(ix - 5, BLOCK_TOP - 5);
    g.lineTo(ix + 5, BLOCK_TOP - 5);
    g.lineTo(ix, BLOCK_TOP + 1);
    g.closePath();
    g.fill();
  }

  function draw() {
    frame = 0;
    const t0 = performance.now();
    const s = store.getState();
    const beat = s.transport.playing ? playhead() : null;
    let l = layout(s);
    // Keep the playhead in view: page forward when it runs off the right.
    if (beat !== null) {
      const x = xAt(l, beat);
      if (x > width - PAD || x < PAD) {
        scroll = Math.max(0, beat - 1);
        l = layout(s);
      }
    }
    drawCached(s, l);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const i = s.transport.playing ? s.transport.chordIndex : null;
    const playing = i !== null ? s.sketch.chords[i] : undefined;
    if (playing) {
      const x0 = xAt(l, playing.start) + 1;
      ctx.fillStyle = C.playing;
      roundRect(ctx, x0, BLOCK_TOP, xAt(l, playing.start + playing.dur) - 1 - x0, BLOCK_H, 4);
      ctx.fill();
    }
    if (beat !== null) {
      const x = Math.round(xAt(l, beat)) + 0.5;
      ctx.fillStyle = C.playhead;
      ctx.fillRect(x - 1, 0, 2, height);
    }
    recordDraw(performance.now() - t0, 'timeline');
    if (s.transport.playing) requestDraw();
  }

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    requestDraw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const unsubscribe = store.subscribe(requestDraw);

  // Pointer input

  const local = (e: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Loops snap to bars; hold Shift for beats. */
  function snap(l: Layout, beat: number, fine: boolean): number {
    const step = fine ? 1 : l.bar;
    return Math.max(0, Math.min(l.total, Math.round(beat / step) * step));
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const s = store.getState();
    const l = layout(s);
    const p = local(e);
    const beat = beatAt(l, p.x);
    if (p.y < RULER_H) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Dragging still works inside the canvas.
      }
      drag = { from: snap(l, beat, e.shiftKey), moved: false, x: p.x };
      return;
    }
    const chords = s.sketch.chords;
    const hit = chords.findIndex((c) => beat >= c.start && beat < c.start + c.dur);
    if (hit >= 0) {
      const c = chords[hit] as ChordEvent;
      selectChord(c.id);
      const v = selectVoicings(store.getState())[hit];
      if (v) audition(v);
      return;
    }
    // Empty space: move the insert point to the nearest chord boundary.
    let best = chords.length;
    let bestD = Infinity;
    for (let i = 0; i <= chords.length; i++) {
      const d = Math.abs(insertBeat(chords, i) - beat);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    }
    setInsertIndex(best);
  }

  function onPointerMove(e: PointerEvent) {
    const p = local(e);
    canvas.style.cursor = p.y < RULER_H ? 'col-resize' : 'pointer';
    if (!drag) return;
    if (!drag.moved && Math.abs(p.x - drag.x) < 4) return;
    drag.moved = true;
    const l = layout(store.getState());
    const to = snap(l, beatAt(l, p.x), e.shiftKey);
    setLoop(to === drag.from ? null : [drag.from, to]);
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (wasClick) setLoop(null); // a click in the ruler clears the loop
    sealHistory(); // one drag, one undo step
  }

  function onWheel(e: WheelEvent) {
    const l = layout(store.getState());
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    const before = scroll;
    scroll += (delta * lines) / l.ppb;
    layout(store.getState());
    if (scroll !== before) {
      e.preventDefault();
      requestDraw();
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    unsubscribe();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}

const LABEL_FONT = '600 12px system-ui, sans-serif';
const SMALL_FONT = '600 10px system-ui, sans-serif';

/**
 * The block label at a size that fits, else its root and "…". Never a clipped
 * name: "Cmaj7" cut to "Cm" would read as a different chord. Leaves the font
 * set for the caller's fillText.
 */
function fitLabel(g: CanvasRenderingContext2D, text: string, room: number): string | null {
  if (room < 6) return null;
  g.font = LABEL_FONT;
  if (g.measureText(text).width <= room) return text;
  g.font = SMALL_FONT;
  if (g.measureText(text).width <= room) return text;
  const root = /^[A-G][#b]*/.exec(text)?.[0];
  const short = root ? `${root}…` : '…';
  return g.measureText(short).width <= room ? short : null;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
