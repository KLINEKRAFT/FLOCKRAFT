'use client';

import { useEffect } from 'react';
import { getRepository } from '@/lib/store';
import { sweepIfDue } from '@/lib/retention';
import { useSettings } from '@/hooks/useSettings';
import { logError } from '@/lib/logger';

/**
 * Runs the retention sweep once the app is up and settings have hydrated.
 *
 * Mounted in the shell rather than on a screen, because retention is a promise
 * about the whole store: an operator who set a 30-day window and then only ever
 * opened LIVE should still have it honoured.
 *
 * Failures are logged and swallowed. A sweep that cannot complete must never
 * stop the app from recording — the records it would have removed simply
 * survive until the next attempt.
 */
export function useRetentionSweep(): void {
  const { settings, hydrated } = useSettings();

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    // Deferred past first paint: the sweep reads every sighting, and doing that
    // while the camera is still starting competes for the same main thread.
    const timer = setTimeout(() => {
      if (cancelled) return;
      void sweepIfDue(getRepository(), settings, Date.now()).catch((error) => {
        logError('store', error);
      });
    }, 4000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrated, settings]);
}
