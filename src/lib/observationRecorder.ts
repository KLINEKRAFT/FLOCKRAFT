import type {
  Attribute,
  Entity,
  EntityId,
  GeoFix,
  MediaId,
  MediaRecord,
  SessionCounts,
  SessionId,
  Sighting,
  SightingId,
  Track,
} from '@/types/domain';
import { createId } from '@/lib/id';
import { designationFor } from '@/lib/taxonomy';
import { cropThumbnail } from '@/lib/vision/capture';
import { analyzeAppearance } from '@/lib/vision/attributes';
import { proposeMatch } from '@/lib/vision/entityMatcher';
import type { ObservationRepository } from '@/lib/store';
import type { FlockraftSettings } from '@/lib/settings';

/**
 * OBSERVATION RECORDER
 * ---------------------------------------------------------------------------
 * Converts ephemeral tracks into durable records. This is the boundary between
 * "what the camera is seeing right now" and "what FLOCKRAFT remembers".
 *
 * The central rule: a track becomes an observation only after it has been
 * continuously visible for `observationThresholdMs`. Without that dwell
 * requirement, every momentary false positive — a shadow, a reflection, a
 * single-frame flicker — would mint a permanent entity, and the memory would
 * be worthless within an hour.
 *
 * Identity binding is conservative by design:
 *   - With auto-matching off (the default), every observation creates a NEW
 *     entity. Nothing is silently merged.
 *   - With auto-matching on, a match is *proposed* and attached to the track
 *     for the user to confirm. The observation still opens as a new entity
 *     until that confirmation arrives.
 */

export interface RecorderContext {
  repository: ObservationRepository;
  sessionId: SessionId;
  settings: FlockraftSettings;
  location: GeoFix | null;
}

export interface RecordedObservation {
  sighting: Sighting;
  entity: Entity;
  isNewEntity: boolean;
}

export class ObservationRecorder {
  #context: RecorderContext;
  /** Tracks currently held open, keyed by track id. */
  #open = new Map<string, OpenObservation>();
  #counts: SessionCounts = { person: 0, vehicle: 0, animal: 0, object: 0, newEntities: 0 };
  /** Entities touched this session, used to scope match proposals. */
  #recentEntities = new Map<EntityId, Entity>();
  /** Entity pairs already credited with a co-occurrence, per overlap. */
  #recordedPairs = new Set<string>();
  #attributeCache = new Map<EntityId, Attribute[]>();

  constructor(context: RecorderContext) {
    this.#context = context;
  }

  get counts(): SessionCounts {
    return { ...this.#counts };
  }

  updateContext(patch: Partial<RecorderContext>): void {
    this.#context = { ...this.#context, ...patch };
  }

  /**
   * Called once per detection tick with the live tracks and the frame they were
   * derived from. Promotes qualifying tracks and refreshes representative
   * media for tracks already open.
   */
  async observe(tracks: Track[], frame: HTMLCanvasElement | null, now: number): Promise<void> {
    const { settings } = this.#context;
    if (!settings.saveObservations) return;

    for (const track of tracks) {
      const dwell = now - track.firstSeenAt;
      const existing = this.#open.get(track.id);

      if (existing) {
        // Keep the highest-confidence frame as the representative image: the
        // first qualifying frame is often the moment of partial entry.
        if (frame && settings.saveImages && track.score > existing.bestScore + 0.05) {
          existing.bestScore = track.score;
          existing.pendingBestFrame = { frame, box: track.box };
        }
        existing.lastSeenAt = now;
        existing.peakScore = Math.max(existing.peakScore, track.peakScore);
        continue;
      }

      if (dwell < settings.observationThresholdMs) continue;

      await this.#promote(track, frame, now);
    }

    // Co-visibility is counted once per pair per overlapping observation, not
    // once per tick. Counting per tick would report "observed together 240x"
    // for two subjects that stood side by side for thirty seconds, which is
    // both wrong and useless for ranking associations.
    const openEntityIds = [...this.#open.values()].map((o) => o.entityId);
    for (let i = 0; i < openEntityIds.length; i += 1) {
      for (let j = i + 1; j < openEntityIds.length; j += 1) {
        const a = openEntityIds[i];
        const b = openEntityIds[j];
        if (!a || !b) continue;
        const pairKey = a < b ? `${a}::${b}` : `${b}::${a}`;
        if (this.#recordedPairs.has(pairKey)) continue;
        this.#recordedPairs.add(pairKey);
        await this.#context.repository.recordAssociation(a, b, now);
      }
    }
  }

  /** Closes observations for tracks the tracker has evicted. */
  async close(tracks: Track[], now: number): Promise<RecordedObservation[]> {
    const results: RecordedObservation[] = [];
    for (const track of tracks) {
      const open = this.#open.get(track.id);
      if (!open) continue;
      this.#open.delete(track.id);
      this.#forgetPairsFor(open.entityId);
      const recorded = await this.#finalize(open, track, now);
      if (recorded) results.push(recorded);
    }
    return results;
  }

  /** Closes every open observation — session end, camera stop, unmount. */
  async closeAll(now: number): Promise<RecordedObservation[]> {
    const open = [...this.#open.values()];
    this.#open.clear();
    this.#recordedPairs.clear();
    const results: RecordedObservation[] = [];
    for (const entry of open) {
      const recorded = await this.#finalize(entry, null, now);
      if (recorded) results.push(recorded);
    }
    return results;
  }

  /**
   * Binds an open observation to an existing entity after the user confirms a
   * proposed match, and removes the entity that was provisionally created.
   */
  async confirmMatch(trackId: string, targetEntityId: EntityId): Promise<void> {
    const open = this.#open.get(trackId);
    if (!open || open.entityId === targetEntityId) return;
    const { repository } = this.#context;

    const provisionalId = open.entityId;
    const target = await repository.getEntity(targetEntityId);
    if (!target) return;

    // Re-point the already-durable sighting at the confirmed entity rather than
    // deleting and re-creating it. If the session ends between confirmation and
    // the subject leaving frame, the observation still survives, attached to the
    // right entity.
    const provisionalSightings = await repository.listSightings(provisionalId);
    for (const sighting of provisionalSightings) {
      await repository.addSighting({ ...sighting, entityId: targetEntityId });
    }
    for (const attribute of await repository.listAttributes(provisionalId)) {
      await repository.addAttributes([{ ...attribute, entityId: targetEntityId }]);
    }

    await repository.upsertEntity({
      ...target,
      sightingCount: target.sightingCount + provisionalSightings.length,
      firstSeenAt: Math.min(target.firstSeenAt, open.startedAt),
      lastSeenAt: Math.max(target.lastSeenAt, open.lastSeenAt),
    });

    // The provisional record is now empty of dependents, so nothing cascades.
    await repository.deleteEntity(provisionalId, {
      sightings: false,
      media: false,
      notes: true,
      associations: true,
    });

    open.entityId = targetEntityId;
    open.isNewEntity = false;
    this.#recentEntities.delete(provisionalId);
    // The provisional entity inflated the session's new-entity counter.
    this.#counts.newEntities = Math.max(0, this.#counts.newEntities - 1);
  }

  /* ---- internals -------------------------------------------------------- */

  /**
   * Drops the recorded-pair keys involving an entity whose observation just
   * closed, so that meeting the same subject again later counts as a genuinely
   * new co-occurrence rather than being suppressed forever.
   */
  #forgetPairsFor(entityId: EntityId): void {
    for (const key of this.#recordedPairs) {
      if (key.includes(entityId)) this.#recordedPairs.delete(key);
    }
  }

  async #promote(track: Track, frame: HTMLCanvasElement | null, now: number): Promise<void> {
    const { repository, settings } = this.#context;

    // Appearance sampling happens once at promotion, on the frame that
    // qualified the track — running it every tick would be wasteful and would
    // not produce a better reading.
    const attributes =
      frame && !settings.lowPerformanceMode
        ? analyzeAppearance({
            frame,
            box: track.box,
            kind: track.kind,
            class: track.class,
            entityId: 'pending',
            observedAt: now,
          })
        : [];

    // Propose — never assume — an identity match.
    let candidate = track.candidateMatch;
    if (settings.autoEntityMatching && !candidate) {
      const proposal = proposeMatch(track, {
        entities: [...this.#recentEntities.values()],
        attributesByEntity: this.#attributeCache,
        observedAttributes: attributes,
        now,
      });
      candidate = proposal ?? undefined;
    }
    track.candidateMatch = candidate;

    const ordinal = await repository.nextOrdinal(track.kind);
    const entity: Entity = {
      id: createId('ent'),
      label: designationFor(track.kind, track.class, ordinal),
      kind: track.kind,
      class: track.class,
      firstSeenAt: track.firstSeenAt,
      lastSeenAt: now,
      // The sighting below is written in the same breath, so the count is
      // correct from the instant the entity exists.
      sightingCount: 1,
      favorite: false,
      summary: summarize(attributes),
    };
    await repository.upsertEntity(entity);

    const observationId = createId('obs');
    const sightingId = createId('sig');

    const bound = attributes.map((attribute) => ({ ...attribute, entityId: entity.id, sightingId }));

    /*
     * The sighting is persisted NOW, while the subject is still in frame, and
     * updated again when the observation closes.
     *
     * The alternative — writing only on close — loses the whole observation
     * whenever a session ends abruptly: the tab is closed, the browser
     * reclaims a backgrounded page, the device dies. That left entities with
     * zero sightings and no record of what was actually seen. An observation
     * in progress is real, so it is durable from the moment it qualifies.
     */
    // A representative image is captured now too. It may be superseded on close
    // by a higher-confidence frame, but an interrupted observation then still
    // carries a usable thumbnail rather than a placeholder.
    let thumbnailId: MediaId | undefined;
    if (settings.saveImages && frame) {
      const media = await this.#storeThumbnail(
        { entityId: entity.id, pendingBestFrame: { frame, box: track.box } },
        this.#context.sessionId,
      );
      thumbnailId = media?.id;
      if (thumbnailId) {
        entity.thumbnailId = thumbnailId;
        await repository.upsertEntity(entity);
      }
    }

    await repository.addSighting({
      id: sightingId,
      entityId: entity.id,
      sessionId: this.#context.sessionId,
      observationId,
      class: track.class,
      kind: track.kind,
      startedAt: track.firstSeenAt,
      endedAt: now,
      durationMs: Math.max(0, now - track.firstSeenAt),
      confidence: track.peakScore,
      box: track.box,
      direction: track.direction,
      thumbnailId,
      location: settings.saveLocation && this.#context.location ? this.#context.location : undefined,
      attributes: bound,
      coVisibleEntityIds: [...this.#open.values()].map((other) => other.entityId),
    });
    if (bound.length > 0) await repository.addAttributes(bound);

    this.#recentEntities.set(entity.id, entity);
    this.#attributeCache.set(entity.id, bound);
    this.#counts[track.kind] += 1;
    this.#counts.newEntities += 1;

    track.entityId = entity.id;

    this.#open.set(track.id, {
      trackId: track.id,
      observationId,
      sightingId,
      entityId: entity.id,
      isNewEntity: true,
      startedAt: track.firstSeenAt,
      lastSeenAt: now,
      peakScore: track.peakScore,
      bestScore: track.score,
      pendingBestFrame: null,
      thumbnailId,
      attributes: bound,
      class: track.class,
      kind: track.kind,
      box: track.box,
      direction: track.direction,
    });
  }

  async #finalize(
    open: OpenObservation,
    track: Track | null,
    now: number,
  ): Promise<RecordedObservation | null> {
    const { repository, settings, sessionId, location } = this.#context;

    const endedAt = track?.lastSeenAt ?? open.lastSeenAt ?? now;
    const durationMs = Math.max(0, endedAt - open.startedAt);

    // A better frame may have arrived since promotion; if so it supersedes the
    // thumbnail stored then, and the superseded one is deleted rather than left
    // orphaned in storage.
    let thumbnailId = open.thumbnailId;
    if (settings.saveImages && open.pendingBestFrame) {
      const media = await this.#storeThumbnail(open, sessionId);
      if (media) {
        if (open.thumbnailId) await repository.deleteMedia(open.thumbnailId);
        thumbnailId = media.id;
      }
    }

    const attributes = open.attributes;

    // Same id as the record written at promotion: this is an update of the
    // open observation, not a second sighting of the same appearance.
    const sighting: Sighting = {
      id: open.sightingId,
      entityId: open.entityId,
      sessionId,
      observationId: open.observationId,
      class: open.class,
      kind: open.kind,
      startedAt: open.startedAt,
      endedAt,
      durationMs,
      confidence: open.peakScore,
      box: track?.box ?? open.box,
      direction: track?.direction ?? open.direction,
      thumbnailId,
      location: settings.saveLocation && location ? location : undefined,
      attributes,
      coVisibleEntityIds: [...this.#open.values()]
        .filter((other) => other.entityId !== open.entityId)
        .map((other) => other.entityId),
    };

    await repository.addSighting(sighting);

    const entity = await repository.getEntity(open.entityId);
    if (!entity) return null;

    const updated: Entity = {
      ...entity,
      lastSeenAt: endedAt,
      // Not incremented: the sighting was already counted at promotion.
      // If the promotion thumbnail was superseded it has just been deleted, so
      // the entity must not keep pointing at it. Otherwise an entity that
      // already had a representative image keeps the one it had.
      thumbnailId:
        entity.thumbnailId && entity.thumbnailId !== open.thumbnailId
          ? entity.thumbnailId
          : thumbnailId,
      summary: entity.summary ?? summarize(attributes),
    };
    await repository.upsertEntity(updated);
    this.#recentEntities.set(updated.id, updated);

    return { sighting, entity: updated, isNewEntity: open.isNewEntity };
  }

  /** Crops and stores the representative image for an observation. */
  async #storeThumbnail(
    open: Pick<OpenObservation, 'entityId' | 'pendingBestFrame'>,
    sessionId: SessionId,
  ): Promise<MediaRecord | null> {
    const pending = open.pendingBestFrame;
    if (!pending) return null;
    try {
      const cropped = await cropThumbnail(pending.frame, pending.box);
      if (!cropped) return null;
      const record: MediaRecord = {
        id: createId('med'),
        entityId: open.entityId,
        sessionId,
        kind: 'thumbnail',
        mimeType: cropped.blob.type || 'image/jpeg',
        width: cropped.width,
        height: cropped.height,
        byteSize: cropped.blob.size,
        createdAt: Date.now(),
        blob: cropped.blob,
      };
      await this.#context.repository.putMedia(record);
      return record;
    } catch {
      // A storage quota failure must never abort the observation itself.
      return null;
    }
  }
}

interface OpenObservation {
  trackId: string;
  observationId: string;
  /** Allocated at promotion; the record it names is updated on close. */
  sightingId: SightingId;
  entityId: EntityId;
  isNewEntity: boolean;
  startedAt: number;
  lastSeenAt: number;
  peakScore: number;
  bestScore: number;
  pendingBestFrame: { frame: HTMLCanvasElement; box: Track['box'] } | null;
  /** Thumbnail stored so far; replaced only if a better frame arrives. */
  thumbnailId?: MediaId;
  attributes: Attribute[];
  class: Track['class'];
  kind: Track['kind'];
  box: Track['box'];
  direction: Track['direction'];
}

/** Short descriptor built only from attributes confident enough to assert. */
function summarize(attributes: Attribute[]): string | undefined {
  const confident = attributes.filter((a) => a.confidence >= 0.7);
  if (confident.length === 0) return undefined;
  const preferred = ['color', 'coat-color', 'upper', 'lower', 'hair-color'];
  const ordered = confident.sort(
    (a, b) => preferred.indexOf(a.key) - preferred.indexOf(b.key) || b.confidence - a.confidence,
  );
  return ordered
    .slice(0, 2)
    .map((a) => a.value)
    .join(' · ');
}
