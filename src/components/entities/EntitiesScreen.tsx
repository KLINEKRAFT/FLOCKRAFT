'use client';

import { useCallback, useMemo, useState } from 'react';
import { Layers, Merge, Search, X } from 'lucide-react';
import type { Entity, EntityKind } from '@/types/domain';
import { TopBar } from '@/components/layout/TopBar';
import { SearchField, SegmentedControl } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EntityCard } from './EntityCard';
import { getRepository } from '@/lib/store';
import { useDebounced, useRepositoryQuery } from '@/hooks/useRepositoryQuery';
import { useNow } from '@/hooks/useNow';
import { KIND_LABEL } from '@/lib/taxonomy';
import { cn } from '@/lib/cn';

/**
 * ENTITIES — long-term memory.
 *
 * The critical design premise: automatic identity association is never fully
 * correct, so the interface is built around correcting it. Merge (two records
 * are the same subject) is a first-class action reachable in two taps, not a
 * buried administrative function. Split lives on the entity profile, where the
 * individual sightings that would be separated are visible.
 */
type KindFilter = 'all' | EntityKind;
type SortKey = 'recent' | 'sightings' | 'label';

export function EntitiesScreen() {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounced(rawSearch);

  const [mergeMode, setMergeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useCallback(
    () =>
      getRepository().listEntities({
        kind: kindFilter === 'all' ? undefined : kindFilter,
        favorite: favoritesOnly || undefined,
        search: search || undefined,
        sort,
      }),
    [kindFilter, favoritesOnly, search, sort],
  );

  const { data, loading, error, refresh } = useRepositoryQuery(query);
  const entities = useMemo(() => data ?? [], [data]);
  // Relative "last seen" labels refresh on their own rather than freezing at
  // whatever the clock read when the list last happened to re-render.
  const now = useNow(30_000);

  const toggleFavorite = useCallback(
    async (entity: Entity) => {
      await getRepository().upsertEntity({ ...entity, favorite: !entity.favorite });
      refresh();
    },
    [refresh],
  );

  const toggleSelection = useCallback((entity: Entity) => {
    setSelectedIds((current) =>
      current.includes(entity.id)
        ? current.filter((id) => id !== entity.id)
        : [...current, entity.id],
    );
  }, []);

  const exitMergeMode = useCallback(() => {
    setMergeMode(false);
    setSelectedIds([]);
  }, []);

  /**
   * Merging folds the selected records into the earliest-seen one, which keeps
   * the surviving entity's designation and first-seen date meaningful.
   */
  const performMerge = useCallback(async () => {
    if (selectedIds.length < 2) return;
    setBusy(true);
    try {
      const selected = entities.filter((entity) => selectedIds.includes(entity.id));
      const kinds = new Set(selected.map((entity) => entity.kind));
      if (kinds.size > 1) {
        setNotice('Entities of different kinds cannot be merged.');
        return;
      }
      const target = selected.reduce((oldest, entity) =>
        entity.firstSeenAt < oldest.firstSeenAt ? entity : oldest,
      );
      const sources = selected.filter((entity) => entity.id !== target.id).map((e) => e.id);
      await getRepository().mergeEntities(target.id, sources);
      setNotice(`Merged ${sources.length + 1} records into ${target.label}.`);
      exitMergeMode();
      refresh();
    } finally {
      setBusy(false);
    }
  }, [entities, selectedIds, exitMergeMode, refresh]);

  const kindOptions: Array<{ value: KindFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'person', label: KIND_LABEL.person },
    { value: 'vehicle', label: KIND_LABEL.vehicle },
    { value: 'animal', label: KIND_LABEL.animal },
    { value: 'object', label: KIND_LABEL.object },
  ];

  return (
    <>
      <TopBar
        title="ENTITIES"
        status={
          <StatusBadge tone="idle" size="sm">
            {entities.length} RECORDS
          </StatusBadge>
        }
      >
        <div className="border-t border-hairline/60 px-3 py-2 lg:px-5">
          <SearchField
            label="Search entities"
            placeholder="Search designations, classes, or descriptors…"
            value={rawSearch}
            onChange={setRawSearch}
            icon={<Search aria-hidden className="size-3.5" />}
          />
        </div>

        <div
          role="radiogroup"
          aria-label="Filter by kind"
          className="fk-rail flex gap-1.5 overflow-x-auto border-t border-hairline/60 px-3 py-2 lg:px-5"
        >
          {kindOptions.map((option) => {
            const active = option.value === kindFilter;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKindFilter(option.value)}
                className={cn(
                  'min-h-9 shrink-0 rounded-xs border px-3 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors',
                  active
                    ? 'border-tactical/45 bg-tactical/12 text-tactical'
                    : 'border-hairline bg-gunmetal text-slate hover:text-bone',
                )}
              >
                {option.label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((value) => !value)}
            className={cn(
              'min-h-9 shrink-0 rounded-xs border px-3 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors',
              favoritesOnly
                ? 'border-amber/45 bg-amber-wash text-amber'
                : 'border-hairline bg-gunmetal text-slate hover:text-bone',
            )}
          >
            Favorites
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hairline/60 px-3 py-2 lg:px-5">
          <SegmentedControl
            label="Sort entities"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'recent', label: 'Recent' },
              { value: 'sightings', label: 'Sightings' },
              { value: 'label', label: 'ID' },
            ]}
          />
          {mergeMode ? (
            <div className="flex items-center gap-2">
              <span className="tabular font-mono text-[10px] text-amber">
                {selectedIds.length} SELECTED
              </span>
              <Button
                size="sm"
                variant="primary"
                disabled={selectedIds.length < 2 || busy}
                onClick={() => void performMerge()}
              >
                Merge
              </Button>
              <Button size="sm" variant="ghost" onClick={exitMergeMode} icon={<X className="size-3" />}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMergeMode(true)}
              disabled={entities.length < 2}
              icon={<Merge aria-hidden className="size-3" />}
            >
              Merge
            </Button>
          )}
        </div>
      </TopBar>

      {mergeMode && (
        <p className="border-b border-amber/25 bg-amber-wash px-3 py-2 text-[12px] leading-relaxed text-amber lg:px-5">
          Select two or more records that are the same subject. They will be folded into the
          earliest-seen record; the merge can be undone from that entity&apos;s profile.
        </p>
      )}

      {notice && (
        <p role="status" className="border-b border-hairline bg-gunmetal px-3 py-2 text-[12px] text-ash lg:px-5">
          {notice}
        </p>
      )}

      {error && <EmptyState tone="fault" title="Memory unavailable" description={error.message} />}

      {!error && loading && entities.length === 0 && (
        <p className="fk-label px-3 py-10 text-center">Loading…</p>
      )}

      {!error && !loading && entities.length === 0 && (
        <EmptyState
          icon={<Layers aria-hidden className="size-5" />}
          title={search || kindFilter !== 'all' || favoritesOnly ? 'No matching entities' : 'No entities yet'}
          description={
            search || kindFilter !== 'all' || favoritesOnly
              ? 'Adjust the filters or search terms.'
              : 'Entities are created when a tracked subject stays visible past the dwell threshold.'
          }
        />
      )}

      {/* Two columns from `md`: entity cards are compact and a single column
          wastes most of a tablet or desktop viewport. */}
      <ul className="md:grid md:grid-cols-2 md:gap-x-px md:bg-hairline lg:grid-cols-3">
        {entities.map((entity) => (
          <li key={entity.id} className="md:bg-void">
            <EntityCard
              entity={entity}
              now={now}
              selectable={mergeMode}
              selected={selectedIds.includes(entity.id)}
              onSelect={toggleSelection}
              onToggleFavorite={mergeMode ? undefined : (target) => void toggleFavorite(target)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
