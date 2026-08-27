import type { Attribute, Entity, EntityId, EntityKind } from '@/types/domain';
import type { ObservationRepository } from '@/lib/store';

/**
 * CANDIDATE POOL
 * ---------------------------------------------------------------------------
 * Supplies the entity matcher with something to match *against*.
 *
 * The recorder previously proposed matches only against entities it had itself
 * created since the pipeline started. That made returning-subject recognition
 * impossible by construction: on a freshly opened tab the pool was empty, so
 * the first person through the door could only ever be new, and so could the
 * second, and so on. Every session began with total amnesia regardless of how
 * much the store already remembered.
 *
 * This reads the durable store instead. Three properties matter:
 *
 *   Bounded    Only the most recently seen `maxCandidates` entities of a kind
 *              are considered. The matcher's own recency prior already decays
 *              to nothing over a day, so an unbounded pool would add cost
 *              without adding matches.
 *   Cached     A refresh reads one entity list plus one attribute query per
 *              candidate. That is far too much to repeat on every promotion,
 *              so results are held for `ttlMs`.
 *   Non-blocking after the first load. The initial load is awaited because an
 *              empty pool is precisely the bug being fixed; subsequent
 *              refreshes happen in the background while the caller keeps using
 *              the slightly stale snapshot. A detection tick must never stall
 *              on storage.
 *
 * None of this makes matching *confident* — the underlying signals are still
 * colour agreement and recency, and a proposal still requires the operator to
 * confirm it. It only means the proposal is drawn from everything FLOCKRAFT
 * remembers rather than from the last few minutes.
 */

export interface CandidateSet {
  entities: Entity[];
  attributesByEntity: Map<EntityId, Attribute[]>;
}

const EMPTY: CandidateSet = { entities: [], attributesByEntity: new Map() };

export interface CandidatePoolOptions {
  /** Most-recent entities per kind to consider. */
  maxCandidates?: number;
  /** How long a loaded snapshot is served before a refresh is triggered. */
  ttlMs?: number;
}

interface PoolEntry {
  loadedAt: number;
  entities: Entity[];
  attributesByEntity: Map<EntityId, Attribute[]>;
}

export class CandidatePool {
  readonly #repository: ObservationRepository;
  readonly #maxCandidates: number;
  readonly #ttlMs: number;
  readonly #byKind = new Map<EntityKind, PoolEntry>();
  /** One refresh per kind at a time; concurrent callers share it. */
  readonly #inflight = new Map<EntityKind, Promise<void>>();

  constructor(repository: ObservationRepository, options: CandidatePoolOptions = {}) {
    this.#repository = repository;
    this.#maxCandidates = options.maxCandidates ?? 120;
    this.#ttlMs = options.ttlMs ?? 30_000;
  }

  /**
   * Candidates for a kind. Awaits the very first load; afterwards returns the
   * current snapshot immediately and refreshes behind the caller if stale.
   */
  async candidates(kind: EntityKind, now: number): Promise<CandidateSet> {
    const entry = this.#byKind.get(kind);
    if (!entry) {
      await this.#refresh(kind, now);
    } else if (now - entry.loadedAt > this.#ttlMs) {
      void this.#refresh(kind, now);
    }

    const current = this.#byKind.get(kind);
    if (!current) return EMPTY;
    return { entities: current.entities, attributesByEntity: current.attributesByEntity };
  }

  /**
   * Starts a load for a kind without waiting for it.
   *
   * Called while a track is still accruing dwell time, so the first load
   * overlaps the seconds before promotion instead of stalling the detection
   * tick that promotes. Without it the first qualifying subject of a session
   * pays for the whole read — one visible hitch, at the worst moment.
   */
  prefetch(kind: EntityKind, now: number): void {
    if (this.#byKind.has(kind) || this.#inflight.has(kind)) return;
    void this.#refresh(kind, now);
  }

  /**
   * Folds a just-written entity into the pool so it is matchable before the
   * next refresh. Without this a subject who leaves and returns inside the TTL
   * would be invisible to the matcher — the exact case the pool exists for.
   */
  remember(entity: Entity, attributes: Attribute[]): void {
    const entry = this.#byKind.get(entity.kind);
    if (!entry) return;
    entry.entities = [entity, ...entry.entities.filter((e) => e.id !== entity.id)].slice(
      0,
      this.#maxCandidates,
    );
    if (attributes.length > 0) entry.attributesByEntity.set(entity.id, attributes);
  }

  /** Drops an entity that no longer exists — a provisional record folded into a confirmed match. */
  forget(entityId: EntityId, kind: EntityKind): void {
    const entry = this.#byKind.get(kind);
    if (!entry) return;
    entry.entities = entry.entities.filter((e) => e.id !== entityId);
    entry.attributesByEntity.delete(entityId);
  }

  async #refresh(kind: EntityKind, now: number): Promise<void> {
    const existing = this.#inflight.get(kind);
    if (existing) return existing;

    const load = this.#load(kind, now).finally(() => {
      this.#inflight.delete(kind);
    });
    this.#inflight.set(kind, load);
    return load;
  }

  /**
   * `now` is the caller's clock, not a fresh `Date.now()`.
   *
   * The recorder reads the time once per detection tick and passes that same
   * instant down; stamping the cache from an independent read would compare
   * two clocks against each other, and any skew between them expires the
   * snapshot on every call — turning the cache into a per-promotion full
   * reload without changing a single visible behaviour.
   */
  async #load(kind: EntityKind, now: number): Promise<void> {
    try {
      // `listEntities` already excludes archived rows and sorts most-recent
      // first, so the slice is genuinely the most relevant window.
      const all = await this.#repository.listEntities({ kind, sort: 'recent' });
      const entities = all.slice(0, this.#maxCandidates);

      const attributesByEntity = new Map<EntityId, Attribute[]>();
      const loaded = await Promise.all(
        entities.map(async (entity) => {
          try {
            return [entity.id, await this.#repository.listAttributes(entity.id)] as const;
          } catch {
            return [entity.id, [] as Attribute[]] as const;
          }
        }),
      );
      for (const [id, attributes] of loaded) {
        if (attributes.length > 0) attributesByEntity.set(id, attributes);
      }

      this.#byKind.set(kind, { loadedAt: now, entities, attributesByEntity });
    } catch {
      // A failed load must not break observation recording. Leaving the
      // previous snapshot in place — or none at all — degrades matching to
      // what it was before, which is survivable; dropping the sighting is not.
      // Stamp the attempt so a persistent failure cannot spin.
      const previous = this.#byKind.get(kind);
      this.#byKind.set(kind, {
        loadedAt: now,
        entities: previous?.entities ?? [],
        attributesByEntity: previous?.attributesByEntity ?? new Map(),
      });
    }
  }
}
