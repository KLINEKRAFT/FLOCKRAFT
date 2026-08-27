'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoFix } from '@/types/domain';

export type GeoStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'error';

export interface UseGeolocationResult {
  fix: GeoFix | null;
  status: GeoStatus;
  error: string | null;
  /** Forces a fresh subscription — used by an explicit retry control. */
  retry: () => void;
}

/**
 * Geolocation watcher, active only while `enabled` is true.
 *
 * The returned fix is the *device's* position — it is explicitly NOT the
 * position of anything detected in frame. FLOCKRAFT never converts camera-space
 * motion into geographic coordinates, and the interface labels this distinction
 * wherever a location is shown.
 *
 * The subscription lives directly in the effect and writes state only from the
 * watcher's own callbacks. The transient "requesting" state is derived rather
 * than stored, so subscribing never causes a synchronous render cascade.
 */
export function useGeolocation(enabled: boolean): UseGeolocationResult {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [result, setResult] = useState<{ status: GeoStatus; error: string | null }>({
    status: 'idle',
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const watchId = useRef<number | null>(null);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      // Deferred to a microtask so the effect body itself performs no
      // synchronous state update.
      queueMicrotask(() =>
        setResult({ status: 'unavailable', error: 'Geolocation is not available in this browser.' }),
      );
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (position) => {
        setFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp,
        });
        setResult({ status: 'active', error: null });
      },
      (cause) => {
        setResult(
          cause.code === cause.PERMISSION_DENIED
            ? { status: 'denied', error: 'Location access was denied.' }
            : { status: 'error', error: cause.message || 'Location unavailable.' },
        );
      },
      // A 30 s cache is acceptable: FLOCKRAFT records where an observation was
      // made, not a continuous high-rate track.
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
    watchId.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchId.current = null;
    };
  }, [enabled, attempt]);

  // Idle plus enabled means the watcher is running but has not reported yet.
  const status: GeoStatus =
    !enabled ? 'idle' : result.status === 'idle' ? 'requesting' : result.status;

  return { fix: enabled ? fix : null, status, error: result.error, retry };
}
