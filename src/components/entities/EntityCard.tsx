'use client';

import Link from 'next/link';
import { Star } from 'lucide-react';
import type { Entity } from '@/types/domain';
import { EntityLabel } from '@/components/ui/EntityLabel';
import { Thumbnail } from '@/components/ui/Thumbnail';
import { formatRelative } from '@/lib/format';
import { profileSummary } from '@/lib/profiles';
import { cn } from '@/lib/cn';

/**
 * EntityCard — one durable subject in long-term memory.
 *
 * Answers the three questions that matter at a glance: who, how often, how
 * recently. Everything else is on the profile.
 */
interface EntityCardProps {
  entity: Entity;
  onToggleFavorite?: (entity: Entity) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (entity: Entity) => void;
  className?: string;
  now?: number;
}

export function EntityCard({
  entity,
  onToggleFavorite,
  selectable = false,
  selected = false,
  onSelect,
  className,
  now,
}: EntityCardProps) {
  const descriptor = profileSummary(entity) ?? entity.summary;

  const body = (
    <>
      <Thumbnail
        mediaId={entity.thumbnailId}
        alt={`${entity.label} thumbnail`}
        kind={entity.kind}
        size={52}
      />
      <div className="min-w-0 flex-1">
        <EntityLabel label={entity.label} kind={entity.kind} />
        <p className="tabular mt-1.5 font-mono text-[10px] text-ash">
          {entity.sightingCount} {entity.sightingCount === 1 ? 'SIGHTING' : 'SIGHTINGS'}
        </p>
        {/* A recorded plate or make/model tells an operator far more at a
            glance than a sampled colour, so it wins the one line available. */}
        <p className="mt-1 truncate text-[11px] text-slate">
          {descriptor ? `${descriptor} · ` : ''}
          Last seen {formatRelative(entity.lastSeenAt, now)}
        </p>
      </div>
    </>
  );

  // In selection mode the whole card is a checkbox rather than a link, so merge
  // and split flows never navigate away mid-selection.
  if (selectable) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={() => onSelect?.(entity)}
        className={cn(
          'flex w-full items-center gap-3 border-b border-hairline p-3 text-left transition-colors',
          selected ? 'bg-amber-wash' : 'hover:bg-gunmetal/60',
          className,
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-xs border',
            selected ? 'border-amber bg-amber/25' : 'border-hairline-strong',
          )}
        >
          {selected && <span className="size-1.5 rounded-full bg-amber" />}
        </span>
        {body}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-hairline transition-colors hover:bg-gunmetal/60',
        className,
      )}
    >
      <Link href={`/entities/${entity.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3">
        {body}
      </Link>
      {onToggleFavorite && (
        <button
          type="button"
          onClick={() => onToggleFavorite(entity)}
          aria-pressed={entity.favorite}
          aria-label={entity.favorite ? `Unfavorite ${entity.label}` : `Favorite ${entity.label}`}
          className="fk-tap mr-1 inline-flex items-center justify-center rounded-sm text-slate transition-colors hover:text-amber"
        >
          <Star
            aria-hidden
            className={cn('size-4', entity.favorite && 'fill-amber text-amber')}
          />
        </button>
      )}
    </div>
  );
}
