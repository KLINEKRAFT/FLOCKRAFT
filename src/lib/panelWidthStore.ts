/**
 * PANEL WIDTH STORE
 * ---------------------------------------------------------------------------
 * Width of the desktop intel column, dragged by the operator and remembered
 * across sessions.
 *
 * The camera and the log want different amounts of room depending on what is
 * being watched — a wide lobby wants the picture, a busy afternoon wants the
 * event list — and any fixed split is wrong for one of those. Making it
 * draggable costs a divider; making it persist is what stops the operator
 * re-dragging it at the start of every session.
 *
 * Module-level and read through `useSyncExternalStore`, matching
 * `settingsStore`: the value lives outside React (localStorage), and hydrating
 * it inside an effect would mean a setState-in-effect cascade on every mount.
 */

const STORAGE_KEY = 'flockraft.panelWidth.v1';

export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_DEFAULT_WIDTH = 380;

/** Keyboard nudge per arrow press; Shift multiplies it. */
export const PANEL_STEP = 16;

/**
 * The camera must keep a usable share of the window: on a 1280px laptop an
 * unclamped drag could otherwise leave a 200px slit of video, which is a state
 * the operator has no obvious way back out of.
 */
export function clampPanelWidth(width: number, viewportWidth?: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT_WIDTH;
  const ceiling = viewportWidth
    ? Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, viewportWidth * 0.6))
    : PANEL_MAX_WIDTH;
  return Math.round(Math.min(ceiling, Math.max(PANEL_MIN_WIDTH, width)));
}

let current = PANEL_DEFAULT_WIDTH;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribePanelWidth(listener: () => void): () => void {
  // First subscription is the earliest point we are certainly on the client.
  if (!hydrated) {
    hydrated = true;
    const stored = readStored();
    if (stored !== current) {
      current = stored;
      // Deferred so the first paint still matches the server markup.
      queueMicrotask(emit);
    }
  }

  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPanelWidthSnapshot(): number {
  return current;
}

/** Server render always sees the default, so markup matches first paint. */
export function getPanelWidthServerSnapshot(): number {
  return PANEL_DEFAULT_WIDTH;
}

export function setPanelWidth(next: number): void {
  const clamped = clampPanelWidth(
    next,
    typeof window === 'undefined' ? undefined : window.innerWidth,
  );
  if (clamped === current) return;
  current = clamped;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clamped));
  } catch {
    // Not persisting is survivable; refusing to resize would not be.
  }
  emit();
}

export function resetPanelWidth(): void {
  setPanelWidth(PANEL_DEFAULT_WIDTH);
}

/** Re-clamps after a window resize, so a narrowed window cannot strand the camera. */
export function reclampPanelWidth(): void {
  setPanelWidth(current);
}

export function isPanelWidthHydrated(): boolean {
  return hydrated;
}

function readStored(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return PANEL_DEFAULT_WIDTH;
    return clampPanelWidth(Number.parseInt(raw, 10), window.innerWidth);
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}
