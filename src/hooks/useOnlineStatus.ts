'use client';

import { useEffect, useState } from 'react';

/** Network reachability, for the offline banner and sync queue. */
export function useOnlineStatus(): boolean {
  // Assume online during SSR; the effect corrects on mount.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
