/**
 * FLOCKRAFT DOMAIN MODEL
 * ---------------------------------------------------------------------------
 * The hierarchy is:
 *
 *   Session          one continuous period of observation from one camera
 *     └ Observation  one continuous appearance of one tracked object
 *         └ Sighting materialised record of that observation, bound to an Entity
 *
 *   Entity           long-term memory: a subject seen across many sessions
 *     ├ Sighting[]   every appearance
 *     ├ Attribute[]  time-stamped, confidence-scored appearance observations
 *     ├ Note[]       user-authored text
 *     └ Association[] co-occurrence with other entities
 *
 * Two identifiers must never be conflated:
 *   TrackId   — ephemeral, valid only within a single session's tracker run.
 *   EntityId  — durable, survives sessions, may be merged or split by the user.
 */

export type SessionId = string;
export type EntityId = string;
export type SightingId = string;
export type ObservationId = string;
export type TrackId = string;
export type MediaId = string;

/** Broad class used for filtering, colour coding and entity bucketing. */
export type EntityKind = 'person' | 'vehicle' | 'animal' | 'object';

/**
 * Detector output classes. Deliberately a closed union: an unrecognised label
 * from a swapped-in model is normalised to `'unknown'` rather than silently
 * widening the type surface.
 */
export const DETECTION_CLASSES = [
  'person',
  'dog',
  'cat',
  'bird',
  'horse',
  'sheep',
  'cow',
  'bear',
  'car',
  'truck',
  'bus',
  'motorcycle',
  'bicycle',
  'boat',
  'airplane',
  'train',
  'backpack',
  'handbag',
  'suitcase',
  'umbrella',
  'unknown',
] as const;

export type DetectionClass = (typeof DETECTION_CLASSES)[number];

/**
 * Normalised bounding box in the range 0..1, relative to the *source frame*
 * (not the rendered element). Storing normalised coordinates means a box stays
 * correct across orientation changes, element resizes and thumbnail crops.
 */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single detector result for a single frame. */
export interface Detection {
  class: DetectionClass;
  /** 0..1 model confidence. Never presented without its numeric value. */
  score: number;
  box: NormalizedBox;
}

/** Direction of travel inferred from centroid motion in camera space. */
export type CameraDirection =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'toward'
  | 'away'
  | 'static';

/**
 * A live track. Exists only in memory during a session; promoted to an
 * Observation once it satisfies the persistence threshold.
 */
export interface Track {
  id: TrackId;
  /** Human-facing temporary label, e.g. `PERSON TEMP-04`. */
  label: string;
  class: DetectionClass;
  kind: EntityKind;
  box: NormalizedBox;
  score: number;
  /** Peak confidence observed across the track's life. */
  peakScore: number;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Frames in which the track was successfully matched to a detection. */
  hits: number;
  /** Consecutive frames the track has gone unmatched; drives eviction. */
  missedFrames: number;
  /** Smoothed centroid velocity, normalised units per second. */
  velocity: { x: number; y: number };
  direction: CameraDirection;
  /** Set once the track has been persisted as an observation. */
  observationId?: ObservationId;
  /** Set once the observation has been bound to a durable entity. */
  entityId?: EntityId;
  /** Candidate entity awaiting user confirmation. */
  candidateMatch?: EntityMatchCandidate;
}

/** A proposed — never assumed — identity match. */
export interface EntityMatchCandidate {
  entityId: EntityId;
  entityLabel: string;
  /** 0..1 similarity. Presented to the user as "possible match", not a fact. */
  similarity: number;
  basis: MatchBasis[];
}

export type MatchBasis =
  | 'class'
  | 'appearance'
  | 'temporal-proximity'
  | 'spatial-proximity'
  | 'user-confirmed';

/** An observation session — one camera, one continuous run. */
export interface Session {
  id: SessionId;
  startedAt: number;
  endedAt?: number;
  /** Label of the media device, when the browser discloses it. */
  deviceLabel?: string;
  facingMode?: 'user' | 'environment';
  detectorId: string;
  location?: GeoFix;
  /** Denormalised counters, maintained incrementally to avoid table scans. */
  counts: SessionCounts;
}

export interface SessionCounts {
  person: number;
  vehicle: number;
  animal: number;
  object: number;
  newEntities: number;
}

export interface GeoFix {
  latitude: number;
  longitude: number;
  /** Metres, as reported by the Geolocation API. Never fabricated. */
  accuracy: number;
  heading?: number | null;
  speed?: number | null;
  timestamp: number;
}

/** A time-stamped, confidence-scored appearance characteristic. */
export interface Attribute {
  id: string;
  entityId: EntityId;
  sightingId?: SightingId;
  /** e.g. `upper`, `lower`, `hair-color`, `bag`, `headwear`, `coat-color`. */
  key: string;
  value: string;
  /** 0..1. Values below 0.7 are rendered with a "possible" qualifier. */
  confidence: number;
  observedAt: number;
  source: 'model' | 'user';
}

/** A materialised appearance of an entity. */
export interface Sighting {
  id: SightingId;
  entityId: EntityId;
  sessionId: SessionId;
  observationId: ObservationId;
  class: DetectionClass;
  kind: EntityKind;
  startedAt: number;
  endedAt: number;
  /** Milliseconds the subject remained continuously tracked. */
  durationMs: number;
  /** Peak detector confidence during the sighting. */
  confidence: number;
  /** Bounding box at the moment the representative frame was captured. */
  box: NormalizedBox;
  direction: CameraDirection;
  thumbnailId?: MediaId;
  location?: GeoFix;
  attributes: Attribute[];
  /** Entity ids co-visible during this sighting. */
  coVisibleEntityIds: EntityId[];
}

export interface Note {
  id: string;
  entityId: EntityId;
  sightingId?: SightingId;
  body: string;
  createdAt: number;
  author: string;
}

export interface Association {
  entityId: EntityId;
  otherEntityId: EntityId;
  /** Number of sightings in which both entities were simultaneously visible. */
  count: number;
  lastObservedAt: number;
}

/**
 * One field of an entity profile, carrying its provenance.
 *
 * Provenance is not decoration. A colour sampled by the detector and a licence
 * plate typed by an operator are different kinds of claim, and the interface
 * must never present them as the same thing. `source` is what lets it show a
 * measured reading with a confidence and an operator's entry as fact.
 */
export interface ProfileField {
  value: string;
  source: 'model' | 'user';
  /** 0..1 for model readings; always 1 for an operator entry. */
  confidence: number;
  observedAt: number;
}

/**
 * Structured profile for an entity, keyed by field id.
 *
 * Deliberately a flat map rather than a per-kind interface: the field set is
 * declared once in `lib/profiles.ts` and drives storage, editing, display and
 * search from a single source. Adding a field to a kind is a one-line change
 * there, not a change in five files.
 */
export type EntityProfile = Record<string, ProfileField>;

export interface Entity {
  id: EntityId;
  /** Stable display designation, e.g. `PERSON 014`. */
  label: string;
  kind: EntityKind;
  class: DetectionClass;
  firstSeenAt: number;
  lastSeenAt: number;
  sightingCount: number;
  favorite: boolean;
  /** Set when a user merges entities; retained so a split can be offered. */
  mergedFromIds?: EntityId[];
  /** Short user-facing descriptor derived from high-confidence attributes. */
  summary?: string;
  /** Operator-maintained structured fields. See `lib/profiles.ts`. */
  profile?: EntityProfile;
  thumbnailId?: MediaId;
  archivedAt?: number;
}

/** Stored media. Blobs live in IndexedDB locally, or object storage remotely. */
export interface MediaRecord {
  id: MediaId;
  entityId?: EntityId;
  sightingId?: SightingId;
  sessionId: SessionId;
  kind: 'thumbnail' | 'snapshot' | 'clip';
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: number;
  /** Present for locally-held media only. */
  blob?: Blob;
  /** Present for remotely-held media only. */
  remotePath?: string;
}

/** Timeline row — an entity sighting flattened for chronological display. */
export interface TimelineEvent {
  id: SightingId;
  entityId: EntityId;
  entityLabel: string;
  kind: EntityKind;
  class: DetectionClass;
  timestamp: number;
  durationMs: number;
  confidence: number;
  thumbnailId?: MediaId;
  attributes: Attribute[];
  location?: GeoFix;
  favorite: boolean;
  isNewEntity: boolean;
}
