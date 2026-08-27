'use client';

import Link from 'next/link';
import { MapPin, Star } from 'lucide-react';
import type { TimelineEvent } from '@/types/domain';
import { EntityLabel } from '@/components/ui/EntityLabel';
import { Thumbnail } from '@/components/ui/Thumbnail';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { describeAttribute, ATTRIBUTE_LABEL } from '@/lib/vision/attributes';
import { formatConfidence, formatDuration, formatTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * EventCard — one observation in the log.
 *
 * The information order is fixed across every screen so the eye learns it:
 * thumbnail, designation, time, then duration and confidence, then attributes.
 * Attributes below 70% confidence are rendered with a "possible" qualifier by
 * `describeAttribute` — uncertain model output is never presented as fact.
 */
interface EventCardProps {
  event: TimelineEvent;
  compact?: boolean;
  className?: string;
}

export function EventCard({ event, compact = false, className }: EventCardProps) {
  const attributes = event.attributes.slice(0, compact ? 2 : 4);

  return (
    <Link
      href={`/entities/${event.entityId}`}
      className={cn(
        'flex gap-3 border-b border-hairline p-3 transition-colors',
        'hover:bg-gunmetal/60 focus-visible:bg-gunmetal/60',
        className,
      )}
    >
      <Thumbnail
        mediaId={event.thumbnailId}
        alt={`${event.entityLabel} thumbnail`}
        kind={event.kind}
        size={compact ? 44 : 56}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <EntityLabel
            label={event.entityLabel}
            kind={event.kind}
            size={compact ? 'sm' : 'md'}
          />
          <div className="flex shrink-0 items-center gap-1.5">
            {event.favorite && (
              <Star aria-label="Favorite" className="size-3 fill-amber text-amber" />
            )}
            <time
              dateTime={new Date(event.timestamp).toISOString()}
              className="tabular font-mono text-[10px] text-slate"
            >
              {formatTime(event.timestamp)}
            </time>
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tabular font-mono text-[10px] text-ash">
            <span className="text-shadowtext">CONF</span> {formatConfidence(event.confidence)}
          </span>
          <span className="tabular font-mono text-[10px] text-ash">
            <span className="text-shadowtext">DUR</span> {formatDuration(event.durationMs)}
          </span>
          {event.location && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate">
              <MapPin aria-hidden className="size-2.5" />
              GEO
            </span>
          )}
          {event.isNewEntity && (
            <StatusBadge tone="nominal" size="sm">
              NEW
            </StatusBadge>
          )}
        </div>

        {attributes.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {attributes.map((attribute) => (
              <li
                key={attribute.id}
                className={cn(
                  'rounded-xs border border-hairline px-1.5 py-0.5 text-[10px] text-ash',
                  // Low-confidence readings are visually de-emphasised as well
                  // as verbally hedged.
                  attribute.confidence < 0.7 && 'border-dashed text-slate',
                )}
                title={`${ATTRIBUTE_LABEL[attribute.key] ?? attribute.key} · ${Math.round(
                  attribute.confidence * 100,
                )}% confidence`}
              >
                <span className="text-shadowtext">
                  {ATTRIBUTE_LABEL[attribute.key] ?? attribute.key}
                </span>{' '}
                {describeAttribute(attribute)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Link>
  );
}
