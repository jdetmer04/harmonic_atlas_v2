import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { store } from '../../state/store';
import { drawStats, endFrame, rebuildStats, viewStats } from './frameStats';

/** Frame time of all views together (budget 8 ms), per view, lattice rebuilds, and the browser's frame rate. Toggle with `. */
export function FrameOverlay() {
  const on = useStore(store, (s) => s.view.frameOverlay);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!on) return;
    // Count animation frames to report fps; sample the draw stats 4× a second.
    let frames = 0;
    let raf = requestAnimationFrame(function tick() {
      frames++;
      endFrame();
      raf = requestAnimationFrame(tick);
    });
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const fps = (frames * 1000) / (now - last);
      frames = 0;
      last = now;
      const d = drawStats();
      const r = rebuildStats();
      const t = viewStats('tonnetz');
      const tl = viewStats('timeline');
      setText(
        `${fps.toFixed(0)} fps · frame ${d.last.toFixed(2)} ms (avg ${d.avg.toFixed(2)}, max ${d.max.toFixed(2)})` +
          ` · tonnetz avg ${t.avg.toFixed(2)} · timeline avg ${tl.avg.toFixed(2)}` +
          ` · lattice tiles ${r.last.toFixed(1)} ms/frame (max ${r.max.toFixed(1)}, n=${r.count})`,
      );
    }, 250);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [on]);

  if (!on) return null;
  const over = drawStats().max > 8;
  return <div className={over ? 'frame-overlay over' : 'frame-overlay'}>{text || 'measuring…'}</div>;
}
