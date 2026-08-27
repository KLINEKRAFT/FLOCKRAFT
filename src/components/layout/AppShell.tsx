'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BottomNavigation, NavigationRail } from './BottomNavigation';
import { OfflineBanner } from './OfflineBanner';
import { useRetentionSweep } from '@/hooks/useRetentionSweep';
import { cn } from '@/lib/cn';

/**
 * AppShell — the persistent frame around every screen.
 *
 * Responsive strategy, per the product's responsive rules:
 *   mobile   full-bleed content, fixed bottom tab bar
 *   tablet   the same shell with wider gutters and two-column content
 *   desktop  a 76px navigation rail replaces the tab bar entirely
 *
 * LIVE is exempt from the max-width container: the camera feed is meant to
 * dominate, so it is allowed to fill the viewport at every breakpoint.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLive = pathname === '/';

  // Retention is a promise about the whole store, so it is honoured from the
  // shell rather than from whichever screen happens to be open.
  useRetentionSweep();

  return (
    <div className="relative flex min-h-dvh flex-col lg:pl-[76px]">
      <NavigationRail />
      <OfflineBanner />
      <main
        id="main"
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          // Clear the fixed tab bar on mobile; the rail needs no bottom offset.
          'pb-[calc(var(--nav-height)+var(--safe-bottom))] lg:pb-0',
          !isLive && 'mx-auto w-full max-w-6xl',
        )}
      >
        {children}
      </main>
      <BottomNavigation />
    </div>
  );
}
