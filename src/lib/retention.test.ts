import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbRepository } from '@/lib/store/indexedDb';
import { cutoffsFor, describePurge, retentionEnabled, sweepIfDue } from '@/lib/retention';
import { DEFAULT_SETTINGS, type FlockraftSettings } from '@/lib/settings';
import type { Entity, FaceEmbeddingRecord, MediaRecord, Session, Sighting } from '@/types/domain';

const NOW = new Date(2026, 7, 27, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const settings = (patch: Partial<FlockraftSettings> = {}): FlockraftSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

function entity(id: string, daysAgo: number, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    label: id.toUpperCase(),
    kind: 'person',
    class: 'person',
    firstSeenAt: NOW - daysAgo * DAY,
    lastSeenAt: NOW - daysAgo * DAY,
    sightingCount: 1,
    favorite: false,
    ...overrides,
  };
}

function sighting(
  id: string,
  entityId: string,
  daysAgo: number,
  overrides: Partial<Sighting> = {},
): Sighting {
  const at = NOW - daysAgo * DAY;
  return {
    id,
    entityId,
    sessionId: 'ses_1',
    observationId: `obs_${id}`,
    class: 'person',
    kind: 'person',
    startedAt: at,
    endedAt: at + 5000,
    durationMs: 5000,
    confidence: 0.9,
    box: { x: 0, y: 0, width: 0.2, height: 0.4 },
    direction: 'static',
    attributes: [],
    coVisibleEntityIds: [],
    ...overrides,
  };
}

const session = (id: string, daysAgo: number): Session => ({
  id,
  startedAt: NOW - daysAgo * DAY,
  endedAt: NOW - daysAgo * DAY + 60_000,
  detectorId: 'coco-ssd',
  counts: { person: 0, vehicle: 0, animal: 0, object: 0, newEntities: 0 },
});

const media = (id: string, entityId: string): MediaRecord => ({
  id,
  entityId,
  sessionId: 'ses_1',
  kind: 'thumbnail',
  mimeType: 'image/jpeg',
  width: 320,
  height: 320,
  byteSize: 20_000,
  createdAt: NOW,
});

const embedding = (id: string, entityId: string, daysAgo: number): FaceEmbeddingRecord => ({
  id,
  entityId,
  descriptor: new Float32Array(8),
  score: 0.9,
  model: 'human/faceres-1024',
  createdAt: NOW - daysAgo * DAY,
});

let repository: IndexedDbRepository;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repository = new IndexedDbRepository();
  await repository.ready();
  try {
    window.localStorage.clear();
  } catch {
    // No DOM storage in this environment; the sweep falls back to always due.
  }
});

describe('cutoffsFor', () => {
  it('is zero — meaning keep everything — when no window is set', () => {
    const cutoffs = cutoffsFor(settings(), NOW);
    expect(cutoffs.observationsBefore).toBe(0);
    expect(cutoffs.faceEmbeddingsBefore).toBe(0);
  });

  it('converts days to an instant', () => {
    const cutoffs = cutoffsFor(settings({ retentionDays: 30 }), NOW);
    expect(cutoffs.observationsBefore).toBe(NOW - 30 * DAY);
  });

  it('tracks the two windows independently', () => {
    const cutoffs = cutoffsFor(settings({ retentionDays: 90, faceRetentionDays: 30 }), NOW);
    expect(cutoffs.observationsBefore).toBe(NOW - 90 * DAY);
    expect(cutoffs.faceEmbeddingsBefore).toBe(NOW - 30 * DAY);
  });
});

describe('retentionEnabled', () => {
  it('is off by default', () => {
    expect(retentionEnabled(settings())).toBe(false);
  });

  it('is on when either window is set', () => {
    expect(retentionEnabled(settings({ retentionDays: 30 }))).toBe(true);
    expect(retentionEnabled(settings({ faceRetentionDays: 30 }))).toBe(true);
  });
});

describe('sweepIfDue', () => {
  it('does nothing at all when no window is set', async () => {
    // The property that matters most: an operator who never opted in must
    // never lose a record to this code.
    await repository.upsertEntity(entity('ent_ancient', 400));
    await repository.addSighting(sighting('sig_1', 'ent_ancient', 400));

    expect(await sweepIfDue(repository, settings(), NOW)).toBeNull();
    expect(await repository.getEntity('ent_ancient')).not.toBeNull();
    expect(await repository.listSightings('ent_ancient')).toHaveLength(1);
  });

  it('removes observations past the window and keeps those inside it', async () => {
    await repository.upsertEntity(entity('ent_old', 60));
    await repository.upsertEntity(entity('ent_recent', 3));
    await repository.addSighting(sighting('sig_old', 'ent_old', 60));
    await repository.addSighting(sighting('sig_recent', 'ent_recent', 3));

    const result = await sweepIfDue(repository, settings({ retentionDays: 30 }), NOW, {
      force: true,
    });

    expect(result?.sightings).toEqual(['sig_old']);
    expect(result?.entities).toEqual(['ent_old']);
    expect(await repository.getEntity('ent_old')).toBeNull();
    expect(await repository.getEntity('ent_recent')).not.toBeNull();
  });

  it('never removes a favourited subject', async () => {
    // Starring is an explicit "keep this"; a date sweep that ignored it would
    // delete exactly the records the operator cared enough to mark.
    await repository.upsertEntity(entity('ent_fav', 400, { favorite: true }));
    await repository.addSighting(sighting('sig_1', 'ent_fav', 400));

    await sweepIfDue(repository, settings({ retentionDays: 30 }), NOW, { force: true });

    expect(await repository.getEntity('ent_fav')).not.toBeNull();
    expect(await repository.listSightings('ent_fav')).toHaveLength(1);
  });

  it('never removes a subject the operator has annotated', async () => {
    await repository.upsertEntity(entity('ent_noted', 400));
    await repository.addSighting(sighting('sig_1', 'ent_noted', 400));
    await repository.addNote({
      id: 'note_1',
      entityId: 'ent_noted',
      body: 'Delivery driver, Tuesdays',
      createdAt: NOW - 400 * DAY,
      author: 'operator',
    });

    await sweepIfDue(repository, settings({ retentionDays: 30 }), NOW, { force: true });

    expect(await repository.getEntity('ent_noted')).not.toBeNull();
    expect(await repository.listSightings('ent_noted')).toHaveLength(1);
  });

  it('trims old sightings from a subject that is still active', async () => {
    // "Older than 30 days" means the observations, not only dormant subjects:
    // a regular visitor should not accumulate unbounded history.
    await repository.upsertEntity(entity('ent_regular', 0, { sightingCount: 2 }));
    await repository.addSighting(sighting('sig_old', 'ent_regular', 90));
    await repository.addSighting(sighting('sig_new', 'ent_regular', 2));

    await sweepIfDue(repository, settings({ retentionDays: 30 }), NOW, { force: true });

    const survivor = await repository.getEntity('ent_regular');
    expect(survivor).not.toBeNull();
    expect(await repository.listSightings('ent_regular')).toHaveLength(1);
  });

  it('recomputes counts and dates for a trimmed subject', async () => {
    // Otherwise the entity keeps claiming sightings that no longer exist and
    // firstSeenAt points at a deleted record.
    await repository.upsertEntity(entity('ent_regular', 0, { sightingCount: 3, firstSeenAt: NOW - 90 * DAY }));
    await repository.addSighting(sighting('sig_a', 'ent_regular', 90));
    await repository.addSighting(sighting('sig_b', 'ent_regular', 80));
    await repository.addSighting(sighting('sig_c', 'ent_regular', 2));

    await sweepIfDue(repository, settings({ retentionDays: 30 }), NOW, { force: true });

    const survivor = await repository.getEntity('ent_regular');
    expect(survivor?.sightingCount).toBe(1);
    expect(survivor?.firstSeenAt).toBe(NOW - 2 * DAY);
  });

  it('removes images belonging to swept sightings', async () => {
    await repository.upsertEntity(entity('ent_old', 60));
    await repository.putMedia(media('med_1', 'ent_old'));
    await repository.addSighting(sighting('sig_old', 'ent_old', 60, { thumbnailId: 'med_1' }));

    const result = await sweepIfDue(repository, settings({ retentionDays: 30 }), NOW, {
      force: true,
    });

    expect(result?.media).toContain('med_1');
    expect(await repository.getMedia('med_1')).toBeNull();
  });

  it('applies the face window independently of the observation window', async () => {
    // The configuration chosen here: observations expire, signatures do not.
    await repository.upsertEntity(entity('ent_a', 2));
    await repository.addSighting(sighting('sig_1', 'ent_a', 2));
    await repository.putFaceEmbedding(embedding('emb_old', 'ent_a', 200));

    await sweepIfDue(repository, settings({ retentionDays: 30, faceRetentionDays: 0 }), NOW, {
      force: true,
    });

    expect(await repository.listFaceEmbeddings()).toHaveLength(1);
  });

  it('removes only expired signatures when a face window is set', async () => {
    await repository.upsertEntity(entity('ent_a', 2));
    await repository.putFaceEmbedding(embedding('emb_old', 'ent_a', 200));
    await repository.putFaceEmbedding(embedding('emb_new', 'ent_a', 5));

    const result = await sweepIfDue(repository, settings({ faceRetentionDays: 90 }), NOW, {
      force: true,
    });

    expect(result?.faceEmbeddings).toEqual(['emb_old']);
    // The subject itself is untouched: a signature is not an observation.
    expect(await repository.getEntity('ent_a')).not.toBeNull();
  });

  it('removes sessions past the window', async () => {
    await repository.createSession(session('ses_old', 60));
    await repository.createSession(session('ses_new', 1));

    const result = await sweepIfDue(repository, settings({ retentionDays: 30 }), NOW, {
      force: true,
    });

    expect(result?.sessions).toEqual(['ses_old']);
    expect(await repository.getSession('ses_new')).not.toBeNull();
  });

  it('reports null when nothing is old enough', async () => {
    await repository.upsertEntity(entity('ent_recent', 1));
    await repository.addSighting(sighting('sig_1', 'ent_recent', 1));

    expect(
      await sweepIfDue(repository, settings({ retentionDays: 30 }), NOW, { force: true }),
    ).toBeNull();
  });

  it('is idempotent — a second sweep finds nothing left', async () => {
    await repository.upsertEntity(entity('ent_old', 60));
    await repository.addSighting(sighting('sig_old', 'ent_old', 60));
    const opts = settings({ retentionDays: 30 });

    expect(await sweepIfDue(repository, opts, NOW, { force: true })).not.toBeNull();
    expect(await sweepIfDue(repository, opts, NOW, { force: true })).toBeNull();
  });
});

describe('describePurge', () => {
  it('lists only what was actually removed', () => {
    expect(
      describePurge({
        sightings: ['a', 'b'],
        entities: ['c'],
        sessions: [],
        media: [],
        faceEmbeddings: [],
      }),
    ).toBe('Removed 2 sightings, 1 entities');
  });

  it('says so plainly when nothing was removed', () => {
    expect(
      describePurge({ sightings: [], entities: [], sessions: [], media: [], faceEmbeddings: [] }),
    ).toBe('Nothing was old enough to remove');
  });
});
