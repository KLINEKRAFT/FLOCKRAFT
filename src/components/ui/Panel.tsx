import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Panel — the fundamental surface of the FLOCKRAFT interface.
 *
 * Three elevations, all built from a 1px hairline and a flat fill rather than
 * shadow. Depth in this design language comes from layering and border weight,
 * not from drop shadows, which read as consumer software rather than
 * instrumentation.
 */
export type PanelTone = 'base' | 'raised' | 'inset' | 'glass';

interface PanelProps {
  children: ReactNode;
  tone?: PanelTone;
  className?: string;
  /** Small uppercase label rendered in a bordered header strip. */
  title?: string;
  /** Right-aligned slot in the header, for counters or controls. */
  action?: ReactNode;
  as?: 'div' | 'section' | 'article' | 'aside';
}

const TONE_CLASS: Record<PanelTone, string> = {
  base: 'bg-charcoal border border-hairline',
  raised: 'bg-gunmetal border border-hairline',
  inset: 'bg-abyss border border-hairline',
  // Restrained glass: enough to separate from the camera feed, never frosted.
  glass: 'bg-abyss/78 border border-hairline backdrop-blur-md',
};

export function Panel({
  children,
  tone = 'base',
  className,
  title,
  action,
  as: Tag = 'div',
}: PanelProps) {
  return (
    <Tag className={cn('rounded-md', TONE_CLASS[tone], className)}>
      {(title || action) && (
        <header className="flex min-h-9 items-center justify-between gap-3 border-b border-hairline px-3">
          {title ? <h2 className="fk-label">{title}</h2> : <span />}
          {action}
        </header>
      )}
      {children}
    </Tag>
  );
}

/** Section heading used inside panels and full-page scroll views. */
export function SectionLabel({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-1 py-2', className)}>
      <h3 className="fk-label">{children}</h3>
      {action}
    </div>
  );
}

/** Hairline divider that participates in the grid rather than floating. */
export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-hairline', className)} />;
}
