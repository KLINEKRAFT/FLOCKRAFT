'use client';

import { useCallback, useMemo, useState } from 'react';
import { Clock, Search } from 'lucide-react';
import type { EntityKind, TimelineEvent } from '@/types/domain';
import { TopBar } from '@/components/layout/TopBar';
import { SearchField } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/EmptyState';
import { ActivityGraph, bucketActivity } from '@/components/ui/ActivityGraph';
import { EventCard } from './EventCard';
import { FilterRail, type FilterKey } from './FilterRail';
import { getRepository } from '@/lib/store';
import { useDebounced, useRepositoryQuery } from '@/hooks/useRepositoryQuery';
import { useNow } from '@/hooks/useNow';
import { dayBucket, formatShortDate } from '@/lib/format';

/**
 * TIMELINE — the chronological observation log.
 *
 * Grouping is by day bucket (TODAY / YESTERDAY / EARLIER) rather than by hour:
 * the useful question is almost always "was this today", and a finer grouping
 * fragments the list without adding information. The activity graph above the
 * list gives the intra-day distribution that the grouping deliberately omits.
 */
const KIND_BY_FILTER: Partial<Record<FilterKey, EntityKind>> = {
  people: 'person',
  animals: 'animal',
  vehicles: 'vehicle',
  objects: 'object',
};

export function TimelineScreen() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounced(rawSearch);

  const kind = KIND_BY_FILTER[filter];
  const favorite = filter === 'favorites';

  const query = useCallback(
    () =>
      getRepository().listTimeline({
        kinds: kind ? [kind] : undefined,
        favorite: favorite || undefined,
        search: search || undefined,
        limit: 400,
      }),
    [kind, favorite, search],
  );

  const { data, loading, error } = useRepositoryQuery(query);
  const events = useMemo(() => data ?? [], [data]);

  // A subscribed clock rather than `Date.now()` during render: day grouping and
  // the activity window both depend on "now", and both should refresh on their
  // own rather than when some unrelated state happens to change.
  const now = useNow(60_000);

  const groups = useMemo(() => groupByDay(events, now), [events, now]);

  // Activity is always shown across the last 24 hours regardless of the active
  // filter's date span, so the shape stays comparable between filters.
  const activity = useMemo(() => {
    // Before the clock's first tick there is no window to bucket into; the
    // graph renders its idle baseline for one frame rather than guessing.
    if (now === 0) return [];
    return bucketActivity(
      events.map((event) => ({ timestamp: event.timestamp, kind: event.kind })),
      now - 24 * 60 * 60 * 1000,
      now,
      32,
    );
  }, [events, now]);

  return (
    <>
      <TopBar title="TIMELINE">
        <div className="border-t border-hairline/60 px-3 py-2 lg:px-5">
          <SearchField
            label="Search observations"
            placeholder="Search events, IDs, notes, or attributes…"
            value={rawSearch}
            onChange={setRawSearch}
            icon={<Search aria-hidden className="size-3.5" />}
          />
        </div>
        <FilterRail value={filter} onChange={setFilter} />
      </TopBar>

      <div className="px-3 pt-3 lg:px-5">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="fk-label">Activity · last 24h</span>
          <span className="tabular font-mono text-[10px] text-slate">
            {events.length} {events.length === 1 ? 'EVENT' : 'EVENTS'}
          </span>
        </div>
        <ActivityGraph
          buckets={activity}
          caption={`Detection activity over the last 24 hours, ${events.length} events total.`}
        />
      </div>

      {error && (
        <EmptyState
          tone="fault"
          title="Log unavailable"
          description={error.message}
          className="py-10"
        />
      )}

      {!error && loading && events.length === 0 && (
        <p className="fk-label px-3 py-10 text-center lg:px-5">Loading…</p>
      )}

      {!error && !loading && events.length === 0 && (
        <EmptyState
          icon={<Clock aria-hidden className="size-5" />}
          title={search || filter !== 'all' ? 'No matching events' : 'No observations logged'}
          description={
            search || filter !== 'all'
              ? 'Adjust the filter or search terms.'
              : 'Observations appear here once subjects have been tracked on the LIVE screen.'
          }
        />
      )}

      <div className="mt-4">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.key}>
            <h2 className="sticky top-0 z-10 flex items-baseline justify-between border-y border-hairline bg-abyss/95 px-3 py-2 backdrop-blur-sm lg:px-5">
              <span className="fk-label text-ash">{group.key}</span>
              <span className="tabular font-mono text-[10px] text-slate">
                {group.events.length}
                {group.key === 'EARLIER' && group.events[0]
                  ? ` · from ${formatShortDate(group.events[0].timestamp)}`
                  : ''}
              </span>
            </h2>
            <ul>
              {group.events.map((event) => (
                <li key={event.id}>
                  <EventCard event={event} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

interface DayGroup {
  key: 'TODAY' | 'YESTERDAY' | 'EARLIER';
  events: TimelineEvent[];
}

/** Buckets a descending-sorted event list into the three display groups. */
function groupByDay(events: TimelineEvent[], now: number): DayGroup[] {
  const buckets: Record<DayGroup['key'], TimelineEvent[]> = {
    TODAY: [],
    YESTERDAY: [],
    EARLIER: [],
  };
  for (const event of events) buckets[dayBucket(event.timestamp, now)].push(event);

  return (['TODAY', 'YESTERDAY', 'EARLIER'] as const)
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, events: buckets[key] }));
}
