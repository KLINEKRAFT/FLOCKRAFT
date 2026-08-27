import type {
  Association,
  Attribute,
  Entity,
  EntityKind,
  Note,
  Session,
  Sighting,
} from '@/types/domain';
import type { ObservationRepository } from '@/lib/store';
import { profileFieldsFor } from '@/lib/profiles';

/**
 * EXPORT
 * ---------------------------------------------------------------------------
 * Gets observations out of the browser.
 *
 * A local-first store is only trustworthy if the data can leave. IndexedDB is
 * one cleared-site-data away from gone, is invisible to every other tool the
 * operator owns, and is not something anyone should be asked to trust as a
 * sole copy. Export is the difference between a record and a hostage.
 *
 * Two audiences, two formats, deliberately not one compromise between them:
 *
 *   CSV   for a person and a spreadsheet. Flat, denormalised, local time,
 *         Excel-compatible encoding. Lossy on purpose — nested structures are
 *         flattened to readable text rather than escaped JSON in a cell.
 *   JSON  for a machine and a backup. Lossless, epoch milliseconds alongside
 *         ISO UTC, the full record graph including provenance.
 *
 * Images are NOT included. Thumbnails are binary and would need a container
 * format; sightings carry their `thumbnailId` so a future archive export can
 * reunite them. Anywhere this is offered must say so plainly rather than
 * letting an operator believe a backup is complete when it is not.
 */

export const EXPORT_FORMAT_VERSION = 2;

export interface ExportBundle {
  exportedAt: number;
  sessions: Session[];
  entities: Entity[];
  sightings: Sighting[];
  notes: Note[];
  associations: Association[];
}

/**
 * Reads the whole store.
 *
 * Deliberately sequential per entity rather than one giant parallel fan-out:
 * an export of several thousand entities issuing every read at once can starve
 * the same IndexedDB connection the live pipeline is using. Export is a
 * background convenience and can afford to be polite.
 */
export async function collectExport(repository: ObservationRepository): Promise<ExportBundle> {
  const entities = await repository.listEntities({ sort: 'first-seen' });

  const sightings: Sighting[] = [];
  const notes: Note[] = [];
  const associations: Association[] = [];

  for (const entity of entities) {
    sightings.push(...(await repository.listSightings(entity.id)));
    notes.push(...(await repository.listNotes(entity.id)));
    associations.push(...(await repository.listAssociations(entity.id)));
  }

  sightings.sort((a, b) => a.startedAt - b.startedAt);

  return {
    exportedAt: Date.now(),
    // A limit is required by the interface; this is far above any plausible
    // session count and keeps the export complete rather than silently topped.
    sessions: await repository.listSessions(100_000),
    entities,
    sightings,
    notes,
    associations,
  };
}

/* -------------------------------------------------------------------------- */
/* JSON                                                                        */
/* -------------------------------------------------------------------------- */

export function toJson(bundle: ExportBundle): string {
  return JSON.stringify(
    {
      format: 'flockraft-export',
      version: EXPORT_FORMAT_VERSION,
      exportedAt: bundle.exportedAt,
      exportedAtIso: new Date(bundle.exportedAt).toISOString(),
      timezone: localTimezone(),
      // Stated rather than implied: a restore built from this file will have
      // entities and sightings whose `thumbnailId` resolves to nothing.
      includesImages: false,
      counts: {
        sessions: bundle.sessions.length,
        entities: bundle.entities.length,
        sightings: bundle.sightings.length,
        notes: bundle.notes.length,
        associations: bundle.associations.length,
      },
      sessions: bundle.sessions,
      entities: bundle.entities,
      sightings: bundle.sightings,
      notes: bundle.notes,
      associations: bundle.associations,
    },
    null,
    2,
  );
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every profile key across every kind, in a stable order.
 *
 * Kinds share some keys (`description` means the same thing for a person and
 * for an animal), so the union is smaller than the sum and each column keeps a
 * single meaning. A vehicle row simply leaves the person columns empty.
 */
function profileColumns(): string[] {
  const kinds: EntityKind[] = ['person', 'vehicle', 'animal', 'object'];
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const kind of kinds) {
    for (const def of profileFieldsFor(kind)) {
      if (seen.has(def.key)) continue;
      seen.add(def.key);
      columns.push(def.key);
    }
  }
  return columns;
}

export function entitiesCsv(bundle: ExportBundle): string {
  const profileKeys = profileColumns();
  const header = [
    'entity_id',
    'label',
    'kind',
    'class',
    'first_seen',
    'last_seen',
    'sightings',
    'favorite',
    'summary',
    'notes',
    ...profileKeys,
    // Provenance in one column rather than doubling the width of the sheet.
    // Which fields a camera guessed at and which an operator typed is the
    // difference between a measurement and a claim, and it must survive export.
    'model_inferred_fields',
  ];

  const notesByEntity = groupBy(bundle.notes, (note) => note.entityId);

  const rows = bundle.entities.map((entity) => {
    const profile = entity.profile ?? {};
    const inferred = Object.entries(profile)
      .filter(([, field]) => field.source === 'model')
      .map(([key]) => key);

    return [
      entity.id,
      entity.label,
      entity.kind,
      entity.class,
      localTimestamp(entity.firstSeenAt),
      localTimestamp(entity.lastSeenAt),
      entity.sightingCount,
      entity.favorite,
      entity.summary ?? '',
      (notesByEntity.get(entity.id) ?? []).map((note) => note.body).join(' | '),
      ...profileKeys.map((key) => profile[key]?.value ?? ''),
      inferred.join(' '),
    ];
  });

  return csv(header, rows);
}

export function sightingsCsv(bundle: ExportBundle): string {
  const header = [
    'sighting_id',
    'entity_id',
    'entity_label',
    'kind',
    'class',
    'session_id',
    'started_at',
    'ended_at',
    'duration_seconds',
    'confidence',
    'direction',
    'latitude',
    'longitude',
    'accuracy_m',
    'attributes',
    'co_visible_count',
    'has_image',
  ];

  const labelById = new Map(bundle.entities.map((entity) => [entity.id, entity.label]));

  const rows = bundle.sightings.map((sighting) => [
    sighting.id,
    sighting.entityId,
    labelById.get(sighting.entityId) ?? '',
    sighting.kind,
    sighting.class,
    sighting.sessionId,
    localTimestamp(sighting.startedAt),
    localTimestamp(sighting.endedAt),
    Math.round(sighting.durationMs / 100) / 10,
    // Two decimals, not a percentage string: this is a number an operator will
    // want to filter and average on.
    Math.round(sighting.confidence * 100) / 100,
    sighting.direction,
    sighting.location?.latitude ?? '',
    sighting.location?.longitude ?? '',
    sighting.location?.accuracy ?? '',
    describeAttributes(sighting.attributes),
    sighting.coVisibleEntityIds.length,
    sighting.thumbnailId ? 'yes' : 'no',
  ]);

  return csv(header, rows);
}

function describeAttributes(attributes: Attribute[]): string {
  return attributes
    .map((a) => `${a.key}=${a.value} (${Math.round(a.confidence * 100)}%)`)
    .join('; ');
}

type CsvValue = string | number | boolean | null | undefined;

/** RFC 4180: CRLF terminators, and a BOM so Excel reads UTF-8 correctly. */
function csv(header: string[], rows: CsvValue[][]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * One CSV field.
 *
 * The leading-apostrophe guard is not cosmetic. Notes and profile fields are
 * free text an operator typed, and a cell beginning `=`, `+`, `-` or `@` is
 * executed as a formula when the file is opened in Excel or Sheets — the
 * standard CSV injection path. Numbers are exempt because a negative latitude
 * is a number, not a formula.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/* -------------------------------------------------------------------------- */
/* Delivery                                                                    */
/* -------------------------------------------------------------------------- */

export type ExportFormat = 'entities-csv' | 'sightings-csv' | 'json';

export interface ExportArtifact {
  filename: string;
  mimeType: string;
  content: string;
}

export function buildArtifact(bundle: ExportBundle, format: ExportFormat): ExportArtifact {
  const stamp = fileStamp(bundle.exportedAt);
  switch (format) {
    case 'entities-csv':
      return {
        filename: `flockraft-entities-${stamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: entitiesCsv(bundle),
      };
    case 'sightings-csv':
      return {
        filename: `flockraft-sightings-${stamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: sightingsCsv(bundle),
      };
    default:
      return {
        filename: `flockraft-backup-${stamp}.json`,
        mimeType: 'application/json',
        content: toJson(bundle),
      };
  }
}

/**
 * Hands the file to the browser.
 *
 * The object URL is revoked on a later task rather than immediately: Safari
 * begins the download asynchronously and revoking in the same tick cancels it.
 */
export function downloadArtifact(artifact: ExportArtifact): void {
  const blob = new Blob([artifact.content], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `YYYY-MM-DD HH:MM:SS` in the device's timezone.
 *
 * Local rather than UTC because the CSV is read by a person who was there:
 * "14:32" should be the time they remember. It is also the format spreadsheets
 * parse as a date without an import step. The JSON export carries epoch
 * milliseconds for anything that needs to be unambiguous.
 */
function localTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function fileStamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'unknown';
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const bucket = map.get(key(item));
    if (bucket) bucket.push(item);
    else map.set(key(item), [item]);
  }
  return map;
}
