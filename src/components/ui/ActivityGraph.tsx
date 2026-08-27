'use client';

import { useId, useMemo } from 'react';
import type { EntityKind } from '@/types/domain';
import { KIND_ACCENT } from '@/lib/taxonomy';
import { cn } from '@/lib/cn';

/**
 * ActivityGraph — detections over time.
 *
 * A stacked column chart rather than a line: detection counts are discrete
 * events in discrete buckets, and a smoothed line would imply a continuous
 * quantity that does not exist. Restraint over decoration — no gridlines, no
 * axis furniture, one baseline rule.
 */
export interface ActivityBucket {
  /** Bucket start, epoch ms. */
  start: number;
  counts: Record<EntityKind, number>;
}

interface ActivityGraphProps {
  buckets: ActivityBucket[];
  height?: number;
  className?: string;
  /** Accessible summary; the chart itself is presentational. */
  caption: string;
}

const KIND_ORDER: EntityKind[] = ['person', 'vehicle', 'animal', 'object'];

export function ActivityGraph({ buckets, height = 56, className, caption }: ActivityGraphProps) {
  const titleId = useId();

  const { max, total } = useMemo(() => {
    let maxValue = 0;
    let sum = 0;
    for (const bucket of buckets) {
      const bucketTotal = KIND_ORDER.reduce((acc, kind) => acc + (bucket.counts[kind] ?? 0), 0);
      maxValue = Math.max(maxValue, bucketTotal);
      sum += bucketTotal;
    }
    return { max: maxValue, total: sum };
  }, [buckets]);

  if (buckets.length === 0 || total === 0) {
    return (
      <div
        className={cn('flex items-end gap-px border-b border-hairline', className)}
        style={{ height }}
        aria-hidden
      >
        {Array.from({ length: 24 }, (_, index) => (
          <span key={index} className="h-px flex-1 bg-hairline" />
        ))}
      </div>
    );
  }

  return (
    <figure className={cn('m-0', className)} role="group" aria-labelledby={titleId}>
      <div className="flex items-end gap-px border-b border-hairline" style={{ height }}>
        {buckets.map((bucket) => {
          const bucketTotal = KIND_ORDER.reduce((acc, kind) => acc + (bucket.counts[kind] ?? 0), 0);
          return (
            <div
              key={bucket.start}
              className="flex flex-1 flex-col-reverse justify-start"
              // A 1px floor keeps empty buckets visible as structure, so the
              // time axis stays readable even in quiet periods.
              style={{ height: '100%' }}
            >
              {bucketTotal === 0 ? (
                <span className="h-px w-full bg-hairline" />
              ) : (
                KIND_ORDER.map((kind) => {
                  const count = bucket.counts[kind] ?? 0;
                  if (count === 0) return null;
                  return (
                    <span
                      key={kind}
                      className="w-full"
                      style={{
                        height: `${(count / Math.max(max, 1)) * 100}%`,
                        backgroundColor: KIND_ACCENT[kind].color,
                        opacity: 0.85,
                      }}
                    />
                  );
                })
              )}
            </div>
          );
        })}
      </div>
      <figcaption id={titleId} className="sr-only">
        {caption}
      </figcaption>
    </figure>
  );
}

/**
 * Buckets timestamps into a fixed number of equal intervals spanning
 * `[from, to]`. Fixed-count bucketing keeps the chart's visual density constant
 * regardless of the range selected.
 */
export function bucketActivity(
  events: Array<{ timestamp: number; kind: EntityKind }>,
  from: number,
  to: number,
  bucketCount = 24,
): ActivityBucket[] {
  const span = Math.max(1, to - from);
  const width = span / bucketCount;

  const buckets: ActivityBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
    start: from + index * width,
    counts: { person: 0, vehicle: 0, animal: 0, object: 0 },
  }));

  for (const event of events) {
    if (event.timestamp < from || event.timestamp > to) continue;
    const index = Math.min(bucketCount - 1, Math.floor((event.timestamp - from) / width));
    const bucket = buckets[index];
    if (bucket) bucket.counts[event.kind] += 1;
  }

  return buckets;
}
