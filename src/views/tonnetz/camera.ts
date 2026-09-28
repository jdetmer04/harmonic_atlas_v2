// Camera math: lattice ↔ canvas pixels. The geometry never moves; the camera does.

import { centroid, fromXY, toXY, type Coord } from '../../core/tonnetz';
import type { Camera } from '../../state/store';

export interface Viewport {
  width: number; // CSS pixels
  height: number;
}

export function toScreen(cam: Camera, vp: Viewport, a: number, b: number): { x: number; y: number } {
  const p = toXY(a - cam.a, b - cam.b, cam.zoom);
  return { x: vp.width / 2 + p.x, y: vp.height / 2 + p.y };
}

export function toLattice(cam: Camera, vp: Viewport, x: number, y: number): Coord {
  const d = fromXY(x - vp.width / 2, y - vp.height / 2, cam.zoom);
  return { a: cam.a + d.a, b: cam.b + d.b };
}

/** Integer lattice bounds covering the viewport plus `marginPx` on every side. */
export function visibleRange(cam: Camera, vp: Viewport, marginPx: number) {
  const corners = [
    toLattice(cam, vp, -marginPx, -marginPx),
    toLattice(cam, vp, vp.width + marginPx, -marginPx),
    toLattice(cam, vp, -marginPx, vp.height + marginPx),
    toLattice(cam, vp, vp.width + marginPx, vp.height + marginPx),
  ];
  return {
    aMin: Math.floor(Math.min(...corners.map((c) => c.a))) - 1,
    aMax: Math.ceil(Math.max(...corners.map((c) => c.a))) + 1,
    bMin: Math.floor(Math.min(...corners.map((c) => c.b))) - 1,
    bMax: Math.ceil(Math.max(...corners.map((c) => c.b))) + 1,
  };
}

export const MIN_ZOOM = 24;
export const MAX_ZOOM = 200;

/** Zoom by `factor` keeping the lattice point under (x, y) fixed. */
export function zoomAt(cam: Camera, vp: Viewport, x: number, y: number, factor: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  const before = toLattice(cam, vp, x, y);
  const after = toLattice({ ...cam, zoom }, vp, x, y);
  return { a: cam.a + before.a - after.a, b: cam.b + before.b - after.b, zoom };
}

/** Drag by (dx, dy) pixels: the content follows the pointer. */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  const d = fromXY(dx, dy, cam.zoom);
  return { ...cam, a: cam.a - d.a, b: cam.b - d.b };
}

/**
 * The smallest camera move that brings every node at least `marginPx` inside
 * the viewport. If the nodes can't all fit, centers on their centroid.
 * Returns `cam` itself when nothing needs to move.
 */
export function ensureVisible(cam: Camera, vp: Viewport, nodes: readonly Coord[], marginPx: number): Camera {
  if (nodes.length === 0) return cam;
  const pts = nodes.map((n) => toScreen(cam, vp, n.a, n.b));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  if (maxX - minX > vp.width - 2 * marginPx || maxY - minY > vp.height - 2 * marginPx) {
    const c = centroid(nodes);
    return { ...cam, a: c.a, b: c.b };
  }
  const shift = (lo: number, hi: number, size: number) =>
    lo < marginPx ? lo - marginPx : hi > size - marginPx ? hi - (size - marginPx) : 0;
  const dx = shift(minX, maxX, vp.width);
  const dy = shift(minY, maxY, vp.height);
  if (dx === 0 && dy === 0) return cam;
  return panBy(cam, -dx, -dy);
}

// Torus: the fundamental domain a ∈ [0,4), b ∈ [0,3), fitted to the viewport.

export const TORUS_A = 4;
export const TORUS_B = 3;

export function torusCamera(vp: Viewport, paddingPx = 48): Camera {
  // Domain corners at s = 1 span x ∈ [0, 5.5], y ∈ [−2.6, 0].
  const w = TORUS_A + TORUS_B / 2;
  const h = (TORUS_B * Math.sqrt(3)) / 2;
  const zoom = Math.max(MIN_ZOOM, Math.min((vp.width - 2 * paddingPx) / w, (vp.height - 2 * paddingPx) / h));
  // The parallelogram's center.
  return { a: TORUS_A / 2, b: TORUS_B / 2, zoom };
}

export function inTorusDomain(p: Coord): boolean {
  return p.a >= 0 && p.a < TORUS_A && p.b >= 0 && p.b < TORUS_B;
}
