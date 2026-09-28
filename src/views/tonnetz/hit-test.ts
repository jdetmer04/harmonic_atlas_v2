// What is under the pointer: a node (if close to one) or a triangle.

import { triangleAt, triangleNodes, type Coord, type Triangle } from '../../core/tonnetz';
import type { Camera } from '../../state/store';
import { inTorusDomain, toLattice, toScreen, type Viewport } from './camera';

export type Hit = { kind: 'node'; node: Coord } | { kind: 'triangle'; triangle: Triangle } | null;

/** Node circle radius in CSS pixels at a given zoom. */
export function nodeRadius(zoom: number): number {
  return Math.min(18, Math.max(5, zoom * 0.2));
}

export function hitTest(cam: Camera, vp: Viewport, x: number, y: number, torus: boolean): Hit {
  const p = toLattice(cam, vp, x, y);
  if (torus && !inTorusDomain(p)) return null;
  const triangle = triangleAt(p.a, p.b);
  // The nearest node is always one of the containing triangle's corners.
  const grab = nodeRadius(cam.zoom) + 3;
  for (const n of triangleNodes(triangle)) {
    const s = toScreen(cam, vp, n.a, n.b);
    if (Math.hypot(s.x - x, s.y - y) <= grab) return { kind: 'node', node: n };
  }
  return { kind: 'triangle', triangle };
}
