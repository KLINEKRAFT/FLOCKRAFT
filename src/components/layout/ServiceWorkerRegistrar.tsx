'use client';

import { useEffect } from 'react';

/**
 * Registers the offline shell service worker.
 *
 * Registration is deferred to the `load` event so it never competes with the
 * first paint or with the camera stream starting — on a phone those are the
 * two things the user is actually waiting for.
 *
 * Skipped in development, where a cached shell makes hot reload behave
 * unpredictably.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failure only costs offline support; the app still works.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
