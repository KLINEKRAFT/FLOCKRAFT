'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { cn } from '@/lib/cn';

/**
 * Sheet — modal surface. Bottom sheet on mobile, right-side drawer above `md`.
 *
 * Implements the full dialog contract: focus is moved in on open and restored
 * on close, Escape dismisses, background scroll is locked, and focus is trapped
 * within the panel so keyboard users cannot tab out into inert content.
 */
interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Sticky footer for primary actions. */
  footer?: ReactNode;
  className?: string;
}

export function Sheet({ open, onClose, title, children, footer, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the panel so screen readers announce the dialog.
    const focusTarget =
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
    focusTarget?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-stretch md:justify-end">
      {/* The scrim is a click target, not a control: exposing it as a second
          "Close" button would duplicate the header action in the accessibility
          tree. Keyboard users dismiss with Escape, handled above. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-void/70 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[88dvh] w-full flex-col border-t border-hairline bg-charcoal',
          'md:h-full md:max-h-none md:w-[420px] md:border-t-0 md:border-l',
          'rounded-t-lg md:rounded-none',
          className,
        )}
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-hairline px-4">
          <h2 className="font-mono text-[11px] tracking-[0.16em] text-bone uppercase">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="size-9 min-h-0 min-w-0">
            <X aria-hidden className="size-4" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="shrink-0 border-t border-hairline p-3">{footer}</div>}
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
