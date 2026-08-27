import { DEFAULT_SETTINGS, loadSettings, saveSettings, type FlockraftSettings } from './settings';

/**
 * SETTINGS STORE
 * ---------------------------------------------------------------------------
 * A single module-level store backing `useSettings`, read through
 * `useSyncExternalStore`.
 *
 * Per-component `useState` would give every consumer its own copy: toggling
 * "show overlays" in the detection sheet would not reach the LIVE screen's
 * overlay, and the privacy screen and the pipeline could disagree about whether
 * images may be stored. One store, one truth.
 *
 * `getSnapshot` must return a referentially stable value between changes or
 * `useSyncExternalStore` re-renders forever, so the current value is cached and
 * only replaced when it genuinely changes.
 */

let current: FlockraftSettings = DEFAULT_SETTINGS;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeSettings(listener: () => void): () => void {
  // Hydrate from localStorage on first subscription — that is the earliest
  // point at which we are certainly on the client.
  if (!hydrated) {
    hydrated = true;
    const stored = loadSettings();
    // Only publish a new object if something actually differs, so the common
    // "no stored settings" case does not cause a needless second render.
    if (JSON.stringify(stored) !== JSON.stringify(current)) {
      current = stored;
      queueMicrotask(emit);
    }
  }

  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSettingsSnapshot(): FlockraftSettings {
  return current;
}

/** Server render always sees the defaults, so markup matches first paint. */
export function getSettingsServerSnapshot(): FlockraftSettings {
  return DEFAULT_SETTINGS;
}

export function updateSettings(patch: Partial<FlockraftSettings>): void {
  current = { ...current, ...patch };
  saveSettings(current);
  emit();
}

export function resetSettings(): void {
  current = DEFAULT_SETTINGS;
  saveSettings(current);
  emit();
}

export function isSettingsHydrated(): boolean {
  return hydrated;
}
