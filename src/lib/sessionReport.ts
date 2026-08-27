import type { Entity, EntityId, EntityKind, Session, SessionId, Sighting } from '@/types/domain';
import type { ObservationRepository } from '@/lib/store';
import type { ExportBundle } from '@/lib/export';

/**
 * SESSION REPORT
 * ---------------------------------------------------------------------------
 * What happened during one recording session.
 *
 * Sessions were being written from the first release and never shown. That gap
 * is why the end of a session felt like nothing: the operator stops recording
 * and the app says nothing about what it just spent an hour watching. A report
 * is not new data — every field below is derived from records already stored.
 *
 * "New" means first ever seen during this session, computed from the entity's
 * own `firstSeenAt` rather than from the session's `counts.newEntities`. The
 * counter is incremented live and decremented when a match is confirmed, so it
 * describes what the pipeline believed at the time; `firstSeenAt` describes
 * what turned out to be true, including corrections the operator made
 * afterwards. A report should show the latter.
 */

export interface SessionSubject {
  entity: Entity;
  sightings: number;
  firstAt: number;
  lastAt: number;
  /** Total time the subject was continuously tracked during this session. */
  dwellMs: number;
  /** First seen ever during this session, rather than recognised from before. */
  isNew: boolean;
}

export interface SessionReport {
  session: Session;
  /** Wall-clock length; falls back to last activity for a session never closed. */
  durationMs: number;
  /** True when the session has no `endedAt` — closed tab, crash, still running. */
  unfinished: boolean;
  /** End of the last observation, or the start for a session that saw nothing. */
  lastActivityAt: number;
  subjects: SessionSubject[];
  totals: {
    sightings: number;
    subjects: number;
    newSubjects: number;
    returningSubjects: number;
    byKind: Record<EntityKind, number>;
  };
}

const EMPTY_BY_KIND: Record<EntityKind, number> = {
  person: 0,
  vehicle: 0,
  animal: 0,
  object: 0,
};

export async function buildSessionReport(
  repository: ObservationRepository,
  sessionId: SessionId,
): Promise<SessionReport | null> {
  const session = await repository.getSession(sessionId);
  if (!session) return null;
  const sightings = await repository.listSightingsForSession(sessionId);
  return assembleReport(session, sightings, await resolveEntities(repository, sightings));
}

/**
 * Reports for many sessions in one pass.
 *
 * Entities are fetched once across the whole set rather than per session: a
 * regular visitor appears in most of them, and re-reading the same record
 * dozens of times is the difference between one storage pass and hundreds.
 */
export async function buildSessionReports(
  repository: ObservationRepository,
  limit = 50,
): Promise<SessionReport[]> {
  const sessions = await repository.listSessions(limit);
  const byId = new Map<SessionId, Sighting[]>();
  for (const session of sessions) {
    byId.set(session.id, await repository.listSightingsForSession(session.id));
  }

  const entities = await resolveEntities(repository, [...byId.values()].flat());
  return sessions.map((session) =>
    assembleReport(session, byId.get(session.id) ?? [], entities),
  );
}

function assembleReport(
  session: Session,
  sightings: Sighting[],
  entities: Map<EntityId, Entity>,
): SessionReport {
  const grouped = new Map<EntityId, Sighting[]>();
  for (const sighting of sightings) {
    const bucket = grouped.get(sighting.entityId);
    if (bucket) bucket.push(sighting);
    else grouped.set(sighting.entityId, [sighting]);
  }

  const subjects: SessionSubject[] = [];
  const byKind = { ...EMPTY_BY_KIND };

  for (const [entityId, group] of grouped) {
    const entity = entities.get(entityId);
    // An entity deleted since the session was recorded leaves its sightings
    // behind only until the cascade runs; skipping is correct either way.
    if (!entity) continue;

    const firstAt = Math.min(...group.map((s) => s.startedAt));
    const lastAt = Math.max(...group.map((s) => s.endedAt));
    byKind[entity.kind] += 1;

    subjects.push({
      entity,
      sightings: group.length,
      firstAt,
      lastAt,
      dwellMs: group.reduce((sum, s) => sum + s.durationMs, 0),
      // Tolerance absorbs the millisecond between a session's `startedAt` and
      // the first frame it processed; without it a subject seen immediately
      // could read as returning from a session that had not begun.
      isNew: entity.firstSeenAt >= session.startedAt - 1000,
    });
  }

  // Most present first: the subject who spent longest in view is the one an
  // operator scanning the report is most likely looking for.
  subjects.sort((a, b) => b.dwellMs - a.dwellMs || b.sightings - a.sightings);

  const newSubjects = subjects.filter((s) => s.isNew).length;
  const lastActivity = sightings.length
    ? Math.max(...sightings.map((s) => s.endedAt))
    : session.startedAt;
  const endedAt = session.endedAt ?? lastActivity;

  return {
    session,
    durationMs: Math.max(0, endedAt - session.startedAt),
    /*
     * A session is stamped with `endedAt` only when the pipeline effect tears
     * down cleanly, which means navigating within the app. Closing the tab or
     * switching away on a phone — the ordinary way to stop recording — skips
     * it, so a missing end time is the common case rather than an anomaly.
     *
     * It is reported, because the duration above is inferred rather than
     * recorded and that difference is worth keeping. The interface treats it
     * as a live-or-not question instead of an error, since flagging most of an
     * operator's sessions as broken would say nothing except that the app
     * cannot tell how they stopped.
     */
    unfinished: session.endedAt === undefined,
    lastActivityAt: lastActivity,
    subjects,
    totals: {
      sightings: sightings.length,
      subjects: subjects.length,
      newSubjects,
      returningSubjects: subjects.length - newSubjects,
      byKind,
    },
  };
}

async function resolveEntities(
  repository: ObservationRepository,
  sightings: Sighting[],
): Promise<Map<EntityId, Entity>> {
  const ids = new Set(sightings.map((s) => s.entityId));
  const entities = new Map<EntityId, Entity>();
  for (const id of ids) {
    const entity = await repository.getEntity(id);
    if (entity) entities.set(id, entity);
  }
  return entities;
}

/**
 * An export bundle scoped to one session.
 *
 * Deliberately not `collectExport` filtered afterwards: that reads the whole
 * store to throw nearly all of it away, and exporting one session is the case
 * an operator reaches for most often — right after recording it.
 */
export async function collectSessionExport(
  repository: ObservationRepository,
  sessionId: SessionId,
): Promise<ExportBundle | null> {
  const session = await repository.getSession(sessionId);
  if (!session) return null;

  const sightings = await repository.listSightingsForSession(sessionId);
  const entities = [...(await resolveEntities(repository, sightings)).values()];

  const notes = [];
  const associations = [];
  const faceEmbeddings = [];
  for (const entity of entities) {
    notes.push(...(await repository.listNotes(entity.id)));
    associations.push(...(await repository.listAssociations(entity.id)));
    faceEmbeddings.push(...(await repository.listFaceEmbeddingsFor(entity.id)));
  }

  return {
    exportedAt: Date.now(),
    sessions: [session],
    entities,
    sightings,
    notes,
    associations,
    faceEmbeddings,
  };
}
