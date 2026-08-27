'use client';

import { useEffect, useState } from 'react';

/**
 * A ticking clock for relative time.
 *
 * Reading `Date.now()` during render is impure — two renders of the same state
 * produce different output, which breaks memoisation and, with the React
 * compiler, is a hard error. It also means "2 min ago" silently goes stale
 * until something unrelated re-renders. A subscribed clock fixes both.
 *
 * Returns `0` on the server and on the first client render so markup matches;
 * consumers treat `0` as "unknown" and formatters fall back to their own
 * default.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    // The initial set happens in a timeout rather than synchronously so the
    // effect body itself performs no state update.
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [intervalMs]);

  return now;
}
