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
import { seedProfile } from '@/lib/profiles';
import { cropThumbnail } from '@/lib/vision/capture';
import { analyzeAppearance } from '@/lib/vision/attributes';
import { proposeMatch } from '@/lib/vision/entityMatcher';
import { CandidatePool } from '@/lib/vision/candidatePool';
import { FaceGallery } from '@/lib/vision/faceGallery';
import {
  embedFace,
  isFaceEmbedderLoaded,
  FACE_MODEL_ID,
  type FaceEmbedding,
} from '@/lib/vision/faceEmbedder';
import { matchFace, FACE_SENSITIVITY } from '@/lib/vision/faceMatcher';
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

/** Frame sources for one detection tick. */
export interface FrameSources {
  /** Downscaled canvas the detector ran on. */
  inference: HTMLCanvasElement | null;
  /** Full-resolution camera frame, when the element is available. */
  video: HTMLVideoElement | null;
}

type EncodedThumbnail = { blob: Blob; width: number; height: number };

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
  /**
   * Match candidates, drawn from the durable store rather than from this
   * session's own work. Scoping candidates to the session made recognising a
   * returning subject impossible — see `lib/vision/candidatePool.ts`.
   */
  #candidates: CandidatePool;
  /** Entity pairs already credited with a co-occurrence, per overlap. */
  #recordedPairs = new Set<string>();
  /** Tracks whose proposal the operator rejected; never re-proposed. */
  #rejectedTracks = new Set<string>();
  /** Stored face descriptors, when face recognition is enabled. */
  #faces: FaceGallery;

  constructor(context: RecorderContext) {
    this.#context = context;
    this.#candidates = new CandidatePool(context.repository);
    this.#faces = new FaceGallery(context.repository);
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
  async observe(tracks: Track[], sources: FrameSources, now: number): Promise<void> {
    const { settings } = this.#context;
    if (!settings.saveObservations) return;

    for (const track of tracks) {
      const dwell = now - track.firstSeenAt;
      const existing = this.#open.get(track.id);

      if (existing) {
        // Keep the highest-confidence frame as the representative image: the
        // first qualifying frame is often the moment of partial entry.
        //
        // The crop happens NOW rather than being deferred to close. The
        // inference canvas is a single buffer reused every tick, so holding a
        // reference to it and cropping minutes later would encode whatever the
        // camera happens to be looking at then, positioned by a box captured
        // long before. Encoding immediately is the only way the pixels and the
        // box describe the same instant.
        if (settings.saveImages && track.score > existing.bestScore + 0.05) {
          const better = await this.#encodeThumbnail(sources, track.box);
          if (better) {
            existing.bestScore = track.score;
            existing.pendingBestBlob = better;
          }
        }
        existing.lastSeenAt = now;
        existing.peakScore = Math.max(existing.peakScore, track.peakScore);
        continue;
      }

      if (dwell < settings.observationThresholdMs) {
        // Warm the caches while the track is still earning its dwell, so
        // promotion does not have to wait on storage.
        if (settings.autoEntityMatching) this.#candidates.prefetch(track.kind, now);
        if (settings.faceRecognition && track.kind === 'person') this.#faces.prefetch(now);
        continue;
      }

      await this.#promote(track, sources, now);
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
      // Descriptors captured against the provisional record are re-pointed at
      // the confirmed entity below, so they must not be cascaded away here.
      faceEmbeddings: false,
    });

    // Descriptors captured against the provisional record are genuine readings
    // of the confirmed subject, so they join that subject's gallery. This is
    // what makes each confirmation improve later recognition.
    try {
      await this.#faces.reassign(provisionalId, targetEntityId);
    } catch {
      // A failure here loses a descriptor, not the confirmation itself.
    }

    open.entityId = targetEntityId;
    open.isNewEntity = false;
    this.#candidates.forget(provisionalId, target.kind);
    // The provisional entity inflated the session's new-entity counter.
    this.#counts.newEntities = Math.max(0, this.#counts.newEntities - 1);
  }

  /**
   * Dismisses a proposal. The provisional entity stands as its own subject and
   * the track is never proposed against again, so a rejected suggestion cannot
   * reappear a few seconds later and be asked a second time.
   */
  rejectMatch(trackId: string): void {
    this.#rejectedTracks.add(trackId);
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

  async #promote(track: Track, sources: FrameSources, now: number): Promise<void> {
    const frame = sources.inference;
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

    // An entity currently held open by another track is, by definition, a
    // different subject: both are in frame at once. Proposing one as a match
    // for the other would be wrong no matter how similar they look.
    const openEntityIds = new Set([...this.#open.values()].map((o) => o.entityId));

    // A face descriptor, when the operator has enabled it. Computed once per
    // observation on the frame that qualified the track, like appearance.
    const face = await this.#embed(track, sources);

    // Propose — never assume — an identity match.
    let candidate = track.candidateMatch;
    const mayPropose = !candidate && !this.#rejectedTracks.has(track.id);

    /*
     * Face first, and exclusively when it is available.
     *
     * A face descriptor and a colour reading are not two opinions to be
     * averaged. The face signal is enormously stronger, so blending in a
     * colour score could only drag a good proposal down or lift a bad one up.
     * When there is a usable face, it decides; when there is not, the weak
     * signals are all that is left and are used on their own.
     */
    if (mayPropose && face) {
      const gallery = await this.#faces.all(now);
      const hit = matchFace(face.descriptor, gallery, {
        exclude: openEntityIds,
        threshold: FACE_SENSITIVITY[settings.faceSensitivity],
      });
      if (hit) {
        const matched = await repository.getEntity(hit.entityId);
        if (matched && !matched.archivedAt) {
          candidate = {
            entityId: matched.id,
            entityLabel: matched.label,
            similarity: hit.similarity,
            basis: ['face'],
          };
        }
      }
    }

    if (mayPropose && !candidate && settings.autoEntityMatching) {
      const pool = await this.#candidates.candidates(track.kind, now);
      const proposal = proposeMatch(track, {
        entities: pool.entities.filter((entity) => !openEntityIds.has(entity.id)),
        attributesByEntity: pool.attributesByEntity,
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
      // Only what the detector genuinely established — see `seedProfile`.
      profile: seedProfile(track.kind, track.class),
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
    let promotionBlob: EncodedThumbnail | null = null;
    if (settings.saveImages) {
      promotionBlob = await this.#encodeThumbnail(sources, track.box);
      const media = await this.#storeThumbnail(entity.id, promotionBlob, this.#context.sessionId);
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

    // Matchable immediately, so a subject who steps out of frame and returns
    // within the pool's refresh window is still a candidate.
    this.#candidates.remember(entity, bound);

    // The descriptor is written against the entity that was just created, even
    // when a match was proposed above: the proposal is not yet a decision. If
    // the operator confirms it, `confirmMatch` moves the descriptor onto the
    // confirmed subject; if they decline, it correctly belongs to a new one.
    if (face) {
      try {
        await this.#faces.add({
          id: createId('emb'),
          entityId: entity.id,
          sightingId,
          descriptor: face.descriptor,
          score: face.score,
          model: FACE_MODEL_ID,
          createdAt: now,
        });
      } catch {
        // Storage pressure must not cost the observation itself.
      }
    }
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
      pendingBestBlob: null,
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
    if (settings.saveImages && open.pendingBestBlob) {
      const media = await this.#storeThumbnail(open.entityId, open.pendingBestBlob, sessionId);
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
    this.#candidates.remember(updated, attributes);

    return { sighting, entity: updated, isNewEntity: open.isNewEntity };
  }

  /**
   * Computes a face descriptor for a person track, or null.
   *
   * Null covers every case where a descriptor would be untrustworthy — the
   * feature is off, the models are not resident, the subject is not a person,
   * no face was found, or the face was too small. A null is "no face signal",
   * never "no match", and the caller falls back to the weaker signals.
   */
  async #embed(track: Track, sources: FrameSources): Promise<FaceEmbedding | null> {
    const { settings } = this.#context;
    if (!settings.faceRecognition || track.kind !== 'person') return null;
    if (!isFaceEmbedderLoaded()) return null;

    // The full-resolution video, not the downscaled inference canvas: a face
    // inside a person box on a 480 px canvas is often only tens of pixels
    // across, which is below the threshold the embedder will accept anyway.
    const source = sources.video ?? sources.inference;
    if (!source) return null;

    try {
      return await embedFace(source, track.box);
    } catch {
      return null;
    }
  }

  /**
   * Encodes a thumbnail from the best available source.
   *
   * The video element is preferred over the inference canvas: the canvas is
   * downscaled for detection speed, so cropping it caps thumbnail detail at
   * roughly a third of what the camera actually captured.
   */
  async #encodeThumbnail(
    sources: FrameSources,
    box: Track['box'],
  ): Promise<EncodedThumbnail | null> {
    const { settings } = this.#context;
    const source = sources.video ?? sources.inference;
    if (!source) return null;
    try {
      return await cropThumbnail(source, box, { size: settings.thumbnailSize });
    } catch {
      return null;
    }
  }

  /** Persists an already-encoded thumbnail. */
  async #storeThumbnail(
    entityId: EntityId,
    encoded: EncodedThumbnail | null,
    sessionId: SessionId,
  ): Promise<MediaRecord | null> {
    if (!encoded) return null;
    try {
      const record: MediaRecord = {
        id: createId('med'),
        entityId,
        sessionId,
        kind: 'thumbnail',
        mimeType: encoded.blob.type || 'image/jpeg',
        width: encoded.width,
        height: encoded.height,
        byteSize: encoded.blob.size,
        createdAt: Date.now(),
        blob: encoded.blob,
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
  /** Already-encoded better frame, awaiting the observation's close. */
  pendingBestBlob: EncodedThumbnail | null;
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
