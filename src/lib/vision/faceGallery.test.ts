import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbRepository } from '@/lib/store/indexedDb';
import { FaceGallery } from '@/lib/vision/faceGallery';
import { GALLERY_SIZE, cosineSimilarity, matchFace } from '@/lib/vision/faceMatcher';
import { l2Normalise, DESCRIPTOR_LENGTH } from '@/lib/vision/faceEmbedder';
import type { Entity, FaceEmbeddingRecord } from '@/types/domain';

/**
 * Storage integration, against a real IndexedDB implementation rather than a
 * stubbed repository. This is the seam the unit tests cannot reach: the object
 * store is created by a version upgrade, and pruning and reassignment both read
 * back what they just wrote.
 */

const T = 1_800_000_000_000;

function vector(seed: number): Float32Array {
  const out = new Float32Array(DESCRIPTOR_LENGTH);
  let state = seed * 2654435761;
  for (let i = 0; i < out.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = state / 0xffffffff - 0.5;
  }
  return l2Normalise(out);
}

function embedding(
  entityId: string,
  seed: number,
  overrides: Partial<FaceEmbeddingRecord> = {},
): FaceEmbeddingRecord {
  return {
    id: `emb_${entityId}_${seed}`,
    entityId,
    descriptor: vector(seed),
    score: 0.9,
    model: 'human/faceres-1024',
    createdAt: T + seed,
    ...overrides,
  };
}

function entity(id: string): Entity {
  return {
    id,
    label: id.toUpperCase(),
    kind: 'person',
    class: 'person',
    firstSeenAt: T,
    lastSeenAt: T,
    sightingCount: 1,
    favorite: false,
  };
}

let repository: IndexedDbRepository;

beforeEach(async () => {
  // A whole new factory rather than deleteDatabase: the previous test's
  // repository still holds an open connection, and a delete would block on it
  // forever. Swapping the factory leaves that connection pointing at a store
  // nothing else can see.
  globalThis.indexedDB = new IDBFactory();
  repository = new IndexedDbRepository();
  await repository.ready();
});

describe('face embedding storage', () => {
  it('creates the store on upgrade and round-trips a descriptor exactly', async () => {
    const record = embedding('ent_a', 1);
    await repository.putFaceEmbedding(record);

    const [stored] = await repository.listFaceEmbeddingsFor('ent_a');
    expect(stored?.id).toBe(record.id);
    expect(stored?.model).toBe('human/faceres-1024');
    // Structured clone must preserve the typed array, not turn it into an object.
    expect(stored?.descriptor).toBeInstanceOf(Float32Array);
    expect(cosineSimilarity(stored!.descriptor, record.descriptor)).toBeCloseTo(1, 6);
  });

  it('counts descriptors separately in the storage report', async () => {
    await repository.putFaceEmbedding(embedding('ent_a', 1));
    await repository.putFaceEmbedding(embedding('ent_b', 2));
    expect((await repository.usage()).faceEmbeddings).toBe(2);
  });

  it('deletes every descriptor while leaving observations intact', async () => {
    await repository.upsertEntity(entity('ent_a'));
    await repository.putFaceEmbedding(embedding('ent_a', 1));

    await repository.purgeFaceEmbeddings();

    expect(await repository.listFaceEmbeddings()).toHaveLength(0);
    // The privacy promise: deleting biometrics is not deleting the record.
    expect(await repository.getEntity('ent_a')).not.toBeNull();
  });

  it('cascades descriptors when their entity is deleted', async () => {
    await repository.upsertEntity(entity('ent_a'));
    await repository.putFaceEmbedding(embedding('ent_a', 1));

    await repository.deleteEntity('ent_a', {
      sightings: true,
      media: true,
      notes: true,
      associations: true,
      faceEmbeddings: true,
    });

    expect(await repository.listFaceEmbeddings()).toHaveLength(0);
  });

  it('keeps descriptors when the cascade excludes them', async () => {
    // The path `confirmMatch` relies on: the provisional entity goes, its
    // descriptors are re-pointed rather than destroyed.
    await repository.upsertEntity(entity('ent_a'));
    await repository.putFaceEmbedding(embedding('ent_a', 1));

    await repository.deleteEntity('ent_a', {
      sightings: false,
      media: false,
      notes: true,
      associations: true,
      faceEmbeddings: false,
    });

    expect(await repository.listFaceEmbeddings()).toHaveLength(1);
  });
});

describe('FaceGallery', () => {
  it('serves what the store already holds, across instances', async () => {
    await repository.putFaceEmbedding(embedding('ent_a', 1));

    // A second gallery, as a later session would construct.
    const gallery = new FaceGallery(repository);
    const all = await gallery.all(T);
    expect(all).toHaveLength(1);
    expect(all[0]?.entityId).toBe('ent_a');
  });

  it('makes a descriptor matchable immediately after adding it', async () => {
    const gallery = new FaceGallery(repository);
    await gallery.all(T);

    const record = embedding('ent_a', 5);
    await gallery.add(record);

    const match = matchFace(record.descriptor, await gallery.all(T), { threshold: 0.5 });
    expect(match?.entityId).toBe('ent_a');
  });

  it('bounds an entity gallery on write rather than letting it grow', async () => {
    const gallery = new FaceGallery(repository);
    await gallery.all(T);

    for (let i = 0; i < GALLERY_SIZE + 5; i += 1) {
      await gallery.add(embedding('ent_a', 10 + i));
    }

    // Storage, not just memory: this is what bounds sync traffic too.
    expect(await repository.listFaceEmbeddingsFor('ent_a')).toHaveLength(GALLERY_SIZE);
    expect((await gallery.all(T)).filter((r) => r.entityId === 'ent_a')).toHaveLength(GALLERY_SIZE);
  });

  it('moves descriptors onto the confirmed entity on reassignment', async () => {
    const gallery = new FaceGallery(repository);
    await gallery.all(T);
    await gallery.add(embedding('ent_provisional', 20));
    await gallery.add(embedding('ent_confirmed', 21));

    await gallery.reassign('ent_provisional', 'ent_confirmed');

    expect(await repository.listFaceEmbeddingsFor('ent_provisional')).toHaveLength(0);
    expect(await repository.listFaceEmbeddingsFor('ent_confirmed')).toHaveLength(2);
    // The in-memory view must agree with storage, or the next match is stale.
    const resident = await gallery.all(T);
    expect(resident.every((r) => r.entityId !== 'ent_provisional')).toBe(true);
  });

  it('prunes after a reassignment that overflows the gallery', async () => {
    const gallery = new FaceGallery(repository);
    await gallery.all(T);
    for (let i = 0; i < GALLERY_SIZE; i += 1) await gallery.add(embedding('ent_confirmed', 30 + i));
    for (let i = 0; i < 3; i += 1) await gallery.add(embedding('ent_provisional', 50 + i));

    await gallery.reassign('ent_provisional', 'ent_confirmed');

    expect(await repository.listFaceEmbeddingsFor('ent_confirmed')).toHaveLength(GALLERY_SIZE);
  });

  it('caps what it holds resident without losing what is stored', async () => {
    for (let i = 0; i < 8; i += 1) await repository.putFaceEmbedding(embedding('ent_a', 60 + i));

    const gallery = new FaceGallery(repository, { maxDescriptors: 3 });
    expect(await gallery.all(T)).toHaveLength(3);
    // Exportable and deletable even when it is not compared against.
    expect(await repository.listFaceEmbeddings()).toHaveLength(8);
  });

  it('holds the most recent descriptors when it must choose', async () => {
    for (let i = 0; i < 6; i += 1) await repository.putFaceEmbedding(embedding('ent_a', 70 + i));

    const gallery = new FaceGallery(repository, { maxDescriptors: 2 });
    const resident = await gallery.all(T);
    expect(resident.map((r) => r.createdAt)).toEqual([T + 75, T + 74]);
  });
});
