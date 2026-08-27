import type {
  Association,
  Attribute,
  Entity,
  EntityProfile,
  GeoFix,
  MediaRecord,
  NormalizedBox,
  Note,
  Session,
  SessionCounts,
  Sighting,
} from '@/types/domain';
import type { Json, Tables, TablesInsert } from '@/types/supabase';

/**
 * DOMAIN ↔ ROW MAPPING
 * ---------------------------------------------------------------------------
 * One place where the local domain model and the Postgres schema meet.
 *
 * Two conversions matter and are easy to get wrong:
 *
 *  1. Time. Locally every timestamp is an epoch millisecond number, because
 *     that is what `Date.now()` and the detection loop produce. Postgres holds
 *     `timestamptz`. Converting in exactly one place keeps timezone bugs from
 *     spreading through the codebase.
 *
 *  2. Geography. A `GeoFix` is one nullable object locally; the schema stores
 *     three nullable columns. A partially-populated fix must round-trip to
 *     `undefined` rather than to an object with NaN fields, or the map would
 *     plot a marker at (0, 0) — in the Gulf of Guinea — for every observation
 *     recorded without a position.
 */

const toIso = (ms: number): string => new Date(ms).toISOString();
const toMs = (iso: string): number => new Date(iso).getTime();

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export function sessionToRow(session: Session, userId: string): TablesInsert<'sessions'> {
  return {
    id: session.id,
    user_id: userId,
    started_at: toIso(session.startedAt),
    ended_at: session.endedAt ? toIso(session.endedAt) : null,
    device_label: session.deviceLabel ?? null,
    facing_mode: session.facingMode ?? null,
    detector_id: session.detectorId,
    latitude: session.location?.latitude ?? null,
    longitude: session.location?.longitude ?? null,
    accuracy_m: session.location?.accuracy ?? null,
    counts: session.counts as unknown as Json,
  };
}

export function rowToSession(row: Tables<'sessions'>): Session {
  return {
    id: row.id,
    startedAt: toMs(row.started_at),
    endedAt: row.ended_at ? toMs(row.ended_at) : undefined,
    deviceLabel: row.device_label ?? undefined,
    facingMode: row.facing_mode === 'user' || row.facing_mode === 'environment' ? row.facing_mode : undefined,
    detectorId: row.detector_id,
    location: rowToGeo(row.latitude, row.longitude, row.accuracy_m, toMs(row.started_at)),
    counts: normalizeCounts(row.counts),
  };
}

/**
 * Server JSON is untyped, so each field is validated rather than trusted. A
 * malformed profile must degrade to "no profile" instead of rendering
 * `[object Object]` where an operator expects a licence plate.
 */
function normalizeProfile(value: Json): EntityProfile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: EntityProfile = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const field = raw as Record<string, unknown>;
    if (typeof field.value !== 'string') continue;
    result[key] = {
      value: field.value,
      source: field.source === 'model' ? 'model' : 'user',
      confidence:
        typeof field.confidence === 'number' && Number.isFinite(field.confidence)
          ? Math.min(1, Math.max(0, field.confidence))
          : 1,
      observedAt:
        typeof field.observedAt === 'number' && Number.isFinite(field.observedAt)
          ? field.observedAt
          : Date.now(),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Server JSON is untyped; missing buckets become zero rather than undefined. */
function normalizeCounts(value: Json): SessionCounts {
  const raw = (value ?? {}) as Partial<Record<keyof SessionCounts, unknown>>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    person: num(raw.person),
    vehicle: num(raw.vehicle),
    animal: num(raw.animal),
    object: num(raw.object),
    newEntities: num(raw.newEntities),
  };
}

/* -------------------------------------------------------------------------- */
/* Entities                                                                    */
/* -------------------------------------------------------------------------- */

export function entityToRow(entity: Entity, userId: string): TablesInsert<'entities'> {
  return {
    id: entity.id,
    user_id: userId,
    label: entity.label,
    kind: entity.kind,
    class: entity.class,
    first_seen_at: toIso(entity.firstSeenAt),
    last_seen_at: toIso(entity.lastSeenAt),
    sighting_count: entity.sightingCount,
    favorite: entity.favorite,
    summary: entity.summary ?? null,
    // Deliberately not sent: the thumbnail's media row may not have been
    // uploaded yet, and the FK would reject the entity. The sync engine sets it
    // in a second pass once media has landed.
    thumbnail_id: null,
    merged_from_ids: entity.mergedFromIds ?? [],
    archived_at: entity.archivedAt ? toIso(entity.archivedAt) : null,
    profile: (entity.profile ?? {}) as unknown as Json,
  };
}

export function rowToEntity(row: Tables<'entities'>): Entity {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    class: row.class as Entity['class'],
    firstSeenAt: toMs(row.first_seen_at),
    lastSeenAt: toMs(row.last_seen_at),
    sightingCount: row.sighting_count,
    favorite: row.favorite,
    summary: row.summary ?? undefined,
    thumbnailId: row.thumbnail_id ?? undefined,
    mergedFromIds: row.merged_from_ids.length > 0 ? row.merged_from_ids : undefined,
    archivedAt: row.archived_at ? toMs(row.archived_at) : undefined,
    profile: normalizeProfile(row.profile),
  };
}

/* -------------------------------------------------------------------------- */
/* Sightings                                                                   */
/* -------------------------------------------------------------------------- */

export function sightingToRow(sighting: Sighting, userId: string): TablesInsert<'sightings'> {
  return {
    id: sighting.id,
    user_id: userId,
    entity_id: sighting.entityId,
    session_id: sighting.sessionId,
    observation_id: sighting.observationId,
    class: sighting.class,
    kind: sighting.kind,
    started_at: toIso(sighting.startedAt),
    ended_at: toIso(sighting.endedAt),
    duration_ms: Math.round(sighting.durationMs),
    // The column is CHECK-constrained to 0..1; a detector returning 1.0000001
    // would otherwise fail the whole batch.
    confidence: clamp01(sighting.confidence),
    box: sighting.box as unknown as Json,
    direction: sighting.direction,
    thumbnail_id: null,
    latitude: sighting.location?.latitude ?? null,
    longitude: sighting.location?.longitude ?? null,
    accuracy_m: sighting.location?.accuracy ?? null,
  };
}

export function rowToSighting(row: Tables<'sightings'>, attributes: Attribute[]): Sighting {
  return {
    id: row.id,
    entityId: row.entity_id,
    sessionId: row.session_id,
    observationId: row.observation_id,
    class: row.class as Sighting['class'],
    kind: row.kind,
    startedAt: toMs(row.started_at),
    endedAt: toMs(row.ended_at),
    durationMs: row.duration_ms,
    confidence: row.confidence,
    box: (row.box ?? { x: 0, y: 0, width: 0, height: 0 }) as unknown as NormalizedBox,
    direction: row.direction,
    thumbnailId: row.thumbnail_id ?? undefined,
    location: rowToGeo(row.latitude, row.longitude, row.accuracy_m, toMs(row.started_at)),
    attributes,
    // Co-visibility is reconstructed from the associations table rather than
    // duplicated per sighting; an empty array here is correct, not lossy.
    coVisibleEntityIds: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Attributes, notes, associations, media                                      */
/* -------------------------------------------------------------------------- */

export function attributeToRow(attribute: Attribute, userId: string): TablesInsert<'attributes'> {
  return {
    id: attribute.id,
    user_id: userId,
    entity_id: attribute.entityId,
    sighting_id: attribute.sightingId ?? null,
    key: attribute.key,
    value: attribute.value,
    confidence: clamp01(attribute.confidence),
    observed_at: toIso(attribute.observedAt),
    source: attribute.source,
  };
}

export function rowToAttribute(row: Tables<'attributes'>): Attribute {
  return {
    id: row.id,
    entityId: row.entity_id,
    sightingId: row.sighting_id ?? undefined,
    key: row.key,
    value: row.value,
    confidence: row.confidence,
    observedAt: toMs(row.observed_at),
    source: row.source,
  };
}

export function noteToRow(note: Note, userId: string): TablesInsert<'notes'> {
  return {
    id: note.id,
    user_id: userId,
    entity_id: note.entityId,
    sighting_id: note.sightingId ?? null,
    // The column is CHECK-constrained to 1..4000 characters.
    body: note.body.slice(0, 4000),
    author: note.author,
    created_at: toIso(note.createdAt),
  };
}

export function rowToNote(row: Tables<'notes'>): Note {
  return {
    id: row.id,
    entityId: row.entity_id,
    sightingId: row.sighting_id ?? undefined,
    body: row.body,
    createdAt: toMs(row.created_at),
    author: row.author,
  };
}

export function associationToRow(
  association: Association,
  userId: string,
): TablesInsert<'associations'> {
  return {
    user_id: userId,
    entity_id: association.entityId,
    other_entity_id: association.otherEntityId,
    count: association.count,
    last_observed_at: toIso(association.lastObservedAt),
  };
}

export function rowToAssociation(row: Tables<'associations'>): Association {
  return {
    entityId: row.entity_id,
    otherEntityId: row.other_entity_id,
    count: row.count,
    lastObservedAt: toMs(row.last_observed_at),
  };
}

export function mediaToRow(
  media: MediaRecord,
  userId: string,
  storagePath: string,
): TablesInsert<'media'> {
  return {
    id: media.id,
    user_id: userId,
    entity_id: media.entityId ?? null,
    sighting_id: media.sightingId ?? null,
    session_id: media.sessionId ?? null,
    kind: media.kind,
    mime_type: media.mimeType,
    width: media.width,
    height: media.height,
    byte_size: media.byteSize,
    storage_path: storagePath,
  };
}

export function rowToMedia(row: Tables<'media'>): MediaRecord {
  return {
    id: row.id,
    entityId: row.entity_id ?? undefined,
    sightingId: row.sighting_id ?? undefined,
    sessionId: row.session_id ?? '',
    kind: row.kind,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    createdAt: toMs(row.created_at),
    // No blob: media is fetched from storage on demand rather than eagerly
    // downloading every thumbnail an account has ever recorded.
    remotePath: row.storage_path,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Rebuilds a `GeoFix`, or `undefined` when no usable position was stored.
 *
 * Returning `undefined` rather than a zero-filled object is the point: a
 * half-written fix must never become a marker at (0, 0).
 */
function rowToGeo(
  latitude: number | null,
  longitude: number | null,
  accuracy: number | null,
  timestamp: number,
): GeoFix | undefined {
  if (latitude === null || longitude === null) return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { latitude, longitude, accuracy: accuracy ?? 0, timestamp };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
