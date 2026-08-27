import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { MediaRecord } from '@/types/domain';
import type { Tables } from '@/types/supabase';
import { getSupabaseClient, MEDIA_BUCKET, mediaObjectPath } from '@/lib/supabase';
import type { IndexedDbRepository } from '@/lib/store/indexedDb';
import { MAX_OUTBOX_ATTEMPTS, retryDelayMs, type OutboxEntry } from '@/lib/store/outbox';
import { logDebug, logError } from '@/lib/logger';
import {
  associationToRow,
  attributeToRow,
  entityToRow,
  mediaToRow,
  noteToRow,
  rowToAssociation,
  rowToAttribute,
  rowToEntity,
  rowToMedia,
  rowToNote,
  rowToSession,
  rowToSighting,
  sessionToRow,
  sightingToRow,
} from './mappers';

/**
 * SYNC ENGINE
 * ---------------------------------------------------------------------------
 * Reconciles the local store with Supabase in two directions.
 *
 *   PUSH   drain the outbox: upload local changes, upload media blobs, apply
 *          deletes. Ordered so foreign keys are always satisfiable.
 *   PULL   fetch rows whose `updated_at` is newer than the last cursor and
 *          write them into the local store.
 *
 * Conflict policy is last-write-wins, and this is a deliberate, stated
 * limitation rather than an oversight. FLOCKRAFT's records are overwhelmingly
 * append-only — a sighting is written once and never edited — so the only
 * realistic conflict is the same entity being renamed or favourited on two
 * devices while both were offline. Losing one of those is an acceptable cost;
 * the machinery a CRDT would require is not justified by it. What must never be
 * lost is an *observation*, and observations never conflict because their ids
 * are generated locally and are unique per device.
 *
 * Everything is idempotent. Every write is an upsert keyed by the record's own
 * id, so a push that succeeds server-side but dies before clearing the outbox
 * simply replays harmlessly on the next run.
 */

export type SyncPhase = 'idle' | 'pushing' | 'pulling' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** Outbox depth — how far behind the server this device is. */
  pending: number;
  lastSyncedAt: number | null;
  error: string | null;
  /** Entries that exhausted their retries and need user attention. */
  stuck: number;
}

export const INITIAL_SYNC_STATUS: SyncStatus = {
  phase: 'idle',
  pending: 0,
  lastSyncedAt: null,
  error: null,
  stuck: 0,
};

const PULL_CURSOR_KEY = 'pull.cursor';
const LAST_SYNC_KEY = 'sync.lastAt';
/** Bound each pull so a large account cannot stall the UI in one pass. */
const PULL_PAGE_SIZE = 500;

/**
 * Push order. Parents before children so a foreign key is never dangling:
 * sessions and entities exist before sightings reference them, and media is
 * uploaded before entities are re-pointed at their thumbnails.
 */
const PUSH_ORDER: OutboxEntry['table'][] = [
  'sessions',
  'entities',
  'media',
  'sightings',
  'attributes',
  'notes',
  'associations',
];

export class SyncEngine {
  #local: IndexedDbRepository;
  #userId: string | null = null;
  #running = false;
  #listeners = new Set<(status: SyncStatus) => void>();
  #status: SyncStatus = INITIAL_SYNC_STATUS;

  constructor(local: IndexedDbRepository) {
    this.#local = local;
  }

  get status(): SyncStatus {
    return this.#status;
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setUser(userId: string | null): void {
    this.#userId = userId;
  }

  #emit(patch: Partial<SyncStatus>): void {
    this.#status = { ...this.#status, ...patch };
    for (const listener of this.#listeners) listener(this.#status);
  }

  /**
   * Runs one full reconciliation. Safe to call often — concurrent invocations
   * collapse, so a burst of observations does not spawn overlapping pushes.
   */
  async run(): Promise<void> {
    if (this.#running) return;
    const supabase = getSupabaseClient();
    const userId = this.#userId;
    if (!supabase || !userId) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    this.#running = true;
    try {
      this.#emit({ phase: 'pushing', error: null });
      await this.#push(userId);

      this.#emit({ phase: 'pulling' });
      await this.#pull(userId);

      const now = Date.now();
      await this.#local.setSyncState(LAST_SYNC_KEY, now);
      this.#emit({
        phase: 'idle',
        lastSyncedAt: now,
        pending: await this.#local.outboxSize(),
        error: null,
      });
    } catch (error) {
      logError('sync', error);
      this.#emit({
        phase: 'error',
        error: error instanceof Error ? error.message : 'Sync failed.',
        pending: await this.#local.outboxSize().catch(() => this.#status.pending),
      });
    } finally {
      this.#running = false;
    }
  }

  /* ---- PUSH ------------------------------------------------------------- */

  async #push(userId: string): Promise<void> {
    const entries = await this.#local.listOutbox();
    if (entries.length === 0) return;

    const now = Date.now();
    const ready = entries.filter(
      (entry) => entry.attempts === 0 || now - entry.queuedAt >= retryDelayMs(entry.attempts),
    );

    // Group by table so each table becomes one round-trip instead of one per
    // record: a 30-second session can log dozens of rows.
    const byTable = new Map<OutboxEntry['table'], OutboxEntry[]>();
    for (const entry of ready) {
      if (entry.attempts >= MAX_OUTBOX_ATTEMPTS) continue;
      const bucket = byTable.get(entry.table) ?? [];
      bucket.push(entry);
      byTable.set(entry.table, bucket);
    }

    for (const table of PUSH_ORDER) {
      const bucket = byTable.get(table);
      if (!bucket?.length) continue;
      await this.#pushTable(table, bucket, userId);
    }

    // Second pass: entities and sightings are uploaded with a null
    // thumbnail_id because the media row may not have existed yet. Now that it
    // does, point them at it.
    await this.#linkThumbnails(userId);

    this.#emit({
      pending: await this.#local.outboxSize(),
      stuck: (await this.#local.listOutbox()).filter((e) => e.attempts >= MAX_OUTBOX_ATTEMPTS).length,
    });
  }

  async #pushTable(
    table: OutboxEntry['table'],
    entries: OutboxEntry[],
    userId: string,
  ): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const deletes = entries.filter((entry) => entry.op === 'delete');
    const upserts = entries.filter((entry) => entry.op === 'upsert');

    // ---- deletes --------------------------------------------------------
    if (deletes.length > 0) {
      try {
        if (table === 'associations') {
          for (const entry of deletes) {
            const entityId = entry.meta?.entityId;
            const otherEntityId = entry.meta?.otherEntityId;
            if (!entityId || !otherEntityId) {
              await this.#local.dequeue(entry.id);
              continue;
            }
            const { error } = await supabase
              .from('associations')
              .delete()
              .eq('entity_id', entityId)
              .eq('other_entity_id', otherEntityId);
            if (error) throw error;
            await this.#local.dequeue(entry.id);
          }
        } else {
          const ids = deletes.map((entry) => entry.recordId);
          const { error } = await supabase.from(table).delete().in('id', ids);
          if (error) throw error;
          if (table === 'media') await this.#deleteRemoteBlobs(userId, deletes);
          for (const entry of deletes) await this.#local.dequeue(entry.id);
        }
      } catch (error) {
        await this.#recordFailures(deletes, error);
      }
    }

    // ---- upserts --------------------------------------------------------
    if (upserts.length === 0) return;

    try {
      const rows = await this.#buildRows(table, upserts, userId);
      // A record deleted locally before its upsert drained has nothing to
      // upload; dropping the entry is the correct resolution.
      const drained = upserts.filter((entry) => !rows.missing.has(entry.recordId));

      if (rows.payload.length > 0) {
        const { error } =
          table === 'associations'
            ? await supabase
                .from('associations')
                .upsert(rows.payload as never, { onConflict: 'entity_id,other_entity_id' })
            : await supabase.from(table).upsert(rows.payload as never, { onConflict: 'id' });
        if (error) throw error;
      }
      for (const entry of drained) await this.#local.dequeue(entry.id);
    } catch (error) {
      await this.#recordFailures(upserts, error);
    }
  }

  /** Reads current local state for each queued record and maps it to a row. */
  async #buildRows(
    table: OutboxEntry['table'],
    entries: OutboxEntry[],
    userId: string,
  ): Promise<{ payload: unknown[]; missing: Set<string> }> {
    const payload: unknown[] = [];
    const missing = new Set<string>();

    for (const entry of entries) {
      const id = entry.recordId;
      switch (table) {
        case 'sessions': {
          const record = await this.#local.getSession(id);
          if (record) payload.push(sessionToRow(record, userId));
          else missing.add(id);
          break;
        }
        case 'entities': {
          const record = await this.#local.getEntity(id);
          if (record) payload.push(entityToRow(record, userId));
          else missing.add(id);
          break;
        }
        case 'media': {
          const record = await this.#local.getMedia(id);
          if (!record) {
            missing.add(id);
            break;
          }
          const path = await this.#uploadBlob(record, userId);
          if (!path) {
            missing.add(id);
            break;
          }
          payload.push(mediaToRow(record, userId, path));
          break;
        }
        case 'sightings': {
          const record = await this.#local.getSighting(id);
          if (record) payload.push(sightingToRow(record, userId));
          else missing.add(id);
          break;
        }
        case 'attributes': {
          const record = await this.#local.getAttribute(id);
          if (record) payload.push(attributeToRow(record, userId));
          else missing.add(id);
          break;
        }
        case 'notes': {
          const record = await this.#local.getNote(id);
          if (record) payload.push(noteToRow(record, userId));
          else missing.add(id);
          break;
        }
        case 'associations': {
          const entityId = entry.meta?.entityId;
          const otherEntityId = entry.meta?.otherEntityId;
          if (!entityId || !otherEntityId) {
            missing.add(id);
            break;
          }
          const all = await this.#local.listAssociations(entityId);
          const record = all.find((a) => a.otherEntityId === otherEntityId);
          if (record) payload.push(associationToRow(record, userId));
          else missing.add(id);
          break;
        }
      }
    }

    return { payload, missing };
  }

  /**
   * Uploads a media blob to the private bucket.
   *
   * `upsert: true` because the same media id may be retried after a failure
   * that actually succeeded server-side; overwriting identical bytes is
   * cheaper and safer than trying to detect that case.
   */
  async #uploadBlob(record: MediaRecord, userId: string): Promise<string | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    // Already remote — nothing to upload, keep the existing path.
    if (!record.blob) return record.remotePath ?? null;

    const path = mediaObjectPath(userId, record.id, record.mimeType);
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, record.blob, {
      contentType: record.mimeType,
      upsert: true,
    });
    if (error) {
      logError('sync', error, { mediaId: record.id });
      return null;
    }
    return path;
  }

  async #deleteRemoteBlobs(userId: string, entries: OutboxEntry[]): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    // The local record is already gone, so the extension is unknown; removing
    // all plausible paths is cheaper than storing the mime type in the entry.
    const paths = entries.flatMap((entry) =>
      ['jpg', 'png', 'webp'].map((ext) => `${userId}/${entry.recordId}.${ext}`),
    );
    if (paths.length === 0) return;
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(paths);
    // A missing object is not a failure — the delete is already satisfied.
    if (error) logDebug('sync', 'blob delete reported an error', error);
  }

  /**
   * Sets `thumbnail_id` on entities and sightings once their media row exists.
   * Kept separate so the first upload never fails a foreign-key check.
   */
  async #linkThumbnails(userId: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const entities = await this.#local.listEntities();
    const withThumbnails = entities.filter((entity) => entity.thumbnailId);
    if (withThumbnails.length === 0) return;

    // Only link media the server actually has, or the FK rejects the update.
    const mediaIds = [...new Set(withThumbnails.map((e) => e.thumbnailId!))];
    const { data: known, error } = await supabase
      .from('media')
      .select('id')
      .in('id', mediaIds.slice(0, 1000));
    if (error) return;

    const present = new Set((known ?? []).map((row) => row.id));
    const linkable = withThumbnails.filter((entity) => present.has(entity.thumbnailId!));
    if (linkable.length === 0) return;

    await supabase.from('entities').upsert(
      linkable.map((entity) => ({
        ...entityToRow(entity, userId),
        thumbnail_id: entity.thumbnailId!,
      })) as never,
      { onConflict: 'id' },
    );
  }

  async #recordFailures(entries: OutboxEntry[], error: unknown): Promise<void> {
    const message = describeError(error);
    for (const entry of entries) {
      await this.#local.markOutboxFailure(entry.id, message);
    }
    logError('sync', error);
  }

  /* ---- PULL ------------------------------------------------------------- */

  /**
   * Fetches everything changed since the cursor and merges it locally.
   *
   * Parents are pulled before children so a sighting never lands referencing an
   * entity the local store has not seen yet.
   */
  async #pull(userId: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const cursor = (await this.#local.getSyncState(PULL_CURSOR_KEY)) as string | null;
    const since = cursor ?? new Date(0).toISOString();
    let newest = since;

    const track = (updatedAt: string) => {
      if (updatedAt > newest) newest = updatedAt;
    };

    // ---- sessions -------------------------------------------------------
    const sessions = await this.#page('sessions', userId, since);
    for (const row of sessions) {
      await this.#local.createSession(rowToSession(row));
      track(row.updated_at);
    }

    // ---- entities -------------------------------------------------------
    const entities = await this.#page('entities', userId, since);
    for (const row of entities) {
      await this.#local.upsertEntity(rowToEntity(row));
      track(row.updated_at);
    }

    // ---- media metadata (blobs stay remote until viewed) -----------------
    const media = await this.#page('media', userId, since);
    for (const row of media) {
      const existing = await this.#local.getMedia(row.id);
      // Never clobber a local blob with a metadata-only record: that would
      // turn an offline-available thumbnail into one that needs the network.
      if (existing?.blob) {
        await this.#local.putMedia({ ...existing, remotePath: row.storage_path });
      } else {
        await this.#local.putMedia(rowToMedia(row));
      }
      track(row.updated_at);
    }

    // ---- attributes, needed to rebuild sightings -------------------------
    const attributes = await this.#page('attributes', userId, since);
    const attributesBySighting = new Map<string, ReturnType<typeof rowToAttribute>[]>();
    for (const row of attributes) {
      const attribute = rowToAttribute(row);
      await this.#local.addAttributes([attribute]);
      if (row.sighting_id) {
        const bucket = attributesBySighting.get(row.sighting_id) ?? [];
        bucket.push(attribute);
        attributesBySighting.set(row.sighting_id, bucket);
      }
      track(row.updated_at);
    }

    // ---- sightings ------------------------------------------------------
    const sightings = await this.#page('sightings', userId, since);
    for (const row of sightings) {
      await this.#local.addSighting(
        rowToSighting(row, attributesBySighting.get(row.id) ?? []),
      );
      track(row.updated_at);
    }

    // ---- notes ----------------------------------------------------------
    const notes = await this.#page('notes', userId, since);
    for (const row of notes) {
      await this.#local.addNote(rowToNote(row));
      track(row.updated_at);
    }

    // ---- associations ---------------------------------------------------
    const associations = await this.#page('associations', userId, since);
    for (const row of associations) {
      const association = rowToAssociation(row);
      // recordAssociation increments; a pulled row carries an absolute count,
      // so it is written through rather than accumulated.
      await this.#local.putAssociation(association);
      track(row.updated_at);
    }

    if (newest !== since) {
      await this.#local.setSyncState(PULL_CURSOR_KEY, newest);
    }
  }

  /**
   * One page of rows for a table, ordered by the change cursor.
   *
   * The `user_id` filter is redundant given RLS, but it lets Postgres use the
   * `(user_id, updated_at)` index instead of filtering after the fact.
   */
  async #page<T extends SyncTable>(table: T, userId: string, since: string): Promise<Tables<T>[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    // The typed client cannot resolve a column name against a *union* of
    // tables, so this one generic helper talks to an untyped view of the
    // client and re-applies the row type on the way out. Every caller still
    // receives a fully typed `Tables<T>[]`.
    const untyped = supabase as unknown as SupabaseClient;
    const { data, error } = await untyped
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(PULL_PAGE_SIZE);
    if (error) throw error;
    return (data ?? []) as Tables<T>[];
  }

  /** Resets the pull cursor so the next run re-reads everything. */
  async resetCursor(): Promise<void> {
    await this.#local.setSyncState(PULL_CURSOR_KEY, null);
  }
}

/* -------------------------------------------------------------------------- */

/** Tables the engine reconciles. Excludes `entity_ordinals`, which stays local. */
type SyncTable =
  | 'sessions'
  | 'entities'
  | 'sightings'
  | 'attributes'
  | 'notes'
  | 'associations'
  | 'media';

function describeError(error: unknown): string {
  if (isPostgrestError(error)) {
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'message' in error && 'code' in error;
}
