// Global keys (SPEC "Keyboard map"). M1 has the Tonnetz ones; Enter/append,
// transport and the other views arrive with their milestones.

import { COMPOUNDS } from '../core/ops';
import { closeVoicing } from '../core/voicing';
import { chordPcs, clearCurrent, toggleFrameOverlay, transform } from '../state/actions';
import { selectCustomOps } from '../state/selectors';
import { store } from '../state/store';
import type { Audition } from '../views/audition';

const TRANSFORM_KEYS = new Set(['P', 'L', 'R', ...Object.keys(COMPOUNDS)]);

export function installKeymap(audition: Audition): () => void {
  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (isTyping(e.target)) return;

    if (e.code === 'Backquote') {
      toggleFrameOverlay();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      clearCurrent();
      return;
    }

    // Letters: built-in transforms, then custom operator strings. Shift is the
    // "also append" variant; there is no sketch to append to until M2.
    const letter = e.key.length === 1 ? e.key.toUpperCase() : '';
    const ops = TRANSFORM_KEYS.has(letter) ? letter : selectCustomOps(store.getState()).bindings[letter];
    if (!ops) return;
    e.preventDefault();
    const chord = transform(ops);
    if (chord) audition(closeVoicing(chordPcs(chord)));
  }

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
