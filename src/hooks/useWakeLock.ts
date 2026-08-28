'use client';

import { useEffect } from 'react';
import { WakeLockManager, browserWakeLockRequest } from '@/lib/wakeLock';

/**
 * Holds a screen wake lock while `active`.
 *
 * The lock is re-requested whenever the page becomes visible again, because
 * browsers release it on their own the moment the document is hidden and never
 * hand it back. A session on a dashboard mount depends on this: without it the
 * screen sleeps, iOS freezes the tab, and recording stops.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const manager = new WakeLockManager(browserWakeLockRequest());
    void manager.acquire();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void manager.acquire();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void manager.release();
    };
  }, [active]);
}
