// Views read the playhead without importing engine/: app/ provides the clock.
import { createContext, useContext } from 'react';

/** The playhead in beats as heard, or null when stopped. Cheap enough to call every frame. */
export type Playhead = () => number | null;

export const PlayheadContext = createContext<Playhead>(() => null);

export function usePlayhead(): Playhead {
  return useContext(PlayheadContext);
}
