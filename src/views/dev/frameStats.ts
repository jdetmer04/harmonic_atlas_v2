// Timing samples for the dev overlay: per-view draws, their total per frame
// (the SPEC budget is all views together), and Tonnetz static-layer rebuilds
// (pan past the cache margin, zoom settle), kept apart so a rare rebuild
// doesn't hide the per-frame cost. Plain module state, so recording never
// triggers a React render or a store update.

const SIZE = 120;

class Samples {
  private buf = new Float64Array(SIZE);
  private count = 0;
  private next = 0;

  add(ms: number) {
    this.buf[this.next] = ms;
    this.next = (this.next + 1) % SIZE;
    this.count = Math.min(this.count + 1, SIZE);
  }

  stats(): { last: number; avg: number; max: number; count: number } {
    if (this.count === 0) return { last: 0, avg: 0, max: 0, count: 0 };
    let sum = 0;
    let max = 0;
    for (let i = 0; i < this.count; i++) {
      const v = this.buf[i] as number;
      sum += v;
      if (v > max) max = v;
    }
    return { last: this.buf[(this.next - 1 + SIZE) % SIZE] as number, avg: sum / this.count, max, count: this.count };
  }
}

export type ViewName = 'tonnetz' | 'timeline' | 'piano';

const views: Record<ViewName, Samples> = { tonnetz: new Samples(), timeline: new Samples(), piano: new Samples() };
const totals = new Samples();
const rebuilds = new Samples();
let pending = 0;

export function recordDraw(ms: number, view: ViewName = 'tonnetz') {
  views[view].add(ms);
  pending += ms;
}

/** Close the current frame's total. The overlay calls this once per animation frame. */
export function endFrame() {
  if (pending > 0) totals.add(pending);
  pending = 0;
}

export function recordRebuild(ms: number) {
  rebuilds.add(ms);
}

/** All views' draw time per frame. */
export function drawStats() {
  return totals.stats();
}

export function viewStats(view: ViewName) {
  return views[view].stats();
}

export function rebuildStats() {
  return rebuilds.stats();
}
