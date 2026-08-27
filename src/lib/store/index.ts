import { IndexedDbRepository } from './indexedDb';
import type { ObservationRepository } from './repository';

export * from './repository';
export { IndexedDbRepository } from './indexedDb';

let instance: ObservationRepository | null = null;

/**
 * Returns the active repository.
 *
 * FLOCKRAFT is local-first by design: IndexedDB is the source of truth and the
 * app is fully functional with no account and no network. The Supabase adapter
 * (schema in `supabase/migrations`) layers sync on top of this rather than
 * replacing it — when it lands, this selector is the only call site that
 * changes.
 */
export function getRepository(): ObservationRepository {
  instance ??= new IndexedDbRepository();
  return instance;
}

/** Test seam — allows a fake repository to be injected. */
export function setRepository(repository: ObservationRepository): void {
  instance = repository;
}
