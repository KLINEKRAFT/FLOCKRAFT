import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { TopBar } from '@/components/layout/TopBar';

export const metadata: Metadata = { title: 'OFFLINE · FLOCKRAFT' };

/**
 * Cached by the service worker as the last-resort navigation fallback. Kept
 * free of client-side data access so it renders even with no store available.
 */
export default function OfflinePage() {
  return (
    <>
      <TopBar title="OFFLINE" showSettings={false} />
      <EmptyState
        icon={<WifiOff aria-hidden className="size-5" />}
        title="No network"
        description="FLOCKRAFT stores observations on this device, so recorded data is unaffected. This view requires a connection."
      />
    </>
  );
}
