import type {
  Association,
  Attribute,
  Entity,
  EntityId,
  EntityKind,
  FaceEmbeddingRecord,
  MediaId,
  MediaRecord,
  Note,
  Session,
  SessionId,
  Sighting,
  TimelineEvent,
} from '@/types/domain';

/**
 * OBSERVATION REPOSITORY
 * ---------------------------------------------------------------------------
 * The single persistence contract. Two implementations exist:
 *
 *   IndexedDbRepository  local-first, no account required, works offline.
 *   SupabaseRepository   Postgres + object storage, for sync across devices.
 *
 * Everything above this interface — screens, hooks, the observation recorder —
 * is storage-agnostic. That is what makes it possible to run the whole product
 * with no backend during early development and add sync later without a
 * rewrite.
 */
export interface ObservationRepository {
  readonly id: string;
  /** Resolves once the backing store is usable. Throws if it cannot be opened. */
  ready(): Promise<void>;

  // ---- Sessions -----------------------------------------------------------
  createSession(session: Session): Promise<void>;
  updateSession(id: SessionId, patch: Partial<Session>): Promise<void>;
  getSession(id: SessionId): Promise<Session | null>;
  listSessions(limit?: number): Promise<Session[]>;

  // ---- Entities -----------------------------------------------------------
  upsertEntity(entity: Entity): Promise<void>;
  getEntity(id: EntityId): Promise<Entity | null>;
  listEntities(filter?: EntityFilter): Promise<Entity[]>;
  /** Next ordinal for a kind, used to build `PERSON 014`. */
  nextOrdinal(kind: EntityKind): Promise<number>;
  /**
   * Folds `sourceIds` into `targetId`. Reversible: the target records its
   * origins so the interface can offer a split.
   */
  mergeEntities(targetId: EntityId, sourceIds: EntityId[]): Promise<void>;
  /** Detaches previously merged entities back into their own records. */
  splitEntity(entityId: EntityId, sightingIds: string[]): Promise<EntityId>;
  deleteEntity(id: EntityId, cascade: DeleteCascade): Promise<void>;

  // ---- Sightings ----------------------------------------------------------
  addSighting(sighting: Sighting): Promise<void>;
  listSightings(entityId: EntityId): Promise<Sighting[]>;
  listTimeline(filter?: TimelineFilter): Promise<TimelineEvent[]>;

  // ---- Attributes, notes, associations ------------------------------------
  addAttributes(attributes: Attribute[]): Promise<void>;
  listAttributes(entityId: EntityId): Promise<Attribute[]>;
  addNote(note: Note): Promise<void>;
  listNotes(entityId: EntityId): Promise<Note[]>;
  deleteNote(id: string): Promise<void>;
  recordAssociation(a: EntityId, b: EntityId, at: number): Promise<void>;
  listAssociations(entityId: EntityId): Promise<Association[]>;

  // ---- Face descriptors ---------------------------------------------------
  // Kept behind their own methods rather than folded into attributes: these are
  // biometric identifiers and must be independently countable and deletable.
  putFaceEmbedding(record: FaceEmbeddingRecord): Promise<void>;
  /** Every stored descriptor. The matcher needs the whole gallery to compare. */
  listFaceEmbeddings(): Promise<FaceEmbeddingRecord[]>;
  listFaceEmbeddingsFor(entityId: EntityId): Promise<FaceEmbeddingRecord[]>;
  deleteFaceEmbedding(id: string): Promise<void>;
  /** Removes every descriptor, leaving observations intact. */
  purgeFaceEmbeddings(): Promise<void>;

  // ---- Media --------------------------------------------------------------
  putMedia(record: MediaRecord): Promise<void>;
  getMedia(id: MediaId): Promise<MediaRecord | null>;
  deleteMedia(id: MediaId): Promise<void>;

  // ---- Maintenance --------------------------------------------------------
  /** Aggregate storage footprint, for the privacy screen. */
  usage(): Promise<StorageUsage>;
  /** Irreversibly removes every record. */
  purgeAll(): Promise<void>;
}

export interface EntityFilter {
  kind?: EntityKind;
  favorite?: boolean;
  search?: string;
  sort?: 'recent' | 'sightings' | 'label' | 'first-seen';
}

export interface TimelineFilter {
  kinds?: EntityKind[];
  favorite?: boolean;
  search?: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface DeleteCascade {
  sightings: boolean;
  media: boolean;
  notes: boolean;
  associations: boolean;
  faceEmbeddings: boolean;
}

export const FULL_CASCADE: DeleteCascade = {
  sightings: true,
  media: true,
  notes: true,
  associations: true,
  faceEmbeddings: true,
};

export interface StorageUsage {
  entities: number;
  sightings: number;
  media: number;
  mediaBytes: number;
  notes: number;
  sessions: number;
  /** Stored face descriptors. Surfaced separately on the privacy screen. */
  faceEmbeddings: number;
  /** Browser-reported quota, when the Storage API exposes it. */
  quotaBytes?: number;
  usageBytes?: number;
}

/** Case-insensitive substring match across a record's searchable text. */
export function matchesSearch(haystack: string[], needle: string | undefined): boolean {
  if (!needle) return true;
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  const terms = query.split(/\s+/);
  const text = haystack.join(' ').toLowerCase();
  return terms.every((term) => text.includes(term));
}
