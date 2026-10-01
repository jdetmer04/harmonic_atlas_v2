import { useEffect, useRef } from 'react';
import { selectedIndex, selectVoicings } from '../../state/selectors';
import { store, type AppState } from '../../state/store';
import { recordDraw } from '../dev/frameStats';

// Piano strip: the voicing of the playing chord, else the selected one.
// Read-only in M2 (pinning a voicing comes later). Redraws only on change.

const LOW = 28; // E1, bottom of the bass range
const HIGH = 79; // G5, above the upper range
const BLACK = new Set([1, 3, 6, 8, 10]);

const C = {
  white: '#d9dbe0',
  black: '#24262c',
  gap: '#15161a',
  upper: '#e0a458',
  bass: '#7fd18b',
  label: '#80858f',
};

export function PianoStrip() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return mountPiano(canvas);
  }, []);
  return <canvas ref={canvasRef} className="piano-canvas" aria-label="Voicing" />;
}

function shownVoicing(s: AppState): number[] | null {
  const i = s.transport.playing && s.transport.chordIndex !== null ? s.transport.chordIndex : selectedIndex(s);
  return i >= 0 ? (selectVoicings(s)[i] ?? null) : null;
}

function mountPiano(canvas: HTMLCanvasElement): () => void {
  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) throw new Error('Canvas 2D unavailable');
  const ctx: CanvasRenderingContext2D = ctxOrNull;
  let width = 1;
  let height = 1;
  let dpr = window.devicePixelRatio || 1;
  let last: number[] | null | undefined;
  let frame = 0;

  const whites: number[] = [];
  for (let n = LOW; n <= HIGH; n++) if (!BLACK.has(n % 12)) whites.push(n);

  function draw(force = false) {
    frame = 0;
    const voicing = shownVoicing(store.getState());
    if (!force && voicing === last) return;
    last = voicing;
    const t0 = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.gap;
    ctx.fillRect(0, 0, width, height);
    const lit = new Map<number, string>();
    voicing?.forEach((n, i) => lit.set(n, i === 0 ? C.bass : C.upper));

    const w = width / whites.length;
    whites.forEach((n, i) => {
      ctx.fillStyle = lit.get(n) ?? C.white;
      ctx.fillRect(i * w + 0.5, 0, w - 1, height);
      if (n % 12 === 0) {
        ctx.fillStyle = C.label;
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`C${n / 12 - 1}`, i * w + w / 2, height - 1);
      }
    });
    let wi = 0;
    for (let n = LOW; n <= HIGH; n++) {
      if (!BLACK.has(n % 12)) {
        wi++;
        continue;
      }
      ctx.fillStyle = lit.get(n) ?? C.black;
      ctx.fillRect(wi * w - w * 0.3, 0, w * 0.6, height * 0.6);
    }
    recordDraw(performance.now() - t0, 'piano');
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw(true);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const unsubscribe = store.subscribe(() => {
    if (!frame) frame = requestAnimationFrame(() => draw());
  });
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    unsubscribe();
  };
}
