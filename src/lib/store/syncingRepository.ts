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
  TimelineEvent,
} from '@/types/domain';
import type { IndexedDbRepository } from './indexedDb';
import { outboxEntryId, type OutboxTable } from './outbox';
import type {
  DeleteCascade,
  PurgeCutoffs,
  PurgeResult,
  EntityFilter,
  ObservationRepository,
  StorageUsage,
  TimelineFilter,
} from './repository';

/**
 * SYNCING REPOSITORY
 * ---------------------------------------------------------------------------
 * A decorator over the local store that records a sync intent for every
 * mutation, and delegates everything else untouched.
 *
 * Why a decorator rather than a second repository implementation:
 *
 *  - Reads never change. The timeline, entity list and profile keep reading
 *    IndexedDB at local speed, online or off. Swapping in a network-backed
 *    repository would have turned every scroll into a round-trip and made the
 *    app unusable on a bad connection — the opposite of what a field tool needs.
 *  - Sync becomes a property of the session, not of the architecture. Signed
 *    out, the plain local repository is used and no outbox rows accumulate.
 *  - The sync engine has exactly one place to learn what changed, so it can
 *    never miss a delete.
 */
export class SyncingRepository implements ObservationRepository {
  readonly id = 'indexeddb+sync';

  constructor(private readonly local: IndexedDbRepository) {}

  ready(): Promise<void> {
    return this.local.ready();
  }

  /** Records an intent. Failures here must never fail the local write. */
  async #track(table: OutboxTable, op: 'upsert' | 'delete', recordId: string, meta?: Record<string, string>) {
    try {
      await this.local.enqueue({ id: outboxEntryId(table, recordId), table, op, recordId, meta });
    } catch {
      // A full outbox or a storage quota error must not lose the observation
      // itself. The record stays local and is picked up by the next full
      // reconciliation rather than being dropped.
    }
  }

  /* ---- Sessions --------------------------------------------------------- */

  async createSession(session: Session): Promise<void> {
    await this.local.createSession(session);
    await this.#track('sessions', 'upsert', session.id);
  }

  async updateSession(id: SessionId, patch: Partial<Session>): Promise<void> {
    await this.local.updateSession(id, patch);
    await this.#track('sessions', 'upsert', id);
  }

  getSession(id: SessionId): Promise<Session | null> {
    return this.local.getSession(id);
  }

  listSessions(limit?: number): Promise<Session[]> {
    return this.local.listSessions(limit);
  }

  /* ---- Entities --------------------------------------------------------- */

  async upsertEntity(entity: Entity): Promise<void> {
    await this.local.upsertEntity(entity);
    await this.#track('entities', 'upsert', entity.id);
  }

  getEntity(id: EntityId): Promise<Entity | null> {
    return this.local.getEntity(id);
  }

  listEntities(filter?: EntityFilter): Promise<Entity[]> {
    return this.local.listEntities(filter);
  }

  nextOrdinal(kind: EntityKind): Promise<number> {
    // Ordinals stay local. Allocating them server-side would put a network
    // round-trip on the observation path, and a designation that differs
    // between devices is a cosmetic conflict, not a correctness one.
    return this.local.nextOrdinal(kind);
  }

  async mergeEntities(targetId: EntityId, sourceIds: EntityId[]): Promise<void> {
    // Capture what the merge will touch before it happens: afterwards the
    // source entities are gone and their dependents have been re-pointed, so
    // there is nothing left to enumerate.
    const moved = await this.#dependentsOf(sourceIds);

    await this.local.mergeEntities(targetId, sourceIds);

    await this.#track('entities', 'upsert', targetId);
    for (const sourceId of sourceIds) {
      await this.#track('entities', 'delete', sourceId);
    }
    for (const record of moved) {
      await this.#track(record.table, 'upsert', record.id);
    }
  }

  async splitEntity(entityId: EntityId, sightingIds: string[]): Promise<EntityId> {
    const createdId = await this.local.splitEntity(entityId, sightingIds);

    await this.#track('entities', 'upsert', entityId);
    await this.#track('entities', 'upsert', createdId);
    for (const sightingId of sightingIds) {
      await this.#track('sightings', 'upsert', sightingId);
    }
    // Attributes and media followed the moved sightings, so their owner
    // changed and they need re-uploading too.
    for (const record of await this.#dependentsOf([createdId])) {
      await this.#track(record.table, 'upsert', record.id);
    }
    return createdId;
  }

  async deleteEntity(id: EntityId, cascade: DeleteCascade): Promise<void> {
    // Same ordering problem as merge: enumerate before the rows disappear.
    const dependents = await this.#dependentsOf([id]);
    const associations = await this.local.listAssociations(id);

    await this.local.deleteEntity(id, cascade);

    await this.#track('entities', 'delete', id);
    if (cascade.sightings) {
      for (const record of dependents) {
        if (record.table === 'sightings' || record.table === 'attributes') {
          await this.#track(record.table, 'delete', record.id);
        }
      }
    }
    if (cascade.media) {
      for (const record of dependents) {
        if (record.table === 'media') await this.#track('media', 'delete', record.id);
      }
    }
    if (cascade.notes) {
      for (const record of dependents) {
        if (record.table === 'notes') await this.#track('notes', 'delete', record.id);
      }
    }
    if (cascade.associations) {
      for (const association of associations) {
        await this.#track('associations', 'delete', `${association.entityId}::${association.otherEntityId}`, {
          entityId: association.entityId,
          otherEntityId: association.otherEntityId,
        });
      }
    }
  }

  /* ---- Sightings -------------------------------------------------------- */

  async addSighting(sighting: Sighting): Promise<void> {
    await this.local.addSighting(sighting);
    await this.#track('sightings', 'upsert', sighting.id);
  }

  listSightings(entityId: EntityId): Promise<Sighting[]> {
    return this.local.listSightings(entityId);
  }

  listSightingsForSession(sessionId: SessionId): Promise<Sighting[]> {
    return this.local.listSightingsForSession(sessionId);
  }

  listTimeline(filter?: TimelineFilter): Promise<TimelineEvent[]> {
    return this.local.listTimeline(filter);
  }

  /* ---- Attributes, notes, associations ---------------------------------- */

  async addAttributes(attributes: Attribute[]): Promise<void> {
    await this.local.addAttributes(attributes);
    for (const attribute of attributes) {
      await this.#track('attributes', 'upsert', attribute.id);
    }
  }

  listAttributes(entityId: EntityId): Promise<Attribute[]> {
    return this.local.listAttributes(entityId);
  }

  async addNote(note: Note): Promise<void> {
    await this.local.addNote(note);
    await this.#track('notes', 'upsert', note.id);
  }

  listNotes(entityId: EntityId): Promise<Note[]> {
    return this.local.listNotes(entityId);
  }

  async deleteNote(id: string): Promise<void> {
    await this.local.deleteNote(id);
    await this.#track('notes', 'delete', id);
  }

  async recordAssociation(a: EntityId, b: EntityId, at: number): Promise<void> {
    await this.local.recordAssociation(a, b, at);
    // Stored in both directions locally; both rows exist server-side too.
    await this.#track('associations', 'upsert', `${a}::${b}`, { entityId: a, otherEntityId: b });
    await this.#track('associations', 'upsert', `${b}::${a}`, { entityId: b, otherEntityId: a });
  }

  listAssociations(entityId: EntityId): Promise<Association[]> {
    return this.local.listAssociations(entityId);
  }

  /* ---- Face descriptors -------------------------------------------------- */

  async putFaceEmbedding(record: FaceEmbeddingRecord): Promise<void> {
    await this.local.putFaceEmbedding(record);
    await this.#track('face_embeddings', 'upsert', record.id);
  }

  listFaceEmbeddings(): Promise<FaceEmbeddingRecord[]> {
    return this.local.listFaceEmbeddings();
  }

  listFaceEmbeddingsFor(entityId: EntityId): Promise<FaceEmbeddingRecord[]> {
    return this.local.listFaceEmbeddingsFor(entityId);
  }

  async deleteFaceEmbedding(id: string): Promise<void> {
    await this.local.deleteFaceEmbedding(id);
    await this.#track('face_embeddings', 'delete', id);
  }

  /**
   * Deleting every descriptor is tracked per record, not as one bulk intent:
   * the remote rows must go individually, and a purge the operator performed
   * for privacy reasons is the last thing that should silently fail to
   * propagate.
   */
  async purgeFaceEmbeddings(): Promise<void> {
    const existing = await this.local.listFaceEmbeddings();
    await this.local.purgeFaceEmbeddings();
    for (const record of existing) {
      await this.#track('face_embeddings', 'delete', record.id);
    }
  }

  /* ---- Media ------------------------------------------------------------ */

  async putMedia(record: MediaRecord): Promise<void> {
    await this.local.putMedia(record);
    await this.#track('media', 'upsert', record.id);
  }

  getMedia(id: MediaId): Promise<MediaRecord | null> {
    return this.local.getMedia(id);
  }

  async deleteMedia(id: MediaId): Promise<void> {
    await this.local.deleteMedia(id);
    await this.#track('media', 'delete', id);
  }

  /**
   * A retention sweep, with every deletion recorded for the remote.
   *
   * Without this the sweep would clear the device and the very next pull would
   * restore all of it: the remote still holds rows the local store no longer
   * has, and nothing would have told it they were meant to go. A retention
   * policy that silently un-deletes itself is worse than none, because the
   * operator believes it worked.
   */
  async purgeExpired(cutoffs: PurgeCutoffs): Promise<PurgeResult> {
    const result = await this.local.purgeExpired(cutoffs);
    for (const id of result.sightings) await this.#track('sightings', 'delete', id);
    for (const id of result.entities) await this.#track('entities', 'delete', id);
    for (const id of result.sessions) await this.#track('sessions', 'delete', id);
    for (const id of result.media) await this.#track('media', 'delete', id);
    for (const id of result.faceEmbeddings) await this.#track('face_embeddings', 'delete', id);
    return result;
  }

  /* ---- Maintenance ------------------------------------------------------ */

  usage(): Promise<StorageUsage> {
    return this.local.usage();
  }

  async purgeAll(): Promise<void> {
    // Purge is explicitly a *local* wipe. Queuing deletes for every remote row
    // would turn "free space on this phone" into "destroy the account's data
    // everywhere", which is not what the button says. Clearing the outbox stops
    // pending uploads referencing records that no longer exist locally.
    await this.local.purgeAll();
  }

  /**
   * Every record that belongs to the given entities, flattened for tracking.
   * Read before a destructive operation, since afterwards there is nothing to
   * enumerate.
   */
  async #dependentsOf(
    entityIds: EntityId[],
  ): Promise<Array<{ table: OutboxTable; id: string }>> {
    const records: Array<{ table: OutboxTable; id: string }> = [];
    for (const entityId of entityIds) {
      for (const sighting of await this.local.listSightings(entityId)) {
        records.push({ table: 'sightings', id: sighting.id });
        if (sighting.thumbnailId) records.push({ table: 'media', id: sighting.thumbnailId });
      }
      for (const attribute of await this.local.listAttributes(entityId)) {
        records.push({ table: 'attributes', id: attribute.id });
      }
      for (const note of await this.local.listNotes(entityId)) {
        records.push({ table: 'notes', id: note.id });
      }
    }
    return records;
  }
}
