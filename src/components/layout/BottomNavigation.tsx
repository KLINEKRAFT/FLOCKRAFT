'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Camera,
  Clock,
  History,
  Layers,
  Map as MapIcon,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Primary navigation.
 *
 * Mobile: fixed bottom bar, above the home indicator. Desktop (`lg` and up):
 * a left rail with the wordmark — not a stretched version of the mobile bar.
 * Both render from the same route table so they cannot drift apart.
 */
export const NAV_ITEMS = [
  { href: '/', label: 'LIVE', icon: Camera },
  { href: '/timeline', label: 'TIMELINE', icon: Clock },
  { href: '/sessions', label: 'SESSIONS', icon: History },
  { href: '/entities', label: 'ENTITIES', icon: Layers },
  { href: '/map', label: 'MAP', icon: MapIcon },
] as const;

const SETTINGS_ITEM = { href: '/settings', label: 'SETTINGS', icon: SlidersHorizontal } as const;

function useActive(href: string): boolean {
  const pathname = usePathname();
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNavigation() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-abyss/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <ul className="mx-auto flex max-w-2xl">
        {NAV_ITEMS.map((item) => (
          <li key={item.href} className="flex-1">
            <NavTab {...item} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NavTab({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Camera;
}) {
  const active = useActive(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-14 flex-col items-center justify-center gap-1 transition-colors',
        active ? 'text-tactical' : 'text-slate hover:text-ash',
      )}
    >
      {/* The active marker is a top rule, not just a colour change. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-3 top-0 h-px transition-opacity',
          active ? 'bg-tactical opacity-100' : 'opacity-0',
        )}
      />
      <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
      <span className="font-mono text-[9px] tracking-[0.16em]">{label}</span>
    </Link>
  );
}

/** Desktop left rail. Hidden below `lg`. */
export function NavigationRail() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-y-0 left-0 z-40 hidden w-[76px] flex-col border-r border-hairline bg-abyss lg:flex"
    >
      <div className="flex h-14 items-center justify-center border-b border-hairline">
        <span
          aria-hidden
          className="size-2.5 rotate-45 border border-tactical bg-tactical/25"
          title="FLOCKRAFT"
        />
      </div>
      <ul className="flex flex-1 flex-col gap-1 py-3">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <RailTab {...item} />
          </li>
        ))}
      </ul>
      <ul className="border-t border-hairline py-3">
        <li>
          <RailTab {...SETTINGS_ITEM} />
        </li>
      </ul>
    </nav>
  );
}

function RailTab({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Camera;
}) {
  const active = useActive(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative mx-2 flex flex-col items-center gap-1.5 rounded-sm py-3 transition-colors',
        active ? 'bg-tactical/10 text-tactical' : 'text-slate hover:bg-gunmetal hover:text-bone',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-2 left-0 w-px',
          active ? 'bg-tactical' : 'bg-transparent',
        )}
      />
      <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
      <span className="font-mono text-[8px] tracking-[0.14em]">{label}</span>
    </Link>
  );
}
