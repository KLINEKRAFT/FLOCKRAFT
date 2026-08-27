import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Association,
  Attribute,
  Entity,
  EntityId,
  EntityKind,
  FaceEmbeddingRecord,
  MediaId,
  MediaRecord,
  Note,
  Session,
  SessionId,
  Sighting,
  SightingId,
  TimelineEvent,
} from '@/types/domain';
import { createId } from '@/lib/id';
import type { OutboxEntry } from './outbox';
import { designationFor } from '@/lib/taxonomy';
import { profileSearchText } from '@/lib/profiles';
import {
  matchesSearch,
  type DeleteCascade,
  type EntityFilter,
  type ObservationRepository,
  type StorageUsage,
  type TimelineFilter,
} from './repository';

/**
 * LOCAL-FIRST STORE
 * ---------------------------------------------------------------------------
 * IndexedDB is the primary store, not a cache. FLOCKRAFT is fully functional
 * with no account and no network: observations, thumbnails and notes all live
 * on the device. Supabase sync layers on top of this rather than replacing it,
 * which is also what makes the PWA offline story real rather than aspirational.
 *
 * Media blobs are stored in their own object store so that reading a timeline
 * page never deserialises megabytes of image data.
 */

interface FlockraftDb extends DBSchema {
  sessions: { key: SessionId; value: Session; indexes: { startedAt: number } };
  entities: {
    key: EntityId;
    value: Entity;
    indexes: { kind: EntityKind; lastSeenAt: number; favorite: 'true' | 'false' };
  };
  sightings: {
    key: string;
    value: Sighting;
    indexes: { entityId: EntityId; startedAt: number; sessionId: SessionId };
  };
  attributes: { key: string; value: Attribute; indexes: { entityId: EntityId } };
  notes: { key: string; value: Note; indexes: { entityId: EntityId } };
  associations: { key: string; value: Association; indexes: { entityId: EntityId } };
  media: { key: MediaId; value: MediaRecord; indexes: { entityId: EntityId } };
  /** Face descriptors. Separate store so a purge can target them alone. */
  faceEmbeddings: {
    key: string;
    value: FaceEmbeddingRecord;
    indexes: { entityId: EntityId; createdAt: number };
  };
  counters: { key: string; value: { key: string; value: number } };
  /** Pending sync intents. See `store/outbox.ts`. */
  outbox: { key: string; value: OutboxEntry; indexes: { queuedAt: number } };
  /** Sync cursors and bookkeeping, keyed by name. */
  syncState: { key: string; value: { key: string; value: string | number | null } };
}

const DB_NAME = 'flockraft';
/**
 * v2 adds the sync outbox and cursor stores; v3 adds face descriptors. Both
 * upgrades are purely additive — an existing local database keeps every
 * observation it already holds.
 */
const DB_VERSION = 3;

export class IndexedDbRepository implements ObservationRepository {
  readonly id = 'indexeddb';
  #db: Promise<IDBPDatabase<FlockraftDb>> | null = null;

  async ready(): Promise<void> {
    await this.#open();
  }

  #open(): Promise<IDBPDatabase<FlockraftDb>> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is unavailable in this browser context.'));
    }
    this.#db ??= openDB<FlockraftDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) createV1Stores(db);
        if (oldVersion < 2) createV2Stores(db);
        if (oldVersion < 3) createV3Stores(db);
      },
    });
    return this.#db;
  }

  /* ---- Sessions --------------------------------------------------------- */

  async createSession(session: Session): Promise<void> {
    const db = await this.#open();
    await db.put('sessions', session);
  }

  async updateSession(id: SessionId, patch: Partial<Session>): Promise<void> {
    const db = await this.#open();
    const existing = await db.get('sessions', id);
    if (!existing) return;
    await db.put('sessions', { ...existing, ...patch });
  }

  async getSession(id: SessionId): Promise<Session | null> {
    const db = await this.#open();
    return (await db.get('sessions', id)) ?? null;
  }

  async listSessions(limit = 50): Promise<Session[]> {
    const db = await this.#open();
    const all = await db.getAllFromIndex('sessions', 'startedAt');
    return all.reverse().slice(0, limit);
  }

  /* ---- Entities --------------------------------------------------------- */

  async upsertEntity(entity: Entity): Promise<void> {
    const db = await this.#open();
    await db.put('entities', withFavoriteKey(entity));
  }

  async getEntity(id: EntityId): Promise<Entity | null> {
    const db = await this.#open();
    return (await db.get('entities', id)) ?? null;
  }

  async listEntities(filter: EntityFilter = {}): Promise<Entity[]> {
    const db = await this.#open();
    let entities = await db.getAll('entities');

    entities = entities.filter((entity) => {
      if (entity.archivedAt) return false;
      if (filter.kind && entity.kind !== filter.kind) return false;
      if (filter.favorite && !entity.favorite) return false;
      // Profile values are part of the searchable surface: an operator looking
      // for a plate or a make/model expects the entity list to find it.
      return matchesSearch(
        [entity.label, entity.class, entity.summary ?? '', ...profileSearchText(entity)],
        filter.search,
      );
    });

    const sort = filter.sort ?? 'recent';
    entities.sort((a, b) => {
      switch (sort) {
        case 'sightings':
          return b.sightingCount - a.sightingCount;
        case 'label':
          return a.label.localeCompare(b.label);
        case 'first-seen':
          return b.firstSeenAt - a.firstSeenAt;
        default:
          return b.lastSeenAt - a.lastSeenAt;
      }
    });
    return entities;
  }

  async nextOrdinal(kind: EntityKind): Promise<number> {
    const db = await this.#open();
    const key = `ordinal.${kind}`;
    const tx = db.transaction('counters', 'readwrite');
    const current = (await tx.store.get(key))?.value ?? 0;
    const next = current + 1;
    await tx.store.put({ key, value: next });
    await tx.done;
    return next;
  }

  async mergeEntities(targetId: EntityId, sourceIds: EntityId[]): Promise<void> {
    const db = await this.#open();
    const target = await db.get('entities', targetId);
    if (!target) return;

    for (const sourceId of sourceIds) {
      if (sourceId === targetId) continue;
      const source = await db.get('entities', sourceId);
      if (!source) continue;

      // Re-point every dependent record at the target.
      await reassign(db, 'sightings', 'entityId', sourceId, targetId);
      await reassign(db, 'attributes', 'entityId', sourceId, targetId);
      await reassign(db, 'notes', 'entityId', sourceId, targetId);
      await reassign(db, 'media', 'entityId', sourceId, targetId);

      target.sightingCount += source.sightingCount;
      target.firstSeenAt = Math.min(target.firstSeenAt, source.firstSeenAt);
      target.lastSeenAt = Math.max(target.lastSeenAt, source.lastSeenAt);
      target.mergedFromIds = [...(target.mergedFromIds ?? []), sourceId];
      target.thumbnailId ??= source.thumbnailId;

      await db.delete('entities', sourceId);
    }

    await db.put('entities', withFavoriteKey(target));
  }

  async splitEntity(entityId: EntityId, sightingIds: string[]): Promise<EntityId> {
    const db = await this.#open();
    const source = await db.get('entities', entityId);
    if (!source) throw new Error(`Entity ${entityId} not found`);

    const ordinal = await this.nextOrdinal(source.kind);
    const now = Date.now();
    const moving = (await db.getAllFromIndex('sightings', 'entityId', entityId)).filter((s) =>
      sightingIds.includes(s.id),
    );
    if (moving.length === 0) throw new Error('No sightings selected for split.');

    const created: Entity = {
      id: createId('ent'),
      label: designationFor(source.kind, source.class, ordinal),
      kind: source.kind,
      class: source.class,
      firstSeenAt: Math.min(...moving.map((s) => s.startedAt)),
      lastSeenAt: Math.max(...moving.map((s) => s.endedAt)),
      sightingCount: moving.length,
      favorite: false,
      thumbnailId: moving[0]?.thumbnailId,
    };

    for (const sighting of moving) {
      await db.put('sightings', { ...sighting, entityId: created.id });
      // Attributes captured during a moved sighting follow it.
      const attributes = await db.getAllFromIndex('attributes', 'entityId', entityId);
      for (const attribute of attributes) {
        if (attribute.sightingId === sighting.id) {
          await db.put('attributes', { ...attribute, entityId: created.id });
        }
      }
      if (sighting.thumbnailId) {
        const media = await db.get('media', sighting.thumbnailId);
        if (media) await db.put('media', { ...media, entityId: created.id });
      }
    }

    const remaining = await db.getAllFromIndex('sightings', 'entityId', entityId);
    source.sightingCount = remaining.length;
    if (remaining.length > 0) {
      source.firstSeenAt = Math.min(...remaining.map((s) => s.startedAt));
      source.lastSeenAt = Math.max(...remaining.map((s) => s.endedAt));
    } else {
      source.archivedAt = now;
    }
    // Once split, the merge provenance no longer describes the record.
    delete source.mergedFromIds;

    await db.put('entities', withFavoriteKey(source));
    await db.put('entities', withFavoriteKey(created));
    return created.id;
  }

  async deleteEntity(id: EntityId, cascade: DeleteCascade): Promise<void> {
    const db = await this.#open();
    const sightings = await db.getAllFromIndex('sightings', 'entityId', id);

    if (cascade.media) {
      for (const sighting of sightings) {
        if (sighting.thumbnailId) await db.delete('media', sighting.thumbnailId);
      }
      for (const media of await db.getAllFromIndex('media', 'entityId', id)) {
        await db.delete('media', media.id);
      }
    }
    if (cascade.sightings) {
      for (const sighting of sightings) await db.delete('sightings', sighting.id);
      for (const attribute of await db.getAllFromIndex('attributes', 'entityId', id)) {
        await db.delete('attributes', attribute.id);
      }
    }
    if (cascade.notes) {
      for (const note of await db.getAllFromIndex('notes', 'entityId', id)) {
        await db.delete('notes', note.id);
      }
    }
    if (cascade.faceEmbeddings) {
      for (const embedding of await db.getAllFromIndex('faceEmbeddings', 'entityId', id)) {
        await db.delete('faceEmbeddings', embedding.id);
      }
    }
    if (cascade.associations) {
      for (const association of await db.getAll('associations')) {
        if (association.entityId === id || association.otherEntityId === id) {
          await db.delete('associations', associationKey(association.entityId, association.otherEntityId));
        }
      }
    }
    await db.delete('entities', id);
  }

  /* ---- Sightings -------------------------------------------------------- */

  async addSighting(sighting: Sighting): Promise<void> {
    const db = await this.#open();
    await db.put('sightings', sighting);
  }

  /** Direct lookup by id. The sync engine resolves queued records this way;
   *  scanning every entity to find one sighting would be quadratic. */
  async getSighting(id: SightingId): Promise<Sighting | null> {
    const db = await this.#open();
    return (await db.get('sightings', id)) ?? null;
  }

  async getAttribute(id: string): Promise<Attribute | null> {
    const db = await this.#open();
    return (await db.get('attributes', id)) ?? null;
  }

  async getNote(id: string): Promise<Note | null> {
    const db = await this.#open();
    return (await db.get('notes', id)) ?? null;
  }

  async listSightings(entityId: EntityId): Promise<Sighting[]> {
    const db = await this.#open();
    const sightings = await db.getAllFromIndex('sightings', 'entityId', entityId);
    return sightings.sort((a, b) => b.startedAt - a.startedAt);
  }

  async listSightingsForSession(sessionId: SessionId): Promise<Sighting[]> {
    const db = await this.#open();
    const all = await db.getAllFromIndex('sightings', 'sessionId', sessionId);
    return all.sort((a, b) => a.startedAt - b.startedAt);
  }

  async listTimeline(filter: TimelineFilter = {}): Promise<TimelineEvent[]> {
    const db = await this.#open();
    const sightings = await db.getAllFromIndex('sightings', 'startedAt');
    const entities = new Map((await db.getAll('entities')).map((e) => [e.id, e]));

    const events: TimelineEvent[] = [];
    for (const sighting of sightings.reverse()) {
      const entity = entities.get(sighting.entityId);
      if (!entity) continue;
      if (filter.kinds?.length && !filter.kinds.includes(sighting.kind)) continue;
      if (filter.favorite && !entity.favorite) continue;
      if (filter.since && sighting.startedAt < filter.since) continue;
      if (filter.until && sighting.startedAt > filter.until) continue;

      const attributeText = sighting.attributes.map((a) => `${a.key} ${a.value}`);
      if (
        !matchesSearch(
          [entity.label, sighting.class, ...attributeText, ...profileSearchText(entity)],
          filter.search,
        )
      ) {
        continue;
      }

      events.push({
        id: sighting.id,
        entityId: sighting.entityId,
        entityLabel: entity.label,
        kind: sighting.kind,
        class: sighting.class,
        timestamp: sighting.startedAt,
        durationMs: sighting.durationMs,
        confidence: sighting.confidence,
        thumbnailId: sighting.thumbnailId,
        attributes: sighting.attributes,
        location: sighting.location,
        favorite: entity.favorite,
        // First sighting of an entity is flagged so the timeline can mark it NEW.
        isNewEntity: sighting.startedAt === entity.firstSeenAt,
      });

      if (filter.limit && events.length >= filter.limit) break;
    }
    return events;
  }

  /* ---- Attributes, notes, associations ---------------------------------- */

  async addAttributes(attributes: Attribute[]): Promise<void> {
    if (attributes.length === 0) return;
    const db = await this.#open();
    const tx = db.transaction('attributes', 'readwrite');
    await Promise.all(attributes.map((a) => tx.store.put(a)));
    await tx.done;
  }

  async listAttributes(entityId: EntityId): Promise<Attribute[]> {
    const db = await this.#open();
    const attributes = await db.getAllFromIndex('attributes', 'entityId', entityId);
    return attributes.sort((a, b) => b.observedAt - a.observedAt);
  }

  async addNote(note: Note): Promise<void> {
    const db = await this.#open();
    await db.put('notes', note);
  }

  async listNotes(entityId: EntityId): Promise<Note[]> {
    const db = await this.#open();
    const notes = await db.getAllFromIndex('notes', 'entityId', entityId);
    return notes.sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteNote(id: string): Promise<void> {
    const db = await this.#open();
    await db.delete('notes', id);
  }

  async recordAssociation(a: EntityId, b: EntityId, at: number): Promise<void> {
    if (a === b) return;
    const db = await this.#open();
    // Associations are symmetric, so both directions are written to keep
    // per-entity lookup a single index read.
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const key = associationKey(self, other);
      const existing = await db.get('associations', key);
      await db.put('associations', {
        ...(existing ?? { entityId: self, otherEntityId: other, count: 0, lastObservedAt: at }),
        id: key,
        count: (existing?.count ?? 0) + 1,
        lastObservedAt: at,
      } as Association & { id: string });
    }
  }

  /**
   * Writes an association verbatim rather than incrementing it.
   *
   * `recordAssociation` accumulates, which is right for a live observation but
   * wrong for a pulled row: the server's count is already absolute, and
   * incrementing it would inflate the tally on every sync.
   */
  async putAssociation(association: Association): Promise<void> {
    const db = await this.#open();
    const key = associationKey(association.entityId, association.otherEntityId);
    await db.put('associations', { ...association, id: key } as Association & { id: string });
  }

  async listAssociations(entityId: EntityId): Promise<Association[]> {
    const db = await this.#open();
    const associations = await db.getAllFromIndex('associations', 'entityId', entityId);
    return associations.sort((a, b) => b.count - a.count);
  }

  /* ---- Face descriptors -------------------------------------------------- */

  async putFaceEmbedding(record: FaceEmbeddingRecord): Promise<void> {
    const db = await this.#open();
    await db.put('faceEmbeddings', record);
  }

  /** Local-only helper used by the sync engine to build a row. */
  async getFaceEmbedding(id: string): Promise<FaceEmbeddingRecord | null> {
    const db = await this.#open();
    return (await db.get('faceEmbeddings', id)) ?? null;
  }

  async listFaceEmbeddings(): Promise<FaceEmbeddingRecord[]> {
    const db = await this.#open();
    return db.getAll('faceEmbeddings');
  }

  async listFaceEmbeddingsFor(entityId: EntityId): Promise<FaceEmbeddingRecord[]> {
    const db = await this.#open();
    return db.getAllFromIndex('faceEmbeddings', 'entityId', entityId);
  }

  async deleteFaceEmbedding(id: string): Promise<void> {
    const db = await this.#open();
    await db.delete('faceEmbeddings', id);
  }

  async purgeFaceEmbeddings(): Promise<void> {
    const db = await this.#open();
    await db.clear('faceEmbeddings');
  }

  /* ---- Media ------------------------------------------------------------ */

  async putMedia(record: MediaRecord): Promise<void> {
    const db = await this.#open();
    await db.put('media', record);
  }

  async getMedia(id: MediaId): Promise<MediaRecord | null> {
    const db = await this.#open();
    return (await db.get('media', id)) ?? null;
  }

  async deleteMedia(id: MediaId): Promise<void> {
    const db = await this.#open();
    await db.delete('media', id);
  }

  /* ---- Sync outbox ------------------------------------------------------ */

  /**
   * Records a sync intent.
   *
   * Entries are keyed per record rather than per edit, so ten rapid changes to
   * one entity collapse to a single pending upload of its final state. A
   * `delete` supersedes a pending `upsert` for the same record — uploading a
   * row and then deleting it is wasted round-trips, and the intermediate state
   * was never observed by anyone.
   */
  async enqueue(entry: Omit<OutboxEntry, 'queuedAt' | 'attempts'>): Promise<void> {
    const db = await this.#open();
    const existing = await db.get('outbox', entry.id);
    if (existing?.op === 'delete' && entry.op === 'upsert') return;
    await db.put('outbox', {
      ...entry,
      queuedAt: existing?.queuedAt ?? Date.now(),
      attempts: 0,
    });
  }

  /** Oldest-first, so causally-ordered edits replay in the order they happened. */
  async listOutbox(limit = 200): Promise<OutboxEntry[]> {
    const db = await this.#open();
    const entries = await db.getAllFromIndex('outbox', 'queuedAt');
    return entries.slice(0, limit);
  }

  async dequeue(id: string): Promise<void> {
    const db = await this.#open();
    await db.delete('outbox', id);
  }

  async markOutboxFailure(id: string, error: string): Promise<void> {
    const db = await this.#open();
    const existing = await db.get('outbox', id);
    if (!existing) return;
    await db.put('outbox', { ...existing, attempts: existing.attempts + 1, lastError: error });
  }

  async outboxSize(): Promise<number> {
    const db = await this.#open();
    return db.count('outbox');
  }

  async clearOutbox(): Promise<void> {
    const db = await this.#open();
    await db.clear('outbox');
  }

  /* ---- Sync cursors ----------------------------------------------------- */

  async getSyncState(key: string): Promise<string | number | null> {
    const db = await this.#open();
    return (await db.get('syncState', key))?.value ?? null;
  }

  async setSyncState(key: string, value: string | number | null): Promise<void> {
    const db = await this.#open();
    await db.put('syncState', { key, value });
  }

  /* ---- Maintenance ------------------------------------------------------ */

  async usage(): Promise<StorageUsage> {
    const db = await this.#open();
    const media = await db.getAll('media');
    const mediaBytes = media.reduce((sum, record) => sum + record.byteSize, 0);

    let quotaBytes: number | undefined;
    let usageBytes: number | undefined;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        quotaBytes = estimate.quota;
        usageBytes = estimate.usage;
      } catch {
        // Storage estimation is best-effort; absence is not an error.
      }
    }

    return {
      entities: await db.count('entities'),
      sightings: await db.count('sightings'),
      media: media.length,
      mediaBytes,
      notes: await db.count('notes'),
      sessions: await db.count('sessions'),
      faceEmbeddings: await db.count('faceEmbeddings'),
      quotaBytes,
      usageBytes,
    };
  }

  async purgeAll(): Promise<void> {
    const db = await this.#open();
    const stores = [
      'sessions',
      'entities',
      'sightings',
      'attributes',
      'notes',
      'associations',
      'media',
      'faceEmbeddings',
      'counters',
      'outbox',
      'syncState',
    ] as const;
    const tx = db.transaction(stores, 'readwrite');
    await Promise.all(stores.map((store) => tx.objectStore(store).clear()));
    await tx.done;
  }
}

/* -------------------------------------------------------------------------- */

/** Object stores present since the first release. */
function createV1Stores(db: IDBPDatabase<FlockraftDb>): void {
  const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
  sessions.createIndex('startedAt', 'startedAt');

  const entities = db.createObjectStore('entities', { keyPath: 'id' });
  entities.createIndex('kind', 'kind');
  entities.createIndex('lastSeenAt', 'lastSeenAt');
  // IndexedDB cannot index booleans; a string discriminant is used.
  entities.createIndex('favorite', 'favoriteKey' as never);

  const sightings = db.createObjectStore('sightings', { keyPath: 'id' });
  sightings.createIndex('entityId', 'entityId');
  sightings.createIndex('startedAt', 'startedAt');
  sightings.createIndex('sessionId', 'sessionId');

  const attributes = db.createObjectStore('attributes', { keyPath: 'id' });
  attributes.createIndex('entityId', 'entityId');

  const notes = db.createObjectStore('notes', { keyPath: 'id' });
  notes.createIndex('entityId', 'entityId');

  const associations = db.createObjectStore('associations', { keyPath: 'id' as never });
  associations.createIndex('entityId', 'entityId');

  const media = db.createObjectStore('media', { keyPath: 'id' });
  media.createIndex('entityId', 'entityId');

  db.createObjectStore('counters', { keyPath: 'key' });
}

/**
 * v2: sync support. Purely additive — an existing local database keeps every
 * observation it already holds, and a device that never signs in simply leaves
 * both stores empty.
 */
function createV2Stores(db: IDBPDatabase<FlockraftDb>): void {
  const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
  outbox.createIndex('queuedAt', 'queuedAt');
  db.createObjectStore('syncState', { keyPath: 'key' });
}

function createV3Stores(db: IDBPDatabase<FlockraftDb>): void {
  const embeddings = db.createObjectStore('faceEmbeddings', { keyPath: 'id' });
  embeddings.createIndex('entityId', 'entityId');
  embeddings.createIndex('createdAt', 'createdAt');
}

const associationKey = (a: EntityId, b: EntityId) => `${a}::${b}`;

/** IndexedDB cannot index a boolean, so a mirrored string key is stored. */
function withFavoriteKey(entity: Entity): Entity {
  return { ...entity, favoriteKey: entity.favorite ? 'true' : 'false' } as Entity;
}

/** Re-points every record in `store` from one entity id to another. */
async function reassign(
  db: IDBPDatabase<FlockraftDb>,
  store: 'sightings' | 'attributes' | 'notes' | 'media',
  index: 'entityId',
  from: EntityId,
  to: EntityId,
): Promise<void> {
  const records = await db.getAllFromIndex(store, index, from);
  for (const record of records) {
    await db.put(store, { ...record, entityId: to } as never);
  }
}
