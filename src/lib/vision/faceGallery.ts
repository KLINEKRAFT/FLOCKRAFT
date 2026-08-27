import type { EntityId, FaceEmbeddingRecord } from '@/types/domain';
import type { ObservationRepository } from '@/lib/store';
import { GALLERY_SIZE, pruneGallery } from './faceMatcher';

/**
 * FACE GALLERY
 * ---------------------------------------------------------------------------
 * Holds the stored descriptors in memory so a promotion can match without a
 * full storage read, and writes new ones back through the repository.
 *
 * The caching discipline mirrors `CandidatePool` — first load awaited, later
 * refreshes in the background, one in-flight load shared — for the same reason:
 * a detection tick must never stall on IndexedDB.
 *
 * Memory is the constraint that shapes this. A descriptor is 1024 floats, so
 * 4 KB each; an office that sees a few hundred people accumulates thousands.
 * `maxDescriptors` caps what is held resident, newest first, at roughly 8 MB by
 * default. Beyond that cap a subject is still stored and still exportable — it
 * simply stops being compared against, which fails toward "not recognised"
 * rather than toward a wrong match.
 */

export interface FaceGalleryOptions {
  /** Descriptors held resident. 2000 x 4 KB is about 8 MB. */
  maxDescriptors?: number;
  ttlMs?: number;
}

export class FaceGallery {
  readonly #repository: ObservationRepository;
  readonly #maxDescriptors: number;
  readonly #ttlMs: number;

  #records: FaceEmbeddingRecord[] = [];
  #loadedAt = 0;
  #loaded = false;
  #inflight: Promise<void> | null = null;

  constructor(repository: ObservationRepository, options: FaceGalleryOptions = {}) {
    this.#repository = repository;
    this.#maxDescriptors = options.maxDescriptors ?? 2000;
    this.#ttlMs = options.ttlMs ?? 60_000;
  }

  /** Resident descriptors, loading on first use and refreshing when stale. */
  async all(now: number): Promise<FaceEmbeddingRecord[]> {
    if (!this.#loaded) await this.#refresh(now);
    else if (now - this.#loadedAt > this.#ttlMs) void this.#refresh(now);
    return this.#records;
  }

  /** Starts a load without waiting, while a track is still accruing dwell. */
  prefetch(now: number): void {
    if (this.#loaded || this.#inflight) return;
    void this.#refresh(now);
  }

  /**
   * Persists a descriptor and keeps that entity's gallery within bounds.
   *
   * Pruning happens on write rather than on read so the storage cost is
   * bounded too — an entity seen a hundred times would otherwise accumulate a
   * hundred near-identical descriptors, of which the first six are worth
   * keeping and the rest are storage and sync traffic for nothing.
   */
  async add(record: FaceEmbeddingRecord): Promise<void> {
    await this.#repository.putFaceEmbedding(record);
    this.#records = [record, ...this.#records].slice(0, this.#maxDescriptors);

    const forEntity = await this.#repository.listFaceEmbeddingsFor(record.entityId);
    if (forEntity.length <= GALLERY_SIZE) return;

    const keep = new Set(pruneGallery(forEntity).map((entry) => entry.id));
    for (const entry of forEntity) {
      if (keep.has(entry.id)) continue;
      await this.#repository.deleteFaceEmbedding(entry.id);
      this.#records = this.#records.filter((held) => held.id !== entry.id);
    }
  }

  /**
   * Re-points descriptors from a provisional entity onto a confirmed one.
   *
   * Called when the operator confirms a match. The descriptors captured against
   * the provisional record are genuine readings of the same person, so they
   * join the confirmed subject's gallery rather than being discarded — this is
   * how recognition improves each time a match is confirmed.
   */
  async reassign(fromEntityId: EntityId, toEntityId: EntityId): Promise<void> {
    const moving = await this.#repository.listFaceEmbeddingsFor(fromEntityId);
    for (const record of moving) {
      await this.#repository.deleteFaceEmbedding(record.id);
      await this.#repository.putFaceEmbedding({ ...record, entityId: toEntityId });
    }

    this.#records = this.#records.map((record) =>
      record.entityId === fromEntityId ? { ...record, entityId: toEntityId } : record,
    );

    const merged = await this.#repository.listFaceEmbeddingsFor(toEntityId);
    if (merged.length <= GALLERY_SIZE) return;
    const keep = new Set(pruneGallery(merged).map((entry) => entry.id));
    for (const entry of merged) {
      if (keep.has(entry.id)) continue;
      await this.#repository.deleteFaceEmbedding(entry.id);
      this.#records = this.#records.filter((held) => held.id !== entry.id);
    }
  }

  async #refresh(now: number): Promise<void> {
    if (this.#inflight) return this.#inflight;
    this.#inflight = this.#load(now).finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  async #load(now: number): Promise<void> {
    try {
      const all = await this.#repository.listFaceEmbeddings();
      all.sort((a, b) => b.createdAt - a.createdAt);
      this.#records = all.slice(0, this.#maxDescriptors);
    } catch {
      // Recognition degrades to nothing; recording continues unaffected.
      this.#records = [];
    } finally {
      this.#loaded = true;
      this.#loadedAt = now;
    }
  }
}
