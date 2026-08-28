/**
 * DURABLE STORAGE
 * ---------------------------------------------------------------------------
 * Asks the browser to treat this origin's storage as persistent.
 *
 * Without it, IndexedDB is "best-effort": Safari and Chrome are both entitled
 * to evict the whole origin under storage pressure, and Safari additionally
 * clears best-effort storage for sites left unvisited. For an app whose entire
 * value is a record that accumulates over weeks, that is the difference between
 * a memory and a cache.
 *
 * Granting is the browser's call, not ours — Chrome ties it to engagement and
 * an installed PWA, Safari grants it on request in most cases. A refusal is
 * reported rather than retried in a loop, so the privacy screen can say plainly
 * whether the record is durable instead of implying a guarantee that does not
 * exist.
 */

export type PersistenceOutcome = 'persisted' | 'best-effort' | 'unsupported';

export async function requestPersistentStorage(): Promise<PersistenceOutcome> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return 'unsupported';
  }
  try {
    // Asking again when it is already granted is harmless but pointless, and
    // some browsers count the prompt against the origin.
    if (navigator.storage.persisted && (await navigator.storage.persisted())) {
      return 'persisted';
    }
    return (await navigator.storage.persist()) ? 'persisted' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

/** Current state without asking for a grant. Used by the storage readout. */
export async function isStoragePersisted(): Promise<boolean | undefined> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return undefined;
  try {
    return await navigator.storage.persisted();
  } catch {
    return undefined;
  }
}
