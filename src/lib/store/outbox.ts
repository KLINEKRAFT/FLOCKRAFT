import type { EntityId, MediaId, SessionId, SightingId } from '@/types/domain';

/**
 * SYNC OUTBOX
 * ---------------------------------------------------------------------------
 * Every local mutation that needs to reach the server is appended here as an
 * intent, and drained by the sync engine when a session and a network exist.
 *
 * An outbox rather than "diff the tables on each sync" because:
 *
 *  - Deletes leave no row to diff. Without a recorded intent, deleting an
 *    entity offline would simply never propagate, and the next pull would
 *    resurrect it.
 *  - It survives being offline for days, across reloads and app restarts.
 *  - Draining is idempotent: every write is an upsert keyed by the record's
 *    own id, so replaying an entry that already landed is harmless. That
 *    matters because the tab can die between "server accepted" and "outbox
 *    entry removed".
 *
 * Entries carry only the record's identity, never a payload snapshot — the
 * current local state is read at drain time. That way ten rapid edits to one
 * entity cost one upload of the final state rather than ten of intermediate
 * states, and a stale payload can never overwrite a newer local value.
 */

export type OutboxTable =
  | 'sessions'
  | 'entities'
  | 'sightings'
  | 'attributes'
  | 'notes'
  | 'associations'
  | 'media';

export type OutboxOperation = 'upsert' | 'delete';

export interface OutboxEntry {
  /** `${table}:${op}:${recordId}` — deduplicates repeated edits to one record. */
  id: string;
  table: OutboxTable;
  op: OutboxOperation;
  recordId: string;
  /**
   * Composite keys (associations) and cascade context that cannot be recovered
   * from local state after a delete.
   */
  meta?: Record<string, string>;
  queuedAt: number;
  /** Failed attempts; used for backoff and to surface a stuck entry. */
  attempts: number;
  lastError?: string;
}

export type OutboxTarget =
  | { table: 'sessions'; id: SessionId }
  | { table: 'entities'; id: EntityId }
  | { table: 'sightings'; id: SightingId }
  | { table: 'attributes'; id: string }
  | { table: 'notes'; id: string }
  | { table: 'associations'; id: string; meta: { entityId: string; otherEntityId: string } }
  | { table: 'media'; id: MediaId };

/**
 * Builds the entry id.
 *
 * A delete supersedes any pending upsert for the same record, so the two share
 * a namespace per record and the engine resolves them at drain time — queueing
 * "upsert X" then "delete X" must not upload X and then delete it.
 */
export function outboxEntryId(table: OutboxTable, recordId: string): string {
  return `${table}:${recordId}`;
}

/** Entries that have failed this many times are reported rather than retried forever. */
export const MAX_OUTBOX_ATTEMPTS = 6;

/** Exponential backoff in ms, capped — a failing server must not be hammered. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
}
