import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { triangleNodes } from '../../src/core/tonnetz';
import {
  ensureVisible,
  panBy,
  toLattice,
  toScreen,
  torusCamera,
  visibleRange,
  zoomAt,
} from '../../src/views/tonnetz/camera';
import { hitTest, nodeRadius } from '../../src/views/tonnetz/hit-test';

const vp = { width: 1200, height: 800 };
const cam = { a: 1, b: 0.5, zoom: 64 };
const px = fc.double({ min: 0, max: 1200, noNaN: true });

describe('camera', () => {
  it('puts the camera center in the middle of the viewport', () => {
    expect(toScreen(cam, vp, cam.a, cam.b)).toEqual({ x: 600, y: 400 });
  });

  it('screen ↔ lattice round-trips', () => {
    fc.assert(
      fc.property(px, px, (x, y) => {
        const l = toLattice(cam, vp, x, y);
        const s = toScreen(cam, vp, l.a, l.b);
        expect(s.x).toBeCloseTo(x, 6);
        expect(s.y).toBeCloseTo(y, 6);
      }),
    );
  });

  it('zoom keeps the point under the cursor fixed and clamps', () => {
    fc.assert(
      fc.property(px, px, fc.double({ min: 0.5, max: 2, noNaN: true }), (x, y, f) => {
        const before = toLattice(cam, vp, x, y);
        const z = zoomAt(cam, vp, x, y, f);
        const after = toLattice(z, vp, x, y);
        expect(after.a).toBeCloseTo(before.a, 6);
        expect(after.b).toBeCloseTo(before.b, 6);
      }),
    );
    expect(zoomAt(cam, vp, 0, 0, 100).zoom).toBe(200);
    expect(zoomAt(cam, vp, 0, 0, 0.01).zoom).toBe(24);
  });

  it('panning moves content with the pointer', () => {
    const moved = panBy(cam, 30, -20);
    const s = toScreen(moved, vp, 3, 2);
    const s0 = toScreen(cam, vp, 3, 2);
    expect(s.x - s0.x).toBeCloseTo(30, 6);
    expect(s.y - s0.y).toBeCloseTo(-20, 6);
  });

  it('visible range covers every corner', () => {
    const r = visibleRange(cam, vp, 0);
    for (const [x, y] of [[0, 0], [1200, 0], [0, 800], [1200, 800]] as const) {
      const l = toLattice(cam, vp, x, y);
      expect(l.a).toBeGreaterThanOrEqual(r.aMin);
      expect(l.a).toBeLessThanOrEqual(r.aMax);
      expect(l.b).toBeGreaterThanOrEqual(r.bMin);
      expect(l.b).toBeLessThanOrEqual(r.bMax);
    }
  });

  it('ensureVisible leaves visible nodes alone and pulls in distant ones', () => {
    const near = triangleNodes({ a: 1, b: 0, orient: 'up' });
    expect(ensureVisible(cam, vp, near, 60)).toBe(cam);
    const far = triangleNodes({ a: 30, b: 0, orient: 'up' });
    const moved = ensureVisible(cam, vp, far, 60);
    for (const n of far) {
      const s = toScreen(moved, vp, n.a, n.b);
      expect(s.x).toBeGreaterThanOrEqual(60 - 1e-6);
      expect(s.x).toBeLessThanOrEqual(1200 - 60 + 1e-6);
    }
    // Minimal move: the far triangle ends up at the right margin, not centered.
    const right = Math.max(...far.map((n) => toScreen(moved, vp, n.a, n.b).x));
    expect(right).toBeCloseTo(1140, 6);
  });

  it('torus camera fits the whole domain', () => {
    const t = torusCamera(vp);
    for (const [a, b] of [[0, 0], [4, 0], [0, 3], [4, 3]] as const) {
      const s = toScreen(t, vp, a, b);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1200);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(800);
    }
  });
});

describe('hit test', () => {
  it('hits a node near its center, a triangle elsewhere', () => {
    const n = toScreen(cam, vp, 2, 1);
    expect(hitTest(cam, vp, n.x + 2, n.y - 2, false)).toEqual({ kind: 'node', node: { a: 2, b: 1 } });
    const c = toScreen(cam, vp, 2 + 1 / 3, 1 + 1 / 3); // centroid of up(2,1)
    expect(hitTest(cam, vp, c.x, c.y, false)).toEqual({ kind: 'triangle', triangle: { a: 2, b: 1, orient: 'up' } });
    expect(nodeRadius(64)).toBeLessThan(64 / 2);
  });

  it('outside the torus domain hits nothing', () => {
    const t = torusCamera(vp);
    const outside = toScreen(t, vp, -1, -1);
    expect(hitTest(t, vp, outside.x, outside.y, true)).toBeNull();
  });
});
