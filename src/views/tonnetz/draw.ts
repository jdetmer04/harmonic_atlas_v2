// Tonnetz drawing. Two layers:
//   static  — lattice, idle triangle fills, nodes, labels; cached offscreen
//   dynamic — the lit chord, bass ring, hover and ghost neighbours; each redraw
// All coordinates are CSS pixels; the caller sets the devicePixelRatio transform.

import { flip, type Op } from '../../core/ops';
import { defaultName, noteLabel } from '../../core/spell';
import {
  PERIODS,
  centroid,
  pcAt,
  qAt,
  torusWrap,
  triangleNodes,
  type Coord,
  type Shape,
  type Triangle,
} from '../../core/tonnetz';
import type { Camera, LabelMode } from '../../state/store';
import type { Display } from '../../state/selectors';
import { TORUS_A, TORUS_B, toScreen, visibleRange, type Viewport } from './camera';
import { nodeRadius } from './hit-test';

export const COLORS = {
  background: '#15161a',
  upFill: 'rgba(255,255,255,0.022)',
  downFill: 'rgba(255,255,255,0.045)',
  edge: 'rgba(255,255,255,0.09)',
  node: '#262931',
  nodeStroke: '#3b404b',
  label: '#c9ccd3',
  hint: '#80858f',
  torusBorder: 'rgba(255,255,255,0.28)',
  major: 'rgba(224,164,88,0.62)',
  minor: 'rgba(95,168,211,0.62)',
  other: 'rgba(180,142,173,0.40)',
  otherEdge: 'rgba(206,168,199,0.85)',
  midi: 'rgba(127,209,139,0.50)',
  midiEdge: 'rgba(150,225,160,0.9)',
  lit: '#f2f2f2',
  litLabel: '#15161a',
  bass: '#7fd18b',
  hover: 'rgba(255,255,255,0.07)',
  ghost: 'rgba(255,255,255,0.45)',
};

export interface Scene {
  cam: Camera;
  vp: Viewport;
  torus: boolean;
  labels: LabelMode;
}

// Shared helpers

function labelFor(a: number, b: number, scene: Scene): { text: string; hint: string | null } {
  if (scene.labels === 'pcs') return { text: String(pcAt(a, b)), hint: null };
  // On the torus a node stands for all its copies, so position can't spell it.
  if (scene.torus) return { text: defaultName(pcAt(a, b)), hint: null };
  return noteLabel(qAt(a, b));
}

function fontPx(zoom: number): number {
  return Math.max(9, Math.min(17, zoom * 0.2));
}

function trianglePath(ctx: CanvasRenderingContext2D, scene: Scene, t: Triangle, da = 0, db = 0) {
  const [n0, n1, n2] = triangleNodes(t);
  const p = toScreen(scene.cam, scene.vp, n0.a + da, n0.b + db);
  const q = toScreen(scene.cam, scene.vp, n1.a + da, n1.b + db);
  const r = toScreen(scene.cam, scene.vp, n2.a + da, n2.b + db);
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.lineTo(r.x, r.y);
  ctx.closePath();
}

function torusClip(ctx: CanvasRenderingContext2D, scene: Scene) {
  const corners: [number, number][] = [
    [0, 0],
    [TORUS_A, 0],
    [TORUS_A, TORUS_B],
    [0, TORUS_B],
  ];
  ctx.beginPath();
  corners.forEach(([a, b], i) => {
    const s = toScreen(scene.cam, scene.vp, a, b);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

// Static layer

export function drawStatic(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { cam, vp } = scene;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, vp.width, vp.height);

  const range = scene.torus
    ? { aMin: -1, aMax: TORUS_A + 1, bMin: -1, bMax: TORUS_B + 1 }
    : visibleRange(cam, vp, 0);

  ctx.save();
  if (scene.torus) {
    torusClip(ctx, scene);
    ctx.clip();
  }

  // Idle triangle fills, batched into one path per orientation.
  for (const orient of ['up', 'down'] as const) {
    ctx.beginPath();
    for (let a = range.aMin; a <= range.aMax; a++) {
      for (let b = range.bMin; b <= range.bMax; b++) trianglePath(ctx, scene, { a, b, orient });
    }
    ctx.fillStyle = orient === 'up' ? COLORS.upFill : COLORS.downFill;
    ctx.fill();
  }

  // Edges along the three axes, one stroke.
  ctx.beginPath();
  for (let a = range.aMin; a <= range.aMax; a++) {
    for (let b = range.bMin; b <= range.bMax; b++) {
      const p = toScreen(cam, vp, a, b);
      for (const [da, db] of [
        [1, 0],
        [0, 1],
        [1, -1],
      ] as const) {
        const q = toScreen(cam, vp, a + da, b + db);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
    }
  }
  ctx.strokeStyle = COLORS.edge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (scene.torus) {
    torusClip(ctx, scene);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = COLORS.torusBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Nodes and labels. On the torus, boundary nodes are drawn on both edges.
  const nodes = scene.torus
    ? { aMin: 0, aMax: TORUS_A, bMin: 0, bMax: TORUS_B }
    : range;
  const r = nodeRadius(cam.zoom);
  ctx.beginPath();
  for (let a = nodes.aMin; a <= nodes.aMax; a++) {
    for (let b = nodes.bMin; b <= nodes.bMax; b++) {
      const p = toScreen(cam, vp, a, b);
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = COLORS.node;
  ctx.fill();
  ctx.strokeStyle = COLORS.nodeStroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (cam.zoom < 30) return;
  // Two passes so the font is set twice in total, not twice per node:
  // text rendering dominates the rebuild cost.
  const size = fontPx(cam.zoom);
  const hints: { x: number; y: number; text: string }[] = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.fillStyle = COLORS.label;
  for (let a = nodes.aMin; a <= nodes.aMax; a++) {
    for (let b = nodes.bMin; b <= nodes.bMax; b++) {
      const p = toScreen(cam, vp, a, b);
      const { text, hint } = labelFor(a, b, scene);
      ctx.fillText(text, p.x, p.y + 0.5);
      if (hint) hints.push({ x: p.x, y: p.y + r + size * 0.55, text: `=${hint}` });
    }
  }
  ctx.font = `${Math.round(size * 0.72)}px system-ui, sans-serif`;
  ctx.fillStyle = COLORS.hint;
  for (const h of hints) ctx.fillText(h.text, h.x, h.y);
}

// Dynamic layer

export interface DynamicInput {
  display: Display;
  hover: Triangle | null;
}

const OPS: Op[] = ['P', 'L', 'R'];

export function drawDynamic(ctx: CanvasRenderingContext2D, scene: Scene, input: DynamicInput) {
  const { display, hover } = input;
  if (!scene.torus) {
    if (hover) drawHover(ctx, scene, hover, 0, 0);
    drawDisplay(ctx, scene, display, 0, 0);
    return;
  }
  // Torus: draw every period translate that can reach the domain, clipped to it.
  // Fills are clipped to the domain; lit nodes are drawn whole wherever a
  // copy sits on the domain, including its edges.
  const offsets = display.nodes.length > 0 ? wrapOffsets(display.nodes) : [];
  ctx.save();
  torusClip(ctx, scene);
  ctx.clip();
  if (hover) for (const [da, db] of wrapOffsets(triangleNodes(hover))) drawHover(ctx, scene, hover, da, db);
  if (display.source !== 'none') {
    for (const [da, db] of offsets) drawShape(ctx, scene, display.shape, display.source === 'midi', da, db);
  }
  ctx.restore();
  const onDomain = (n: Coord) => n.a >= 0 && n.a <= TORUS_A && n.b >= 0 && n.b <= TORUS_B;
  for (const [da, db] of offsets) drawLitNodes(ctx, scene, display, da, db, onDomain);
}

/** Translations by period vectors that bring a shape into (and across the edges of) the torus domain. */
function wrapOffsets(nodes: readonly Coord[]): [number, number][] {
  const c = centroid(nodes);
  const home = torusWrap(Math.floor(c.a), Math.floor(c.b));
  const base = { a: home.a - Math.floor(c.a), b: home.b - Math.floor(c.b) };
  const [u, v] = PERIODS;
  const out: [number, number][] = [];
  for (let m = -1; m <= 1; m++) {
    for (let n = -1; n <= 1; n++) out.push([base.a + m * u.a + n * v.a, base.b + m * u.b + n * v.b]);
  }
  return out;
}

function drawHover(ctx: CanvasRenderingContext2D, scene: Scene, hover: Triangle, da: number, db: number) {
  ctx.beginPath();
  trianglePath(ctx, scene, hover, da, db);
  ctx.fillStyle = COLORS.hover;
  ctx.fill();

  // Ghost neighbours: the P, L and R images, dashed, with their letters.
  const size = fontPx(scene.cam.zoom);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = COLORS.ghost;
  ctx.lineWidth = 1.5;
  ctx.font = `700 ${Math.round(size * 0.9)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.ghost;
  for (const op of OPS) {
    const g = flip(hover, op);
    ctx.beginPath();
    trianglePath(ctx, scene, g, da, db);
    ctx.stroke();
    const c = centroid(triangleNodes(g));
    const p = toScreen(scene.cam, scene.vp, c.a + da, c.b + db);
    ctx.fillText(op, p.x, p.y);
  }
  ctx.setLineDash([]);
}

function drawDisplay(ctx: CanvasRenderingContext2D, scene: Scene, display: Display, da: number, db: number) {
  if (display.source === 'none') return;
  drawShape(ctx, scene, display.shape, display.source === 'midi', da, db);
  drawLitNodes(ctx, scene, display, da, db, () => true);
}

/** Lit nodes on top of the shape, with dark labels, plus the bass ring. */
function drawLitNodes(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  display: Display,
  da: number,
  db: number,
  include: (n: Coord) => boolean,
) {
  const r = nodeRadius(scene.cam.zoom);
  const size = fontPx(scene.cam.zoom);
  for (const n of display.nodes) {
    if (!include({ a: n.a + da, b: n.b + db })) continue;
    const p = toScreen(scene.cam, scene.vp, n.a + da, n.b + db);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.lit;
    ctx.fill();
    if (scene.cam.zoom >= 30) {
      ctx.font = `700 ${size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.litLabel;
      ctx.fillText(labelFor(n.a, n.b, scene).text, p.x, p.y + 0.5);
    }
  }

  if (display.bass && include({ a: display.bass.a + da, b: display.bass.b + db })) {
    const p = toScreen(scene.cam, scene.vp, display.bass.a + da, display.bass.b + db);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.55 + 2, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.bass;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawShape(ctx: CanvasRenderingContext2D, scene: Scene, shape: Shape, midi: boolean, da: number, db: number) {
  const at = (n: Coord) => toScreen(scene.cam, scene.vp, n.a + da, n.b + db);
  const thick = Math.max(6, scene.cam.zoom * 0.28);
  switch (shape.kind) {
    case 'empty':
    case 'note':
      return;
    case 'triad': {
      ctx.beginPath();
      trianglePath(ctx, scene, shape.triangle, da, db);
      ctx.fillStyle = midi ? COLORS.midi : shape.triangle.orient === 'up' ? COLORS.major : COLORS.minor;
      ctx.fill();
      ctx.strokeStyle = midi ? COLORS.midiEdge : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }
    case 'capsule': {
      const p = at(shape.from);
      const q = at(shape.to);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.lineCap = 'round';
      ctx.lineWidth = thick * 1.6;
      ctx.strokeStyle = midi ? COLORS.midi : COLORS.other;
      ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }
    case 'hull': {
      ctx.beginPath();
      shape.hull.forEach((n, i) => {
        const p = at(n);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = midi ? COLORS.midi : COLORS.other;
      ctx.fill();
      ctx.beginPath();
      for (const [m, n] of shape.edges) {
        const p = at(m);
        const q = at(n);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = thick * 0.5;
      ctx.strokeStyle = midi ? COLORS.midiEdge : COLORS.otherEdge;
      ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }
  }
}
