// Static-layer cache for the infinite plane, in world-anchored tiles.
//
// A full-viewport rebuild of the lattice (hundreds of labels) costs tens of
// milliseconds with software Canvas 2D, so the plane is cut into fixed tiles
// in world space (world = lattice position × zoom). Panning only ever renders
// the few tiles that come into view, and a ring just outside the viewport is
// filled in ahead of time, within a per-frame time budget. During a zoom
// gesture the existing tiles are scaled; they re-render at the new zoom once
// the gesture settles.

import { fromXY, toXY, type Coord } from '../../core/tonnetz';
import type { Camera, LabelMode } from '../../state/store';
import type { Viewport } from './camera';
import { drawStatic } from './draw';

const TILE = 256; // CSS pixels
const RING = 1; // tiles prefetched beyond the viewport

export interface TileDrawResult {
  /** Camera nudged so tiles land on whole device pixels; draw the dynamic layer with it. */
  cam: Camera;
  /** Tiles rendered this frame, and how long they took. */
  rendered: number;
  renderMs: number;
  /** Prefetch ran out of budget; call again next frame to finish. */
  pending: boolean;
}

export class LatticeTiles {
  private tiles = new Map<string, HTMLCanvasElement>();
  private spare: HTMLCanvasElement[] = [];
  private baseZoom = 0;
  private style = '';

  clear() {
    for (const t of this.tiles.values()) if (this.spare.length < 64) this.spare.push(t);
    this.tiles.clear();
  }

  /**
   * Draw the lattice for `cam` into `ctx` (CSS-pixel transform already set).
   * `settled` is false mid-zoom, when scaling old tiles beats rendering new ones.
   * Prefetch stops once `performance.now()` passes `prefetchDeadline`.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    vp: Viewport,
    dpr: number,
    labels: LabelMode,
    settled: boolean,
    prefetchDeadline: number,
  ): TileDrawResult {
    const style = `${labels}@${dpr}`;
    if (style !== this.style || this.baseZoom === 0) {
      this.clear();
      this.style = style;
      this.baseZoom = cam.zoom;
    } else if (settled && cam.zoom !== this.baseZoom) {
      this.clear();
      this.baseZoom = cam.zoom;
    }
    const z0 = this.baseZoom;
    const k = cam.zoom / z0;

    // Screen = k·world + offset, with world measured at the tiles' zoom.
    const cw = toXY(cam.a, cam.b, z0);
    let ox = vp.width / 2 - k * cw.x;
    let oy = vp.height / 2 - k * cw.y;
    let drawCam = cam;
    if (k === 1) {
      ox = Math.round(ox * dpr) / dpr;
      oy = Math.round(oy * dpr) / dpr;
      const snapped: Coord = fromXY(vp.width / 2 - ox, vp.height / 2 - oy, z0);
      drawCam = { a: snapped.a, b: snapped.b, zoom: cam.zoom };
    }

    // Visible tile range in world space.
    const i0 = Math.floor(-ox / k / TILE);
    const i1 = Math.floor((vp.width - ox) / k / TILE);
    const j0 = Math.floor(-oy / k / TILE);
    const j1 = Math.floor((vp.height - oy) / k / TILE);

    let rendered = 0;
    const t0 = performance.now();
    const size = TILE * k;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        let tile = this.tiles.get(key(i, j));
        if (!tile) {
          tile = this.render(i, j, dpr, labels);
          rendered++;
        }
        ctx.drawImage(tile, ox + i * size, oy + j * size, size, size);
      }
    }

    // Prefetch the surrounding ring while there is time left this frame.
    let pending = false;
    if (settled) {
      outer: for (let i = i0 - RING; i <= i1 + RING; i++) {
        for (let j = j0 - RING; j <= j1 + RING; j++) {
          if (this.tiles.has(key(i, j))) continue;
          if (performance.now() >= prefetchDeadline) {
            pending = true;
            break outer;
          }
          this.render(i, j, dpr, labels);
          rendered++;
        }
      }
      this.evict(i0 - RING - 2, i1 + RING + 2, j0 - RING - 2, j1 + RING + 2);
    }
    return { cam: drawCam, rendered, renderMs: performance.now() - t0, pending };
  }

  private render(i: number, j: number, dpr: number, labels: LabelMode): HTMLCanvasElement {
    const canvas = this.spare.pop() ?? document.createElement('canvas');
    const px = Math.round(TILE * dpr);
    if (canvas.width !== px) canvas.width = px;
    if (canvas.height !== px) canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // A camera centered on the tile draws exactly its world rectangle.
      const c = fromXY((i + 0.5) * TILE, (j + 0.5) * TILE, this.baseZoom);
      drawStatic(ctx, { cam: { a: c.a, b: c.b, zoom: this.baseZoom }, vp: { width: TILE, height: TILE }, torus: false, labels });
    }
    this.tiles.set(key(i, j), canvas);
    return canvas;
  }

  /** Drop tiles well outside the current view, keeping their canvases for reuse. */
  private evict(iMin: number, iMax: number, jMin: number, jMax: number) {
    for (const [k, tile] of this.tiles) {
      const [i, j] = k.split(',').map(Number) as [number, number];
      if (i < iMin || i > iMax || j < jMin || j > jMax) {
        this.tiles.delete(k);
        if (this.spare.length < 64) this.spare.push(tile);
      }
    }
  }
}

function key(i: number, j: number): string {
  return `${i},${j}`;
}
