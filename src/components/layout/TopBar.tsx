'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * TopBar — persistent header carrying the wordmark, screen title and system
 * state. Kept to a single 52px row: vertical space on a phone belongs to the
 * camera and the data, not to chrome.
 */
interface TopBarProps {
  /** Screen designation, e.g. `TIMELINE`. Omitted on LIVE, where the wordmark
   *  and the live indicator carry the context. */
  title?: string;
  /** Right-hand slot for status chips. */
  status?: ReactNode;
  /** Second row, e.g. filter rails or telemetry strips. */
  children?: ReactNode;
  showSettings?: boolean;
  className?: string;
  transparent?: boolean;
}

export function TopBar({
  title,
  status,
  children,
  showSettings = true,
  className,
  transparent = false,
}: TopBarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b',
        transparent
          ? 'border-transparent bg-gradient-to-b from-void/90 to-transparent'
          : 'border-hairline bg-abyss/95 backdrop-blur-md',
        className,
      )}
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="flex h-13 items-center gap-3 px-3 lg:px-5">
        <Wordmark />
        {title && (
          <>
            <span aria-hidden className="h-4 w-px bg-hairline-strong" />
            <h1 className="truncate font-mono text-[11px] tracking-[0.18em] whitespace-nowrap text-ash uppercase">
              {title}
            </h1>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {status}
          {showSettings && (
            <Link
              href="/settings"
              aria-label="Settings"
              className="fk-tap -mr-2 inline-flex items-center justify-center rounded-sm text-slate transition-colors hover:text-bone lg:hidden"
            >
              <SlidersHorizontal aria-hidden className="size-[18px]" strokeWidth={1.75} />
            </Link>
          )}
        </div>
      </div>
      {children}
    </header>
  );
}

/**
 * The wordmark. Rendered as a single string with letter-spacing rather than
 * spaced characters, so it copies as "FLOCKRAFT" and screen readers announce
 * one word instead of nine letters.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn('fk-wordmark font-sans text-[13px] text-bone select-none', className)}
      // Trailing spacing on the last glyph would visually offset the mark.
      style={{ marginRight: '-0.34em' }}
    >
      FLOCKRAFT
    </span>
  );
}
