'use client';

import { cn } from '@/lib/cn';

/**
 * FilterRail — horizontally scrollable filter chips.
 *
 * A rail rather than a dropdown: on mobile the active filter must be visible
 * at a glance without opening anything, and the set is small enough to fit.
 * Implemented as a radiogroup so arrow keys and screen readers behave correctly.
 */
export type FilterKey = 'all' | 'people' | 'animals' | 'vehicles' | 'objects' | 'favorites';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'people', label: 'People' },
  { key: 'animals', label: 'Animals' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'objects', label: 'Objects' },
  { key: 'favorites', label: 'Favorites' },
];

export function FilterRail({
  value,
  onChange,
  className,
}: {
  value: FilterKey;
  onChange: (next: FilterKey) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Filter observations"
      className={cn(
        'fk-rail flex gap-1.5 overflow-x-auto border-t border-hairline/60 px-3 py-2 lg:px-5',
        className,
      )}
    >
      {FILTERS.map((filter) => {
        const active = filter.key === value;
        return (
          <button
            key={filter.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(filter.key)}
            className={cn(
              'min-h-9 shrink-0 rounded-xs border px-3 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors',
              active
                ? 'border-tactical/45 bg-tactical/12 text-tactical'
                : 'border-hairline bg-gunmetal text-slate hover:text-bone',
            )}
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
