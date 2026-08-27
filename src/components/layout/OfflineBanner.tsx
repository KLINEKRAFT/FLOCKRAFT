'use client';

import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/**
 * Network-loss notice.
 *
 * FLOCKRAFT is local-first, so losing the network degrades nothing that matters
 * — the banner states that plainly rather than implying a failure.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-caution/30 bg-caution-wash px-3 py-1.5"
    >
      <WifiOff aria-hidden className="size-3 text-caution" />
      <span className="font-mono text-[10px] tracking-[0.14em] text-caution uppercase">
        Offline · observations stored locally
      </span>
    </div>
  );
}
