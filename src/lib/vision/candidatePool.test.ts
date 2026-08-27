import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attribute, Entity, EntityId } from '@/types/domain';
import type { EntityFilter, ObservationRepository } from '@/lib/store';
import { CandidatePool } from '@/lib/vision/candidatePool';

const T = 1_800_000_000_000;

function entity(id: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    label: id.toUpperCase(),
    kind: 'person',
    class: 'person',
    firstSeenAt: T,
    lastSeenAt: T,
    sightingCount: 1,
    favorite: false,
    ...overrides,
  };
}

function attribute(entityId: EntityId, value: string): Attribute {
  return {
    id: `att_${entityId}`,
    entityId,
    key: 'upper',
    value,
    confidence: 0.8,
    observedAt: T,
    source: 'model',
  };
}

/**
 * Only the two reads the pool performs. Everything else throws, so a pool that
 * reached for another part of the store would fail loudly rather than quietly
 * doing more work than it should.
 */
function fakeRepository(entities: Entity[], attributes: Record<string, Attribute[]> = {}) {
  const listEntities = vi.fn(async (filter: EntityFilter = {}) =>
    entities
      .filter((e) => !filter.kind || e.kind === filter.kind)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt),
  );
  const listAttributes = vi.fn(async (id: EntityId) => attributes[id] ?? []);

  const repository = new Proxy(
    { listEntities, listAttributes },
    {
      get(target, property) {
        if (property in target) return Reflect.get(target, property);
        throw new Error(`CandidatePool must not call ${String(property)}`);
      },
    },
  ) as unknown as ObservationRepository;

  return { repository, listEntities, listAttributes };
}

describe('CandidatePool', () => {
  beforeEach(() => vi.useRealTimers());

  it('returns entities from the store rather than only this session', async () => {
    // The regression this class exists for: a fresh pool, no entity created by
    // the caller, and a store that already remembers someone.
    const { repository } = fakeRepository([entity('ent_a')], { ent_a: [attribute('ent_a', 'blue')] });
    const pool = new CandidatePool(repository);

    const set = await pool.candidates('person', T);
    expect(set.entities.map((e) => e.id)).toEqual(['ent_a']);
    expect(set.attributesByEntity.get('ent_a')).toHaveLength(1);
  });

  it('requests only the kind being matched', async () => {
    const { repository, listEntities } = fakeRepository([
      entity('ent_a'),
      entity('ent_v', { kind: 'vehicle', class: 'car' }),
    ]);
    const pool = new CandidatePool(repository);

    const set = await pool.candidates('vehicle', T);
    expect(listEntities).toHaveBeenCalledWith({ kind: 'vehicle', sort: 'recent' });
    expect(set.entities.map((e) => e.id)).toEqual(['ent_v']);
  });

  it('caps the pool at the most recently seen candidates', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      entity(`ent_${i}`, { lastSeenAt: T + i }),
    );
    const { repository } = fakeRepository(many);
    const pool = new CandidatePool(repository, { maxCandidates: 3 });

    const set = await pool.candidates('person', T);
    expect(set.entities.map((e) => e.id)).toEqual(['ent_9', 'ent_8', 'ent_7']);
  });

  it('serves the cached snapshot until it goes stale', async () => {
    const { repository, listEntities } = fakeRepository([entity('ent_a')]);
    const pool = new CandidatePool(repository, { ttlMs: 1000 });

    await pool.candidates('person', T);
    await pool.candidates('person', T + 500);
    expect(listEntities).toHaveBeenCalledTimes(1);
  });

  it('refreshes in the background once stale, without blocking the caller', async () => {
    const { repository, listEntities } = fakeRepository([entity('ent_a')]);
    const pool = new CandidatePool(repository, { ttlMs: 1000 });

    await pool.candidates('person', T);
    // Returns the stale snapshot immediately; the reload happens behind it.
    const stale = await pool.candidates('person', T + 5000);
    expect(stale.entities).toHaveLength(1);
    await vi.waitFor(() => expect(listEntities).toHaveBeenCalledTimes(2));
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const { repository, listEntities } = fakeRepository([entity('ent_a')]);
    const pool = new CandidatePool(repository);

    await Promise.all([
      pool.candidates('person', T),
      pool.candidates('person', T),
      pool.candidates('person', T),
    ]);
    expect(listEntities).toHaveBeenCalledTimes(1);
  });

  it('makes a newly recorded entity matchable before the next refresh', async () => {
    const { repository } = fakeRepository([entity('ent_a')]);
    const pool = new CandidatePool(repository);
    await pool.candidates('person', T);

    pool.remember(entity('ent_new'), [attribute('ent_new', 'red')]);

    const set = await pool.candidates('person', T);
    expect(set.entities.map((e) => e.id)).toEqual(['ent_new', 'ent_a']);
    expect(set.attributesByEntity.get('ent_new')).toHaveLength(1);
  });

  it('replaces rather than duplicates an entity it already holds', async () => {
    const { repository } = fakeRepository([entity('ent_a')]);
    const pool = new CandidatePool(repository);
    await pool.candidates('person', T);

    pool.remember(entity('ent_a', { sightingCount: 9 }), []);

    const set = await pool.candidates('person', T);
    expect(set.entities).toHaveLength(1);
    expect(set.entities[0]?.sightingCount).toBe(9);
  });

  it('drops an entity that has been folded into a confirmed match', async () => {
    const { repository } = fakeRepository([entity('ent_a')], {
      ent_a: [attribute('ent_a', 'blue')],
    });
    const pool = new CandidatePool(repository);
    await pool.candidates('person', T);

    pool.forget('ent_a', 'person');

    const set = await pool.candidates('person', T);
    expect(set.entities).toHaveLength(0);
    expect(set.attributesByEntity.has('ent_a')).toBe(false);
  });

  it('prefetches at most once and satisfies the next read from cache', async () => {
    const { repository, listEntities } = fakeRepository([entity('ent_a')]);
    const pool = new CandidatePool(repository);

    pool.prefetch('person', T);
    pool.prefetch('person', T);
    await vi.waitFor(() => expect(listEntities).toHaveBeenCalledTimes(1));

    await pool.candidates('person', T);
    expect(listEntities).toHaveBeenCalledTimes(1);
  });

  it('degrades to an empty pool instead of throwing when the store fails', async () => {
    const repository = {
      listEntities: vi.fn(async () => {
        throw new Error('idb unavailable');
      }),
      listAttributes: vi.fn(async () => []),
    } as unknown as ObservationRepository;
    const pool = new CandidatePool(repository);

    const set = await pool.candidates('person', T);
    expect(set.entities).toEqual([]);
  });

  it('does not retry a failing store on every call', async () => {
    const listEntities = vi.fn(async () => {
      throw new Error('idb unavailable');
    });
    const repository = { listEntities, listAttributes: vi.fn(async () => []) } as unknown as
      ObservationRepository;
    const pool = new CandidatePool(repository, { ttlMs: 10_000 });

    await pool.candidates('person', T);
    await pool.candidates('person', T + 1);
    expect(listEntities).toHaveBeenCalledTimes(1);
  });

  it('survives an attribute read failing for one candidate', async () => {
    const entities = [entity('ent_a'), entity('ent_b')];
    const repository = {
      listEntities: vi.fn(async () => entities),
      listAttributes: vi.fn(async (id: EntityId) => {
        if (id === 'ent_a') throw new Error('read failed');
        return [attribute('ent_b', 'green')];
      }),
    } as unknown as ObservationRepository;
    const pool = new CandidatePool(repository);

    const set = await pool.candidates('person', T);
    expect(set.entities).toHaveLength(2);
    expect(set.attributesByEntity.get('ent_b')).toHaveLength(1);
  });
});
