import { IndexedDbRepository } from './indexedDb';
import { SyncingRepository } from './syncingRepository';
import type { ObservationRepository } from './repository';

export * from './repository';
export { IndexedDbRepository } from './indexedDb';
export { SyncingRepository } from './syncingRepository';
export type { OutboxEntry, OutboxTable } from './outbox';

/**
 * Repository selection.
 *
 * FLOCKRAFT is local-first by design: IndexedDB is the source of truth and the
 * app is fully functional with no account and no network. Signing in does not
 * swap the store — it wraps it, so every read stays local and instant while
 * mutations additionally record a sync intent.
 *
 * The local instance is a singleton because the sync engine and the UI must
 * share one connection and one outbox.
 */
let local: IndexedDbRepository | null = null;
let active: ObservationRepository | null = null;
let syncEnabled = false;

/** The underlying local store, needed by the sync engine directly. */
export function getLocalRepository(): IndexedDbRepository {
  local ??= new IndexedDbRepository();
  return local;
}

export function getRepository(): ObservationRepository {
  if (!active) {
    active = syncEnabled
      ? new SyncingRepository(getLocalRepository())
      : getLocalRepository();
  }
  return active;
}

/**
 * Turns outbox recording on or off. Called when a session begins or ends.
 *
 * Switching is cheap because both repositories share the same underlying
 * IndexedDB connection — no data moves, and nothing is re-read.
 */
export function setSyncEnabled(enabled: boolean): void {
  if (enabled === syncEnabled) return;
  syncEnabled = enabled;
  active = null;
}

export function isSyncEnabled(): boolean {
  return syncEnabled;
}

/** Test seam — allows a fake repository to be injected. */
export function setRepository(repository: ObservationRepository): void {
  active = repository;
}
