'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  getPanelWidthServerSnapshot,
  getPanelWidthSnapshot,
  isPanelWidthHydrated,
  reclampPanelWidth,
  resetPanelWidth,
  setPanelWidth,
  subscribePanelWidth,
} from '@/lib/panelWidthStore';

/**
 * Width of the desktop intel column, from the shared external store.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: the value lives in
 * localStorage, and reading it in an effect would setState on every mount —
 * a cascading render the compiler correctly objects to, for a value that was
 * never React's to own in the first place.
 */
export function usePanelWidth(): {
  width: number;
  hydrated: boolean;
  setWidth: (next: number) => void;
  reset: () => void;
} {
  const width = useSyncExternalStore(
    subscribePanelWidth,
    getPanelWidthSnapshot,
    getPanelWidthServerSnapshot,
  );

  // A window narrowed after a wide drag must not leave the camera as a sliver.
  useEffect(() => {
    window.addEventListener('resize', reclampPanelWidth);
    return () => window.removeEventListener('resize', reclampPanelWidth);
  }, []);

  const setWidth = useCallback((next: number) => setPanelWidth(next), []);
  const reset = useCallback(() => resetPanelWidth(), []);

  return { width, hydrated: isPanelWidthHydrated(), setWidth, reset };
}
