'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  MapPin,
  MessageSquarePlus,
  Split,
  Star,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { Attribute, Entity, Note, Sighting } from '@/types/domain';
import { TopBar } from '@/components/layout/TopBar';
import { Panel, Divider, SectionLabel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TelemetryValue } from '@/components/ui/TelemetryValue';
import { EntityLabel } from '@/components/ui/EntityLabel';
import { Thumbnail } from '@/components/ui/Thumbnail';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Controls';
import { getRepository, FULL_CASCADE, type DeleteCascade } from '@/lib/store';
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery';
import { useNow } from '@/hooks/useNow';
import { ATTRIBUTE_LABEL, describeAttribute } from '@/lib/vision/attributes';
import { DIRECTION_LABEL } from '@/lib/vision/tracker';
import {
  formatConfidence,
  formatCoord,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTime,
} from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * ENTITY PROFILE — everything FLOCKRAFT remembers about one subject.
 *
 * Two principles shape this screen:
 *
 *  1. Appearance is a history, not a property. Attributes are grouped by the
 *     date they were observed, so "blue jacket on 27 August" never silently
 *     becomes "wears a blue jacket".
 *  2. Every automatic decision is reversible. Split is offered directly beside
 *     the sightings that would be separated, and a merged record can be undone.
 */
export function EntityProfile({ entityId }: { entityId: string }) {
  const router = useRouter();
  const [splitMode, setSplitMode] = useState(false);
  const [selectedSightings, setSelectedSightings] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cascade, setCascade] = useState<DeleteCascade>(FULL_CASCADE);
  const [busy, setBusy] = useState(false);

  const query = useCallback(async () => {
    const repository = getRepository();
    const entity = await repository.getEntity(entityId);
    if (!entity) return null;
    const [sightings, attributes, notes, associations] = await Promise.all([
      repository.listSightings(entityId),
      repository.listAttributes(entityId),
      repository.listNotes(entityId),
      repository.listAssociations(entityId),
    ]);
    // Association rows carry only ids; resolve the labels for display.
    const related = await Promise.all(
      associations.slice(0, 8).map(async (association) => ({
        association,
        entity: await repository.getEntity(association.otherEntityId),
      })),
    );
    return { entity, sightings, attributes, notes, related };
  }, [entityId]);

  const { data, loading, error, refresh } = useRepositoryQuery(query);
  const now = useNow(15_000);

  const observationDays = useMemo(
    () => (data ? groupAttributesByDay(data.attributes) : []),
    [data],
  );

  const toggleFavorite = useCallback(async () => {
    if (!data) return;
    await getRepository().upsertEntity({ ...data.entity, favorite: !data.entity.favorite });
    refresh();
  }, [data, refresh]);

  const submitNote = useCallback(async () => {
    const body = noteDraft.trim();
    if (!body || !data) return;
    setBusy(true);
    try {
      await getRepository().addNote({
        id: crypto.randomUUID(),
        entityId: data.entity.id,
        body,
        createdAt: Date.now(),
        author: 'Operator',
      });
      setNoteDraft('');
      setNoteOpen(false);
      refresh();
    } finally {
      setBusy(false);
    }
  }, [noteDraft, data, refresh]);

  const performSplit = useCallback(async () => {
    if (selectedSightings.length === 0) return;
    setBusy(true);
    try {
      const newId = await getRepository().splitEntity(entityId, selectedSightings);
      setSplitMode(false);
      setSelectedSightings([]);
      router.push(`/entities/${newId}`);
    } finally {
      setBusy(false);
    }
  }, [entityId, selectedSightings, router]);

  const performDelete = useCallback(async () => {
    setBusy(true);
    try {
      await getRepository().deleteEntity(entityId, cascade);
      router.push('/entities');
    } finally {
      setBusy(false);
    }
  }, [entityId, cascade, router]);

  if (error) {
    return (
      <>
        <ProfileBar />
        <EmptyState tone="fault" title="Record unavailable" description={error.message} />
      </>
    );
  }

  if (loading && !data) {
    return (
      <>
        <ProfileBar />
        <p className="fk-label px-3 py-10 text-center">Loading…</p>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <ProfileBar />
        <EmptyState
          title="No such entity"
          description="This record has been deleted or never existed."
          action={
            <Link
              href="/entities"
              className="inline-flex h-11 items-center rounded-sm border border-hairline bg-gunmetal px-4 font-mono text-xs tracking-[0.12em] uppercase"
            >
              Back to entities
            </Link>
          }
        />
      </>
    );
  }

  const { entity, sightings, notes, related } = data;
  // "Currently visible" would require a live session on this screen; the honest
  // signal is recency, so that is what is reported.
  const recentlySeen = (now > 0 ? now : entity.lastSeenAt) - entity.lastSeenAt < 2 * 60 * 1000;

  return (
    <>
      <ProfileBar
        entity={entity}
        onToggleFavorite={() => void toggleFavorite()}
        onDelete={() => setDeleteOpen(true)}
      />

      <div className="px-3 pb-8 lg:px-5">
        {/* ---- Identity header ---- */}
        <div className="flex items-start gap-4 py-4">
          <Thumbnail
            mediaId={entity.thumbnailId}
            alt={`${entity.label} representative image`}
            kind={entity.kind}
            size={84}
          />
          <div className="min-w-0 flex-1">
            <EntityLabel label={entity.label} kind={entity.kind} size="lg" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone={recentlySeen ? 'live' : 'idle'} pulse={recentlySeen} size="sm">
                {recentlySeen ? 'Recently seen' : 'Not currently visible'}
              </StatusBadge>
              {entity.mergedFromIds && entity.mergedFromIds.length > 0 && (
                <StatusBadge tone="caution" size="sm">
                  Merged ×{entity.mergedFromIds.length + 1}
                </StatusBadge>
              )}
            </div>
            {entity.summary && <p className="mt-2 text-[13px] text-ash">{entity.summary}</p>}
          </div>
        </div>

        {/* ---- Core telemetry ---- */}
        <Panel tone="raised" className="grid grid-cols-3 divide-x divide-hairline">
          <TelemetryValue
            className="px-3 py-3"
            label="Sightings"
            value={String(entity.sightingCount).padStart(2, '0')}
            tone="accent"
          />
          <TelemetryValue
            className="px-3 py-3"
            label="First seen"
            value={<span className="text-[13px]">{formatDate(entity.firstSeenAt)}</span>}
            size="sm"
          />
          <TelemetryValue
            className="px-3 py-3"
            label="Last seen"
            value={<span className="text-[13px]">{formatRelative(entity.lastSeenAt, now)}</span>}
            size="sm"
          />
        </Panel>

        {/* ---- Confidence history ---- */}
        {sightings.length > 0 && (
          <>
            <SectionLabel className="mt-6">Confidence history</SectionLabel>
            <ConfidenceHistory sightings={sightings} />
          </>
        )}

        {/* ---- Appearance observations ---- */}
        <SectionLabel className="mt-6">Appearance</SectionLabel>
        {observationDays.length === 0 ? (
          <Panel className="px-3 py-4">
            <p className="text-[12px] leading-relaxed text-slate">
              No appearance readings recorded. Colour sampling requires image capture to be
              enabled, and produces no result when the subject is small or poorly lit.
            </p>
          </Panel>
        ) : (
          <div className="flex flex-col gap-2">
            {observationDays.map((day) => (
              <Panel key={day.key} className="px-3 py-3">
                <p className="fk-label mb-2">{day.label}</p>
                <ul className="flex flex-col gap-1.5">
                  {day.attributes.map((attribute) => (
                    <li key={attribute.id} className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] text-bone">
                        <span className="text-slate">
                          {ATTRIBUTE_LABEL[attribute.key] ?? attribute.key}:
                        </span>{' '}
                        {describeAttribute(attribute)}
                      </span>
                      <span
                        className={cn(
                          'tabular shrink-0 font-mono text-[10px]',
                          attribute.confidence < 0.7 ? 'text-caution' : 'text-slate',
                        )}
                      >
                        {formatConfidence(attribute.confidence)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
            <p className="px-1 text-[11px] leading-relaxed text-shadowtext">
              Appearance readings are observations at a point in time, not permanent
              characteristics.
            </p>
          </div>
        )}

        {/* ---- Notes ---- */}
        <SectionLabel
          className="mt-6"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setNoteOpen(true)}
              icon={<MessageSquarePlus aria-hidden className="size-3" />}
            >
              Add note
            </Button>
          }
        >
          Notes
        </SectionLabel>
        {notes.length === 0 ? (
          <Panel className="px-3 py-4">
            <p className="text-[12px] text-slate">No notes recorded.</p>
          </Panel>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <NoteRow key={note.id} note={note} onDeleted={refresh} />
            ))}
          </ul>
        )}

        {/* ---- Associated entities ---- */}
        <SectionLabel className="mt-6">Associated entities</SectionLabel>
        {related.length === 0 ? (
          <Panel className="px-3 py-4">
            <p className="text-[12px] text-slate">
              No co-occurrences recorded. Associations form when two entities are observed at the
              same time.
            </p>
          </Panel>
        ) : (
          <ul className="flex flex-col">
            {related.map(({ association, entity: other }) =>
              other ? (
                <li key={other.id}>
                  <Link
                    href={`/entities/${other.id}`}
                    className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 transition-colors hover:bg-gunmetal/60"
                  >
                    <EntityLabel label={other.label} kind={other.kind} size="sm" />
                    <span className="tabular font-mono text-[10px] text-ash">
                      Observed together {association.count}×
                    </span>
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        )}

        {/* ---- Sightings ---- */}
        <SectionLabel
          className="mt-6"
          action={
            splitMode ? (
              <div className="flex items-center gap-2">
                <span className="tabular font-mono text-[10px] text-amber">
                  {selectedSightings.length} SELECTED
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={selectedSightings.length === 0 || busy}
                  onClick={() => void performSplit()}
                >
                  Split out
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSplitMode(false);
                    setSelectedSightings([]);
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={sightings.length < 2}
                onClick={() => setSplitMode(true)}
                icon={<Split aria-hidden className="size-3" />}
              >
                Split
              </Button>
            )
          }
        >
          Sightings
        </SectionLabel>

        {splitMode && (
          <p className="mb-2 rounded-sm border border-amber/25 bg-amber-wash px-3 py-2 text-[12px] leading-relaxed text-amber">
            Select the sightings that belong to a different subject. They will be moved into a new
            entity record.
          </p>
        )}

        {sightings.length === 0 ? (
          <Panel className="px-3 py-4">
            <p className="text-[12px] text-slate">No sightings recorded.</p>
          </Panel>
        ) : (
          <ul>
            {sightings.map((sighting) => (
              <SightingRow
                key={sighting.id}
                sighting={sighting}
                kind={entity.kind}
                selectable={splitMode}
                selected={selectedSightings.includes(sighting.id)}
                onToggle={() =>
                  setSelectedSightings((current) =>
                    current.includes(sighting.id)
                      ? current.filter((id) => id !== sighting.id)
                      : [...current, sighting.id],
                  )
                }
              />
            ))}
          </ul>
        )}

        {/* ---- Recent photos ---- */}
        {sightings.some((sighting) => sighting.thumbnailId) && (
          <>
            <SectionLabel className="mt-6">Recent photos</SectionLabel>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
              {sightings
                .filter((sighting) => sighting.thumbnailId)
                .slice(0, 16)
                .map((sighting) => (
                  <Thumbnail
                    key={sighting.id}
                    mediaId={sighting.thumbnailId}
                    alt={`${entity.label} at ${formatTime(sighting.startedAt)}`}
                    kind={entity.kind}
                    size={0}
                    className="aspect-square !size-auto w-full"
                  />
                ))}
            </div>
          </>
        )}
      </div>

      {/* ---- Note composer ---- */}
      <Sheet
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Add note"
        footer={
          <Button
            variant="primary"
            fullWidth
            disabled={!noteDraft.trim() || busy}
            onClick={() => void submitNote()}
          >
            Save note
          </Button>
        }
      >
        <div className="p-4">
          <label htmlFor="note-body" className="fk-label mb-2 block">
            Observation note · {entity.label}
          </label>
          <textarea
            id="note-body"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            rows={6}
            maxLength={4000}
            placeholder="e.g. Observed near VEHICLE 021"
            className="w-full rounded-sm border border-hairline bg-abyss p-3 text-[13px] text-bone placeholder:text-shadowtext focus:border-tactical/40"
          />
          <p className="tabular mt-2 text-right font-mono text-[10px] text-slate">
            {noteDraft.length}/4000
          </p>
        </div>
      </Sheet>

      {/* ---- Delete with explicit cascade ---- */}
      <Sheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete entity"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" fullWidth disabled={busy} onClick={() => void performDelete()}>
              Delete
            </Button>
          </div>
        }
      >
        <div className="p-4">
          <p className="text-[13px] leading-relaxed text-ash">
            Deleting <span className="text-bone">{entity.label}</span> is permanent. Choose what
            else to remove.
          </p>
          <Divider className="my-3" />
          <Toggle
            label="Sightings"
            description={`${sightings.length} recorded appearances and their attribute readings.`}
            checked={cascade.sightings}
            onChange={(sightingsFlag) => setCascade((c) => ({ ...c, sightings: sightingsFlag }))}
          />
          <Toggle
            label="Stored images"
            description="Thumbnails captured for this entity."
            checked={cascade.media}
            onChange={(media) => setCascade((c) => ({ ...c, media }))}
          />
          <Toggle
            label="Notes"
            description={`${notes.length} operator-written notes.`}
            checked={cascade.notes}
            onChange={(notesFlag) => setCascade((c) => ({ ...c, notes: notesFlag }))}
          />
          <Toggle
            label="Associations"
            description="Co-occurrence links with other entities."
            checked={cascade.associations}
            onChange={(associations) => setCascade((c) => ({ ...c, associations }))}
          />
        </div>
      </Sheet>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ProfileBar({
  entity,
  onToggleFavorite,
  onDelete,
}: {
  entity?: Entity;
  onToggleFavorite?: () => void;
  onDelete?: () => void;
}) {
  return (
    <TopBar
      title={entity?.label ?? 'ENTITY'}
      showSettings={false}
      status={
        <div className="flex items-center gap-1.5">
          <Link
            href="/entities"
            aria-label="Back to entities"
            className="fk-tap inline-flex items-center justify-center rounded-sm text-slate hover:text-bone"
          >
            <ArrowLeft aria-hidden className="size-4" />
          </Link>
          {entity && onToggleFavorite && (
            <IconButton
              label={entity.favorite ? 'Remove from favorites' : 'Add to favorites'}
              active={entity.favorite}
              onClick={onToggleFavorite}
              className="size-9 min-h-0 min-w-0"
            >
              <Star aria-hidden className={cn('size-4', entity.favorite && 'fill-amber text-amber')} />
            </IconButton>
          )}
          {entity && onDelete && (
            <IconButton
              label="Delete entity"
              onClick={onDelete}
              className="size-9 min-h-0 min-w-0 hover:text-alert"
            >
              <Trash2 aria-hidden className="size-4" />
            </IconButton>
          )}
        </div>
      }
    />
  );
}

/**
 * Confidence over time. A sparkline of peak confidence per sighting: the useful
 * signal is whether recognition is stable or degrading, not the exact values.
 */
function ConfidenceHistory({ sightings }: { sightings: Sighting[] }) {
  const ordered = [...sightings].sort((a, b) => a.startedAt - b.startedAt).slice(-24);
  return (
    <Panel className="px-3 py-3">
      {/* Bars are width-capped rather than stretched: a single sighting must
          read as one measurement, not as a filled meter. */}
      <div className="flex h-12 items-end gap-1">
        {ordered.map((sighting) => (
          <div
            key={sighting.id}
            className="max-w-3 min-w-1.5 flex-1 bg-tactical/70"
            style={{ height: `${Math.max(6, sighting.confidence * 100)}%` }}
            title={`${formatConfidence(sighting.confidence)} · ${formatDateTime(sighting.startedAt)}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <span className="tabular font-mono text-[10px] text-slate">
          {ordered[0] ? formatDate(ordered[0].startedAt) : ''}
        </span>
        <span className="tabular font-mono text-[10px] text-slate">
          {ordered.length} of {sightings.length} shown
        </span>
      </div>
    </Panel>
  );
}

function SightingRow({
  sighting,
  kind,
  selectable,
  selected,
  onToggle,
}: {
  sighting: Sighting;
  kind: Entity['kind'];
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const content = (
    <>
      <Thumbnail
        mediaId={sighting.thumbnailId}
        alt={`Sighting at ${formatTime(sighting.startedAt)}`}
        kind={kind}
        size={40}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <time
            dateTime={new Date(sighting.startedAt).toISOString()}
            className="tabular font-mono text-[11px] text-bone"
          >
            {formatDateTime(sighting.startedAt)}
          </time>
          <span className="tabular font-mono text-[10px] text-slate">
            {formatConfidence(sighting.confidence)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tabular font-mono text-[10px] text-ash">
            <span className="text-shadowtext">DUR</span> {formatDuration(sighting.durationMs)}
          </span>
          <span className="font-mono text-[10px] text-slate">
            {DIRECTION_LABEL[sighting.direction]}
          </span>
          {sighting.location && (
            <span
              className="inline-flex items-center gap-1 font-mono text-[10px] text-slate"
              title="Device position when the observation was made — not the subject's position."
            >
              <MapPin aria-hidden className="size-2.5" />
              {formatCoord(sighting.location.latitude, 'lat')}
            </span>
          )}
        </div>
      </div>
    </>
  );

  if (selectable) {
    return (
      <li>
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          onClick={onToggle}
          className={cn(
            'flex w-full items-center gap-3 border-b border-hairline py-2.5 text-left transition-colors',
            selected ? 'bg-amber-wash' : 'hover:bg-gunmetal/60',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'ml-1 flex size-4 shrink-0 items-center justify-center rounded-xs border',
              selected ? 'border-amber bg-amber/25' : 'border-hairline-strong',
            )}
          >
            {selected && <span className="size-1.5 rounded-full bg-amber" />}
          </span>
          {content}
        </button>
      </li>
    );
  }

  return <li className="flex items-center gap-3 border-b border-hairline py-2.5">{content}</li>;
}

function NoteRow({ note, onDeleted }: { note: Note; onDeleted: () => void }) {
  const [removing, setRemoving] = useState(false);
  return (
    <li>
      <Panel className="px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <p className="flex-1 text-[13px] leading-relaxed whitespace-pre-wrap text-bone">
            {note.body}
          </p>
          <button
            type="button"
            aria-label="Delete note"
            disabled={removing}
            onClick={async () => {
              setRemoving(true);
              await getRepository().deleteNote(note.id);
              onDeleted();
            }}
            className="fk-tap -mt-2 -mr-2 inline-flex shrink-0 items-center justify-center rounded-sm text-slate hover:text-alert"
          >
            <Undo2 aria-hidden className="size-3.5" />
          </button>
        </div>
        <p className="tabular mt-2 font-mono text-[10px] text-slate">
          {note.author} · {formatDateTime(note.createdAt)}
        </p>
      </Panel>
    </li>
  );
}

interface AttributeDay {
  key: string;
  label: string;
  attributes: Attribute[];
}

/**
 * Groups attribute readings by observation day and keeps the highest-confidence
 * reading per key within each day — a subject sampled twenty times in one
 * session should not produce twenty near-identical rows.
 */
function groupAttributesByDay(attributes: Attribute[]): AttributeDay[] {
  const byDay = new Map<string, Map<string, Attribute>>();

  for (const attribute of attributes) {
    const date = new Date(attribute.observedAt);
    date.setHours(0, 0, 0, 0);
    const key = String(date.getTime());
    const bucket = byDay.get(key) ?? new Map<string, Attribute>();
    const existing = bucket.get(attribute.key);
    if (!existing || attribute.confidence > existing.confidence) {
      bucket.set(attribute.key, attribute);
    }
    byDay.set(key, bucket);
  }

  return [...byDay.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([key, bucket]) => ({
      key,
      label: formatDate(Number(key)),
      attributes: [...bucket.values()].sort((a, b) => b.confidence - a.confidence),
    }));
}
