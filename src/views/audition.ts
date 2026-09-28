// Views make sound without importing engine/: app/ provides the function.
import { createContext, useContext } from 'react';

/** Play these MIDI notes now, cutting off the previous audition. */
export type Audition = (notes: number[]) => void;

export const AuditionContext = createContext<Audition>(() => {});

export function useAudition(): Audition {
  return useContext(AuditionContext);
}
