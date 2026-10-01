// Global keys (SPEC "Keyboard map"). Focus keys (1/2/3) and rhythm-lane
// rotation ([ ]) arrive with the DFT and rhythm views.

import { COMPOUNDS } from '../core/ops';
import { closeVoicing } from '../core/voicing';
import {
  appendCurrent,
  chordPcs,
  clearCurrent,
  moveInsert,
  setPlaying,
  toggleChart,
  toggleFrameOverlay,
  transform,
} from '../state/actions';
import { deleteChord, redo, undo } from '../state/commands';
import { selectCustomOps } from '../state/selectors';
import { store } from '../state/store';
import type { Audition } from '../views/audition';

const TRANSFORM_KEYS = new Set(['P', 'L', 'R', ...Object.keys(COMPOUNDS)]);

export function installKeymap(audition: Audition): () => void {
  function onKeyDown(e: KeyboardEvent) {
    if (isTyping(e.target)) return;

    // Undo / redo. Inside text fields the browser's own undo applies instead.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) redo();
        else undo();
      }
      return;
    }
    if (e.altKey || e.repeat) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        setPlaying(!store.getState().transport.playing);
        return;
      case 'Enter':
      case 'NumpadEnter':
        e.preventDefault();
        appendCurrent();
        return;
      case 'Backspace':
      case 'Delete': {
        const id = store.getState().timeline.selection;
        if (id) {
          e.preventDefault();
          deleteChord(id);
        }
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        moveInsert(e.code === 'ArrowLeft' ? -1 : 1);
        return;
      case 'Backquote':
        e.preventDefault();
        toggleFrameOverlay();
        return;
      case 'Escape':
        clearCurrent();
        return;
      case 'KeyC':
        if (!e.shiftKey) {
          e.preventDefault();
          toggleChart();
          return;
        }
    }

    // Letters: built-in transforms, then custom operator strings. Shift also
    // appends the result at the insert point.
    const letter = e.key.length === 1 ? e.key.toUpperCase() : '';
    const ops = TRANSFORM_KEYS.has(letter) ? letter : selectCustomOps(store.getState()).bindings[letter];
    if (!ops) return;
    e.preventDefault();
    const chord = transform(ops);
    if (!chord) return;
    audition(closeVoicing(chordPcs(chord)));
    if (e.shiftKey) appendCurrent('operator');
  }

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
