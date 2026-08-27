import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * TelemetryValue — a labelled measurement.
 *
 * All numbers use tabular figures so that a column of values does not shift
 * horizontally as digits change. This is the single most important typographic
 * detail in an instrumentation interface: jittering numerals read as unstable
 * equipment.
 */
interface TelemetryValueProps {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Secondary annotation, e.g. `+1 NEW`. */
  delta?: ReactNode;
  align?: 'left' | 'right';
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'accent' | 'muted';
  className?: string;
}

const SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-2xl',
};

const TONE: Record<'default' | 'accent' | 'muted', string> = {
  default: 'text-bone',
  accent: 'text-tactical',
  muted: 'text-ash',
};

export function TelemetryValue({
  label,
  value,
  unit,
  delta,
  align = 'left',
  size = 'md',
  tone = 'default',
  className,
}: TelemetryValueProps) {
  return (
    <div className={cn('flex flex-col gap-1', align === 'right' && 'items-end', className)}>
      <span className="fk-label">{label}</span>
      <span className={cn('tabular font-mono leading-none', SIZE[size], TONE[tone])}>
        {value}
        {unit && <span className="ml-1 text-[0.7em] text-slate">{unit}</span>}
      </span>
      {delta && <span className="font-mono text-[10px] tracking-wider text-tactical">{delta}</span>}
    </div>
  );
}

/** Compact inline `LABEL value` pair for dense header strips. */
export function InlineTelemetry({
  label,
  value,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'accent' | 'muted' | 'fault';
  className?: string;
}) {
  const toneClass =
    tone === 'accent'
      ? 'text-tactical'
      : tone === 'muted'
        ? 'text-slate'
        : tone === 'fault'
          ? 'text-alert'
          : 'text-bone';
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 whitespace-nowrap', className)}>
      <span className="fk-label">{label}</span>
      <span className={cn('tabular font-mono text-[11px] leading-none', toneClass)}>{value}</span>
    </span>
  );
}
