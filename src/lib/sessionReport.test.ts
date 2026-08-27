import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbRepository } from '@/lib/store/indexedDb';
import {
  buildSessionReport,
  buildSessionReports,
  collectSessionExport,
} from '@/lib/sessionReport';
import type { Entity, Session, Sighting } from '@/types/domain';

const T = new Date(2026, 7, 27, 14, 0, 0).getTime();
const MIN = 60_000;

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    startedAt: T,
    endedAt: T + 30 * MIN,
    detectorId: 'coco-ssd',
    counts: { person: 0, vehicle: 0, animal: 0, object: 0, newEntities: 0 },
    ...overrides,
  };
}

function entity(id: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    label: id.toUpperCase(),
    kind: 'person',
    class: 'person',
    firstSeenAt: T + MIN,
    lastSeenAt: T + 2 * MIN,
    sightingCount: 1,
    favorite: false,
    ...overrides,
  };
}

function sighting(id: string, entityId: string, sessionId: string, overrides: Partial<Sighting> = {}): Sighting {
  return {
    id,
    entityId,
    sessionId,
    observationId: `obs_${id}`,
    class: 'person',
    kind: 'person',
    startedAt: T + MIN,
    endedAt: T + MIN + 5000,
    durationMs: 5000,
    confidence: 0.9,
    box: { x: 0.1, y: 0.1, width: 0.2, height: 0.4 },
    direction: 'static',
    attributes: [],
    coVisibleEntityIds: [],
    ...overrides,
  };
}

let repository: IndexedDbRepository;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repository = new IndexedDbRepository();
  await repository.ready();
});

describe('buildSessionReport', () => {
  it('returns null for a session that does not exist', async () => {
    expect(await buildSessionReport(repository, 'ses_missing')).toBeNull();
  });

  it('reports duration from the recorded end time', async () => {
    await repository.createSession(session('ses_1'));
    const report = await buildSessionReport(repository, 'ses_1');
    expect(report?.durationMs).toBe(30 * MIN);
    expect(report?.unfinished).toBe(false);
  });

  it('falls back to last activity for a session that was never closed', async () => {
    // A killed tab or a crash leaves `endedAt` unset; the report must still
    // show a sensible length rather than zero or a negative number.
    await repository.createSession(session('ses_1', { endedAt: undefined }));
    await repository.upsertEntity(entity('ent_a'));
    await repository.addSighting(
      sighting('sig_1', 'ent_a', 'ses_1', { startedAt: T + MIN, endedAt: T + 9 * MIN }),
    );

    const report = await buildSessionReport(repository, 'ses_1');
    expect(report?.unfinished).toBe(true);
    expect(report?.durationMs).toBe(9 * MIN);
  });

  it('groups repeated sightings into one subject and sums dwell', async () => {
    await repository.createSession(session('ses_1'));
    await repository.upsertEntity(entity('ent_a'));
    await repository.addSighting(sighting('sig_1', 'ent_a', 'ses_1', { durationMs: 4000 }));
    await repository.addSighting(sighting('sig_2', 'ent_a', 'ses_1', { durationMs: 6000 }));

    const report = await buildSessionReport(repository, 'ses_1');
    expect(report?.subjects).toHaveLength(1);
    expect(report?.subjects[0]?.sightings).toBe(2);
    expect(report?.subjects[0]?.dwellMs).toBe(10_000);
    expect(report?.totals.sightings).toBe(2);
  });

  it('marks a subject first seen before the session as returning', async () => {
    // The distinction the whole screen exists for: a face seen last week is a
    // pattern, a face seen for the first time is just a row.
    await repository.createSession(session('ses_1'));
    await repository.upsertEntity(entity('ent_new', { firstSeenAt: T + MIN }));
    await repository.upsertEntity(entity('ent_old', { firstSeenAt: T - 7 * 24 * 60 * MIN }));
    await repository.addSighting(sighting('sig_1', 'ent_new', 'ses_1'));
    await repository.addSighting(sighting('sig_2', 'ent_old', 'ses_1'));

    const report = await buildSessionReport(repository, 'ses_1');
    expect(report?.totals.newSubjects).toBe(1);
    expect(report?.totals.returningSubjects).toBe(1);
    expect(report?.subjects.find((s) => s.entity.id === 'ent_old')?.isNew).toBe(false);
    expect(report?.subjects.find((s) => s.entity.id === 'ent_new')?.isNew).toBe(true);
  });

  it('treats a subject seen in the first instant as new, not returning', async () => {
    // `firstSeenAt` comes from the track, which starts fractionally before the
    // session row is written; without tolerance this reads as returning.
    await repository.createSession(session('ses_1'));
    await repository.upsertEntity(entity('ent_a', { firstSeenAt: T - 400 }));
    await repository.addSighting(sighting('sig_1', 'ent_a', 'ses_1'));

    const report = await buildSessionReport(repository, 'ses_1');
    expect(report?.subjects[0]?.isNew).toBe(true);
  });

  it('counts subjects by kind', async () => {
    await repository.createSession(session('ses_1'));
    await repository.upsertEntity(entity('ent_p'));
    await repository.upsertEntity(entity('ent_v', { kind: 'vehicle', class: 'car' }));
    await repository.addSighting(sighting('sig_1', 'ent_p', 'ses_1'));
    await repository.addSighting(sighting('sig_2', 'ent_v', 'ses_1', { kind: 'vehicle', class: 'car' }));

    const report = await buildSessionReport(repository, 'ses_1');
    expect(report?.totals.byKind.person).toBe(1);
    expect(report?.totals.byKind.vehicle).toBe(1);
    expect(report?.totals.byKind.animal).toBe(0);
  });

  it('orders subjects by time in view', async () => {
    await repository.createSession(session('ses_1'));
    await repository.upsertEntity(entity('ent_brief'));
    await repository.upsertEntity(entity('ent_long'));
    await repository.addSighting(sighting('sig_1', 'ent_brief', 'ses_1', { durationMs: 2000 }));
    await repository.addSighting(sighting('sig_2', 'ent_long', 'ses_1', { durationMs: 90_000 }));

    const report = await buildSessionReport(repository, 'ses_1');
    expect(report?.subjects.map((s) => s.entity.id)).toEqual(['ent_long', 'ent_brief']);
  });

  it('ignores sightings whose entity has been deleted', async () => {
    await repository.createSession(session('ses_1'));
    await repository.addSighting(sighting('sig_1', 'ent_gone', 'ses_1'));

    const report = await buildSessionReport(repository, 'ses_1');
    expect(report?.subjects).toHaveLength(0);
    // The sighting still counts as recorded activity even without its subject.
    expect(report?.totals.sightings).toBe(1);
  });

  it('never mixes in sightings from another session', async () => {
    await repository.createSession(session('ses_1'));
    await repository.createSession(session('ses_2'));
    await repository.upsertEntity(entity('ent_a'));
    await repository.addSighting(sighting('sig_1', 'ent_a', 'ses_1'));
    await repository.addSighting(sighting('sig_2', 'ent_a', 'ses_2'));

    expect((await buildSessionReport(repository, 'ses_1'))?.totals.sightings).toBe(1);
    expect((await buildSessionReport(repository, 'ses_2'))?.totals.sightings).toBe(1);
  });
});

describe('buildSessionReports', () => {
  it('returns a report per session, newest first', async () => {
    await repository.createSession(session('ses_old', { startedAt: T - 60 * MIN }));
    await repository.createSession(session('ses_new', { startedAt: T }));

    const reports = await buildSessionReports(repository);
    expect(reports.map((r) => r.session.id)).toEqual(['ses_new', 'ses_old']);
  });

  it('includes sessions that recorded nothing, with zeroed totals', async () => {
    // The screen filters these out for display, but the count is still shown,
    // so the builder must not drop them.
    await repository.createSession(session('ses_empty'));
    const [report] = await buildSessionReports(repository);
    expect(report?.totals.sightings).toBe(0);
    expect(report?.subjects).toEqual([]);
  });
});

describe('collectSessionExport', () => {
  it('scopes the bundle to one session', async () => {
    await repository.createSession(session('ses_1'));
    await repository.createSession(session('ses_2'));
    await repository.upsertEntity(entity('ent_a'));
    await repository.upsertEntity(entity('ent_b'));
    await repository.addSighting(sighting('sig_1', 'ent_a', 'ses_1'));
    await repository.addSighting(sighting('sig_2', 'ent_b', 'ses_2'));

    const bundle = await collectSessionExport(repository, 'ses_1');
    expect(bundle?.sessions.map((s) => s.id)).toEqual(['ses_1']);
    expect(bundle?.sightings.map((s) => s.id)).toEqual(['sig_1']);
    expect(bundle?.entities.map((e) => e.id)).toEqual(['ent_a']);
  });

  it('returns null for an unknown session', async () => {
    expect(await collectSessionExport(repository, 'ses_missing')).toBeNull();
  });
});
