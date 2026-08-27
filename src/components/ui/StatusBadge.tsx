import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * StatusBadge — system state indicator.
 *
 * Accessibility constraint: status is never communicated by colour alone. Every
 * variant carries a text label, and the indicator dot is accompanied by a
 * distinct shape treatment (filled / ringed / hollow) so the badge remains
 * legible under monochrome vision or in bright sunlight.
 */
export type StatusTone = 'live' | 'nominal' | 'caution' | 'fault' | 'idle' | 'selected';

interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
  /** Pulses the indicator. Suppressed under `prefers-reduced-motion`. */
  pulse?: boolean;
  icon?: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}

const TONE: Record<StatusTone, { text: string; border: string; bg: string; dot: string }> = {
  live: {
    text: 'text-tactical',
    border: 'border-tactical/45',
    bg: 'bg-tactical-wash',
    dot: 'bg-tactical',
  },
  nominal: {
    text: 'text-tactical',
    border: 'border-tactical/30',
    bg: 'bg-transparent',
    dot: 'bg-tactical',
  },
  caution: {
    text: 'text-caution',
    border: 'border-caution/40',
    bg: 'bg-caution-wash',
    dot: 'bg-caution',
  },
  fault: {
    text: 'text-alert',
    border: 'border-alert/45',
    bg: 'bg-alert-wash',
    dot: 'bg-alert',
  },
  idle: {
    text: 'text-slate',
    border: 'border-hairline',
    bg: 'bg-transparent',
    // Hollow dot: a distinct shape, not just a different colour.
    dot: 'bg-transparent ring-1 ring-slate',
  },
  selected: {
    text: 'text-amber',
    border: 'border-amber/45',
    bg: 'bg-amber-wash',
    dot: 'bg-amber',
  },
};

export function StatusBadge({
  tone,
  children,
  pulse = false,
  icon,
  className,
  size = 'md',
}: StatusBadgeProps) {
  const style = TONE[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xs border font-mono uppercase tracking-[0.12em] whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]',
        style.text,
        style.border,
        style.bg,
        className,
      )}
    >
      {icon ?? (
        <span
          aria-hidden
          className={cn('size-1.5 shrink-0 rounded-full', style.dot, pulse && 'fk-pulse')}
        />
      )}
      {children}
    </span>
  );
}
