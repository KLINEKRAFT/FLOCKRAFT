'use client';

import { Activity } from 'lucide-react';
import Link from 'next/link';
import type { Track } from '@/types/domain';
import type { RecordedObservation } from '@/lib/observationRecorder';
import { EntityLabel } from '@/components/ui/EntityLabel';
import { Thumbnail } from '@/components/ui/Thumbnail';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionLabel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DIRECTION_LABEL } from '@/lib/vision/tracker';
import { describeAttribute, ATTRIBUTE_LABEL } from '@/lib/vision/attributes';
import { formatConfidence, formatDuration, formatTime } from '@/lib/format';
import { useNow } from '@/hooks/useNow';

/**
 * LiveEventsPanel — what is in frame now, and what has just been recorded.
 *
 * The two lists are deliberately separated. Active tracks are provisional: they
 * carry temporary designations and may still turn out to be noise. Logged
 * observations are committed records. Collapsing them into one list would blur
 * exactly the distinction the operator needs.
 */
interface LiveEventsPanelProps {
  observations: RecordedObservation[];
  tracks: Track[];
}

export function LiveEventsPanel({ observations, tracks }: LiveEventsPanelProps) {
  // Ticks once a second so the live dwell counters advance visibly, which is
  // the signal an operator uses to judge whether a track is about to be logged.
  const now = useNow(1000);

  return (
    <div className="flex flex-col">
      <section aria-label="Currently tracked">
        <SectionLabel
          className="px-3"
          action={
            <span className="tabular font-mono text-[10px] text-tactical">
              {String(tracks.length).padStart(2, '0')} ACTIVE
            </span>
          }
        >
          In frame
        </SectionLabel>

        {tracks.length === 0 ? (
          <p className="border-y border-hairline px-3 py-4 text-[12px] text-slate">
            Nothing currently tracked.
          </p>
        ) : (
          <ul className="border-y border-hairline">
            {tracks.map((track) => (
              <li
                key={track.id}
                className="flex items-center justify-between gap-3 border-b border-hairline/60 px-3 py-2 last:border-b-0"
              >
                <EntityLabel
                  label={track.label}
                  kind={track.kind}
                  size="sm"
                  confidence={track.score}
                />
                <div className="flex shrink-0 items-center gap-2">
                  {/* Camera-frame movement, never geographic heading. */}
                  <span className="font-mono text-[9px] tracking-[0.1em] text-slate">
                    {DIRECTION_LABEL[track.direction]}
                  </span>
                  <span className="tabular font-mono text-[10px] text-ash">
                    {formatDuration(Math.max(0, (now || track.firstSeenAt) - track.firstSeenAt))}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Logged observations">
        <SectionLabel
          className="px-3"
          action={
            <Link
              href="/timeline"
              className="font-mono text-[10px] tracking-[0.12em] text-slate uppercase hover:text-bone"
            >
              View all
            </Link>
          }
        >
          Logged this session
        </SectionLabel>

        {observations.length === 0 ? (
          <EmptyState
            className="py-10"
            icon={<Activity aria-hidden className="size-5" />}
            title="No observations yet"
            description="Subjects are logged once they remain continuously visible past the dwell threshold."
          />
        ) : (
          <ul>
            {observations.map(({ sighting, entity, isNewEntity }) => (
              <li key={sighting.id}>
                <Link
                  href={`/entities/${entity.id}`}
                  className="flex gap-3 border-b border-hairline p-3 transition-colors hover:bg-gunmetal/60"
                >
                  <Thumbnail
                    mediaId={sighting.thumbnailId}
                    alt={`${entity.label} thumbnail`}
                    kind={entity.kind}
                    size={44}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <EntityLabel label={entity.label} kind={entity.kind} size="sm" />
                      <time
                        dateTime={new Date(sighting.startedAt).toISOString()}
                        className="tabular shrink-0 font-mono text-[10px] text-slate"
                      >
                        {formatTime(sighting.startedAt)}
                      </time>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="tabular font-mono text-[10px] text-ash">
                        <span className="text-shadowtext">CONF</span>{' '}
                        {formatConfidence(sighting.confidence)}
                      </span>
                      <span className="tabular font-mono text-[10px] text-ash">
                        <span className="text-shadowtext">DUR</span>{' '}
                        {formatDuration(sighting.durationMs)}
                      </span>
                      {isNewEntity && (
                        <StatusBadge tone="nominal" size="sm">
                          New
                        </StatusBadge>
                      )}
                    </div>
                    {sighting.attributes.length > 0 && (
                      <p className="mt-1.5 truncate text-[11px] text-slate">
                        {sighting.attributes
                          .map(
                            (attribute) =>
                              `${ATTRIBUTE_LABEL[attribute.key] ?? attribute.key}: ${describeAttribute(attribute)}`,
                          )
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
