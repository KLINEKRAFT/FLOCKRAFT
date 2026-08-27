import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * EmptyState — shown whenever a view has nothing to display.
 *
 * A blank screen reads as a bug. Every empty view states what is absent, why,
 * and what action would change it.
 */
interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  tone?: 'neutral' | 'fault';
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  tone = 'neutral',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'mb-1 flex size-11 items-center justify-center rounded-sm border',
            tone === 'fault' ? 'border-alert/40 text-alert' : 'border-hairline text-slate',
          )}
        >
          {icon}
        </div>
      )}
      <h3
        className={cn(
          'font-mono text-xs tracking-[0.16em] uppercase',
          tone === 'fault' ? 'text-alert' : 'text-bone',
        )}
      >
        {title}
      </h3>
      {description && <p className="max-w-xs text-[13px] leading-relaxed text-ash">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
