/**
 * SCREEN WAKE LOCK
 * ---------------------------------------------------------------------------
 * Keeps the display awake while a session is recording.
 *
 * This is not a convenience. On a phone the screen sleeps roughly thirty
 * seconds after the last touch, and on iOS a sleeping screen fires `pagehide`:
 * the camera track is stopped and the page is frozen. A session left running on
 * a dashboard mount therefore records for half a minute and then silently stops
 * — which reads to the operator as the app losing their data, because from
 * their side that is exactly what happened.
 *
 * The lock is best-effort by design. `request` rejects when the document is
 * hidden, and browsers drop the lock under battery saver or when the tab is
 * backgrounded. None of that is an error worth showing: the correct response is
 * to ask again the next time the page becomes visible, which the caller does.
 * Recording never depends on holding the lock.
 */

/** The slice of `WakeLockSentinel` this uses, so a test can supply its own. */
export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export type WakeLockRequest = () => Promise<WakeLockSentinelLike>;

interface WakeLockCapableNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

/** The platform request, or null where the API is absent (iOS below 16.4). */
export function browserWakeLockRequest(): WakeLockRequest | null {
  if (typeof navigator === 'undefined') return null;
  const api = (navigator as Navigator & WakeLockCapableNavigator).wakeLock;
  if (!api?.request) return null;
  return () => api.request('screen');
}

export class WakeLockManager {
  readonly #request: WakeLockRequest | null;
  #sentinel: WakeLockSentinelLike | null = null;
  #wanted = false;
  #pending: Promise<void> | null = null;

  constructor(request: WakeLockRequest | null) {
    this.#request = request;
  }

  get supported(): boolean {
    return this.#request !== null;
  }

  get held(): boolean {
    return this.#sentinel !== null && !this.#sentinel.released;
  }

  /**
   * Asks for the lock, or does nothing if it is already held. Repeated calls
   * while a request is in flight share it rather than stacking sentinels — the
   * caller re-asks on every visibility change, so this is the common path.
   */
  async acquire(): Promise<void> {
    this.#wanted = true;
    if (!this.#request || this.held) return;
    if (this.#pending) return this.#pending;

    const request = this.#request;
    const pending = (async () => {
      try {
        const sentinel = await request();
        if (!this.#wanted) {
          // Released while the request was in flight; do not leave it held.
          await sentinel.release().catch(() => {});
          return;
        }
        this.#sentinel = sentinel;
        // The browser drops the lock on its own when the page is hidden. Clear
        // the reference so a later `acquire` asks again instead of believing a
        // dead sentinel is still good.
        sentinel.addEventListener('release', () => {
          if (this.#sentinel === sentinel) this.#sentinel = null;
        });
      } catch {
        // Refused. Recording is unaffected; the next visibility change retries.
      } finally {
        this.#pending = null;
      }
    })();

    this.#pending = pending;
    return pending;
  }

  async release(): Promise<void> {
    this.#wanted = false;
    const sentinel = this.#sentinel;
    this.#sentinel = null;
    if (!sentinel || sentinel.released) return;
    try {
      await sentinel.release();
    } catch {
      // Already gone.
    }
  }
}
