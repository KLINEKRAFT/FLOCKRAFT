'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { FlockraftSettings } from '@/lib/settings';
import {
  getSettingsServerSnapshot,
  getSettingsSnapshot,
  isSettingsHydrated,
  resetSettings,
  subscribeSettings,
  updateSettings,
} from '@/lib/settingsStore';

/**
 * Settings, read from the shared external store.
 *
 * `useSyncExternalStore` is the right primitive here: settings live outside
 * React (localStorage), are shared by every screen, and must not tear between
 * concurrent renders. It also gives a correct server snapshot for free, so the
 * first client paint matches the server markup.
 */
export function useSettings(): {
  settings: FlockraftSettings;
  update: (patch: Partial<FlockraftSettings>) => void;
  reset: () => void;
  hydrated: boolean;
} {
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsServerSnapshot,
  );

  const update = useCallback((patch: Partial<FlockraftSettings>) => updateSettings(patch), []);
  const reset = useCallback(() => resetSettings(), []);

  return { settings, update, reset, hydrated: isSettingsHydrated() };
}
