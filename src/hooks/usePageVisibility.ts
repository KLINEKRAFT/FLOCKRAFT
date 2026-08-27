'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks tab/window visibility. Inference must stop when the page is hidden —
 * a backgrounded tab still burns battery and, on iOS, the video element stops
 * producing frames entirely so every inference is wasted work on a stale image.
 */
export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  }, []);

  return visible;
}
