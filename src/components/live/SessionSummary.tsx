'use client';

import type { SessionCounts } from '@/types/domain';
import { KIND_ACCENT } from '@/lib/taxonomy';
import { cn } from '@/lib/cn';

/**
 * SessionSummary — the four counters that answer "what is out there right now".
 *
 * Deliberately four values and nothing more. The temptation in an operational
 * interface is to surface every available metric; the result is a wall of
 * numbers nobody reads. Frame rate, latency and model state live in the header
 * strip where they belong.
 */
interface SessionSummaryProps {
  counts: SessionCounts;
  /** Newly-created entities per kind this session, for the `+N NEW` annotation. */
  newByKind?: Partial<SessionCounts>;
  className?: string;
}

const ROWS = [
  { kind: 'person', label: 'PEOPLE' },
  { kind: 'animal', label: 'ANIMALS' },
  { kind: 'vehicle', label: 'VEHICLES' },
  { kind: 'object', label: 'OBJECTS' },
] as const;

export function SessionSummary({ counts, newByKind, className }: SessionSummaryProps) {
  return (
    <div className={cn('grid grid-cols-4 divide-x divide-hairline', className)}>
      {ROWS.map(({ kind, label }) => {
        const value = counts[kind] ?? 0;
        const fresh = newByKind?.[kind] ?? 0;
        return (
          <div key={kind} className="flex flex-col items-center gap-1.5 px-2 py-3">
            <span className="fk-label">{label}</span>
            <span
              className="tabular font-mono text-xl leading-none"
              style={{ color: value > 0 ? KIND_ACCENT[kind].color : 'var(--color-slate)' }}
            >
              {String(value).padStart(2, '0')}
            </span>
            {fresh > 0 ? (
              <span className="font-mono text-[9px] tracking-[0.12em] text-tactical">
                +{fresh} NEW
              </span>
            ) : (
              // Reserve the row so counters do not shift as entities appear.
              <span aria-hidden className="h-[11px]" />
            )}
          </div>
        );
      })}
    </div>
  );
}
