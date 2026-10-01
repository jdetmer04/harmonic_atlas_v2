import { useEffect, useRef } from 'react';
import { closeVoicing } from '../../core/voicing';
import { chordPcs, selectTriangle, setHover, toggleNode } from '../../state/actions';
import { setCamera } from '../../state/commands';
import { selectDisplay } from '../../state/selectors';
import { store, type Camera } from '../../state/store';
import { useAudition, type Audition } from '../audition';
import { recordDraw, recordRebuild } from '../dev/frameStats';
import { ensureVisible, panBy, torusCamera, zoomAt, type Viewport } from './camera';
import { COLORS, drawDynamic, drawStatic, type Scene } from './draw';
import { hitTest } from './hit-test';
import { LatticeTiles } from './tiles';

export function TonnetzCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audition = useAudition();
  const auditionRef = useRef(audition);
  useEffect(() => {
    auditionRef.current = audition;
  }, [audition]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return mountTonnetz(canvas, (notes) => auditionRef.current(notes));
  }, []);

  return <canvas ref={canvasRef} className="tonnetz-canvas" aria-label="Tonnetz" />;
}

const DRAG_THRESHOLD = 4;
const AUTO_PAN_MS = 180;
const ZOOM_SETTLE_MS = 150;
/** Per-frame time allowed for prefetching lattice tiles outside the view. */
const PREFETCH_MS = 3;

function mountTonnetz(canvas: HTMLCanvasElement, audition: Audition): () => void {
  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) throw new Error('Canvas 2D unavailable');
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  let vp: Viewport = { width: 1, height: 1 };
  let dpr = window.devicePixelRatio || 1;
  const tiles = new LatticeTiles();
  let torusCache: { canvas: HTMLCanvasElement; key: string } | null = null;
  let frame = 0;
  let zooming = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let anim: { from: Camera; to: Camera; start: number } | null = null;
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null;

  // Camera

  function viewCamera(now: number): Camera {
    const s = store.getState();
    if (s.view.torus) return torusCamera(vp);
    if (!anim) return s.sketch.view.camera;
    const t = Math.min(1, (now - anim.start) / AUTO_PAN_MS);
    const e = 1 - (1 - t) ** 3;
    return {
      a: anim.from.a + (anim.to.a - anim.from.a) * e,
      b: anim.from.b + (anim.to.b - anim.from.b) * e,
      zoom: anim.to.zoom,
    };
  }

  function cancelAnim() {
    if (!anim) return;
    const cam = viewCamera(performance.now());
    anim = null;
    setCamera(cam);
  }

  // Rendering

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  /** The torus never pans, so one full-view bitmap is its whole static layer. */
  function drawTorusStatic(scene: Scene) {
    const key = `${scene.labels}|${vp.width}x${vp.height}@${dpr}`;
    if (torusCache?.key !== key) {
      const t0 = performance.now();
      const c = torusCache?.canvas ?? document.createElement('canvas');
      c.width = Math.round(vp.width * dpr);
      c.height = Math.round(vp.height * dpr);
      const cctx = c.getContext('2d');
      if (cctx) {
        cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawStatic(cctx, scene);
      }
      torusCache = { canvas: c, key };
      recordRebuild(performance.now() - t0);
    }
    ctx.drawImage(torusCache.canvas, 0, 0, vp.width, vp.height);
  }

  function draw(now: number) {
    frame = 0;
    const t0 = performance.now();
    const s = store.getState();
    let scene: Scene = { cam: viewCamera(now), vp, torus: s.view.torus, labels: s.view.labels };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (scene.torus) {
      drawTorusStatic(scene);
    } else {
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, vp.width, vp.height);
      const res = tiles.draw(ctx, scene.cam, vp, dpr, scene.labels, !zooming, t0 + PREFETCH_MS);
      scene = { ...scene, cam: res.cam };
      if (res.rendered > 0) recordRebuild(res.renderMs);
      if (res.pending) requestDraw();
    }
    drawDynamic(ctx, scene, { display: selectDisplay(s), hover: s.explorer.hover });
    recordDraw(performance.now() - t0);

    if (anim) {
      if (now - anim.start >= AUTO_PAN_MS) {
        const to = anim.to;
        anim = null;
        setCamera(to);
      } else requestDraw();
    }
  }

  // Size and pixel ratio

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    vp = { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    canvas.width = Math.round(vp.width * dpr);
    canvas.height = Math.round(vp.height * dpr);
    requestDraw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const dprQuery = () => window.matchMedia(`(resolution: ${dpr}dppx)`);
  let dprMedia = dprQuery();
  const onDprChange = () => {
    dprMedia.removeEventListener('change', onDprChange);
    resize();
    dprMedia = dprQuery();
    dprMedia.addEventListener('change', onDprChange);
  };
  dprMedia.addEventListener('change', onDprChange);
  resize();

  // State changes: redraw, and keep the lit chord in view.

  const unsubscribe = store.subscribe((s, prev) => {
    requestDraw();
    const moved = s.explorer.current !== prev.explorer.current || s.live.placed !== prev.live.placed;
    if (!moved || !s.view.autoPan || s.view.torus || drag) return;
    const nodes = selectDisplay(s).nodes;
    const from = anim ? anim.to : s.sketch.view.camera;
    const to = ensureVisible(from, vp, nodes, Math.max(60, from.zoom * 1.2));
    if (to !== from) {
      anim = { from: viewCamera(performance.now()), to, start: performance.now() };
      requestDraw();
    }
  });

  // Pointer input

  function local(e: PointerEvent | WheelEvent) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    cancelAnim();
    try {
      // Keeps a drag going outside the canvas. Best-effort: it throws if the
      // pointer is no longer active, which must not cost us the click.
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Drag still works inside the canvas.
    }
    const p = local(e);
    drag = { id: e.pointerId, x: p.x, y: p.y, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    const p = local(e);
    const s = store.getState();
    if (drag && drag.id === e.pointerId) {
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!drag.moved) canvas.classList.add('dragging');
      drag.moved = true;
      drag.x = p.x;
      drag.y = p.y;
      if (!s.view.torus) setCamera(panBy(s.sketch.view.camera, dx, dy));
      return;
    }
    const hit = hitTest(viewCamera(performance.now()), vp, p.x, p.y, s.view.torus);
    setHover(hit?.kind === 'triangle' ? hit.triangle : null);
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    const wasClick = !drag.moved;
    drag = null;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!wasClick) return;
    const p = local(e);
    const s = store.getState();
    const hit = hitTest(viewCamera(performance.now()), vp, p.x, p.y, s.view.torus);
    if (!hit) return;
    const chord = hit.kind === 'node' ? toggleNode(hit.node) : selectTriangle(hit.triangle);
    if (chord) audition(closeVoicing(chordPcs(chord)));
  }

  function onPointerLeave() {
    if (!drag) setHover(null);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const s = store.getState();
    if (s.view.torus) return;
    cancelAnim();
    const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    const p = local(e);
    // Scale the existing lattice while the wheel moves; re-render once it stops.
    zooming = true;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      zooming = false;
      requestDraw();
    }, ZOOM_SETTLE_MS);
    setCamera(zoomAt(s.sketch.view.camera, vp, p.x, p.y, Math.exp(-e.deltaY * lines * 0.0015)));
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(settleTimer);
    observer.disconnect();
    dprMedia.removeEventListener('change', onDprChange);
    unsubscribe();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('wheel', onWheel);
  };
}
