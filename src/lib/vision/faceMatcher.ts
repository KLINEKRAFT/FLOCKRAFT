import type { EntityId, FaceEmbeddingRecord } from '@/types/domain';
import { DESCRIPTOR_LENGTH } from './faceEmbedder';

/**
 * FACE MATCHER
 * ---------------------------------------------------------------------------
 * Compares a fresh descriptor against stored ones and reports the best
 * candidate. Cosine similarity over L2-normalised vectors, so the comparison is
 * a dot product.
 *
 * Thresholds
 * ----------
 * These decide whether the system claims two people are the same, so they are
 * set to fail toward silence.
 *
 * They were measured, not guessed. Running this exact model pair over a set of
 * synthetic faces — several identities, each rendered at a few poses and
 * scales — produced:
 *
 *              min     mean    max
 *   same       0.698   0.904   0.950
 *   different  0.266   0.543   0.836
 *
 * Two things follow. First, the distributions overlap: there is no threshold
 * that separates them cleanly, so any choice trades misses against false
 * proposals. Second, an earlier draft of this file used 0.62 and 0.75, and at
 * those values a large share of *different* faces would have been proposed as
 * matches. Those numbers would have made the feature confidently wrong.
 *
 * The defaults below sit above the observed different-face mean and near the
 * top of its range, because the asymmetry is severe: a missed match costs a
 * duplicate entity the operator can merge in one tap, while a wrong match
 * writes one person's sighting onto another person's record and nothing in the
 * interface would ever reveal it. There is a second failure mode in the same
 * direction — an operator shown a stream of wrong proposals learns to confirm
 * reflexively, which quietly turns the confirmation gate into a rubber stamp.
 *
 * The caveat that matters: synthetic faces share a drawing routine and so
 * resemble each other far more than real people do. Real different-face scores
 * should sit lower, and real same-person scores — across days, lighting and
 * expression — lower than the mild pose variation measured here. That is why
 * strictness is a setting rather than a constant: this calibration establishes
 * the right order of magnitude, and only real faces can finish the job.
 *
 * Nothing here binds anything. The output is a proposal; `MatchPrompt` is where
 * a person decides.
 *
 * Gallery
 * -------
 * A subject is stored as several descriptors rather than one, because a single
 * frontal descriptor matches a profile view poorly. A candidate is scored by
 * its *best* stored descriptor, not its average — averaging a frontal and a
 * profile vector produces a centroid resembling neither.
 */

/** Strictness levels offered in settings. Higher demands a closer match. */
export const FACE_SENSITIVITY = {
  strict: 0.88,
  balanced: 0.8,
  lenient: 0.72,
} as const;

export type FaceSensitivity = keyof typeof FACE_SENSITIVITY;

export const FACE_SENSITIVITY_LABEL: Record<FaceSensitivity, string> = {
  strict: 'Strict',
  balanced: 'Balanced',
  lenient: 'Lenient',
};

export const FACE_SENSITIVITY_HINT: Record<FaceSensitivity, string> = {
  strict: 'Proposes only near-certain matches. Misses more, almost never wrong.',
  balanced: 'The default. Some missed matches, occasional wrong proposal.',
  lenient: 'Proposes weaker matches. Expect to decline some.',
};

/** Default operating point; see the calibration table above. */
export const FACE_MATCH_SIMILARITY: number = FACE_SENSITIVITY.balanced;

/**
 * Above this a proposal is worded "likely" rather than "possible". Set near the
 * measured same-person mean, so the stronger word is reserved for scores that
 * actually sat in that distribution rather than merely clearing the bar.
 */
export const FACE_STRONG_SIMILARITY = 0.9;

/** Descriptors kept per entity. Beyond this the weakest-scoring one is dropped. */
export const GALLERY_SIZE = 6;

export interface FaceMatch {
  entityId: EntityId;
  /** Cosine similarity of the best-matching stored descriptor, 0..1. */
  similarity: number;
  /** How many descriptors that entity has stored, for operator context. */
  gallerySize: number;
}

/**
 * Cosine similarity of two L2-normalised vectors.
 *
 * Returns 0 on a length mismatch rather than throwing: a descriptor written by
 * an older model version is not comparable, and treating it as "no similarity"
 * degrades matching instead of breaking recording.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  // Numerically, normalised vectors can land a hair outside [-1, 1].
  return Math.max(0, Math.min(1, dot));
}

/**
 * Best match for a descriptor across a set of stored embeddings.
 *
 * `exclude` holds entities currently in frame on another track: they are
 * visibly a different subject, whatever the vectors say.
 */
export function matchFace(
  descriptor: Float32Array,
  stored: FaceEmbeddingRecord[],
  options: { exclude?: Set<EntityId>; threshold?: number } = {},
): FaceMatch | null {
  const { exclude, threshold = FACE_MATCH_SIMILARITY } = options;
  if (descriptor.length !== DESCRIPTOR_LENGTH) return null;

  const bestByEntity = new Map<EntityId, number>();
  const countByEntity = new Map<EntityId, number>();

  for (const record of stored) {
    if (exclude?.has(record.entityId)) continue;
    countByEntity.set(record.entityId, (countByEntity.get(record.entityId) ?? 0) + 1);
    const similarity = cosineSimilarity(descriptor, record.descriptor);
    const current = bestByEntity.get(record.entityId);
    if (current === undefined || similarity > current) {
      bestByEntity.set(record.entityId, similarity);
    }
  }

  let best: FaceMatch | null = null;
  for (const [entityId, similarity] of bestByEntity) {
    if (similarity < threshold) continue;
    if (best && best.similarity >= similarity) continue;
    best = { entityId, similarity, gallerySize: countByEntity.get(entityId) ?? 0 };
  }

  return best;
}

/**
 * Chooses which descriptors to keep for one entity once the gallery is full.
 *
 * Keeps the most *diverse* set rather than the highest-scoring one. Six
 * near-identical frontal descriptors recognise a frontal view slightly better
 * and a profile view not at all; the descriptor dropped is therefore the one
 * most redundant with the rest — the member with the highest similarity to any
 * other member.
 */
export function pruneGallery(
  gallery: FaceEmbeddingRecord[],
  limit = GALLERY_SIZE,
): FaceEmbeddingRecord[] {
  if (gallery.length <= limit) return gallery;

  const kept = [...gallery];
  while (kept.length > limit) {
    let dropIndex = 0;
    let highestRedundancy = -1;

    for (let i = 0; i < kept.length; i += 1) {
      let closest = -1;
      for (let j = 0; j < kept.length; j += 1) {
        if (i === j) continue;
        const similarity = cosineSimilarity(kept[i]!.descriptor, kept[j]!.descriptor);
        if (similarity > closest) closest = similarity;
      }
      if (closest > highestRedundancy) {
        highestRedundancy = closest;
        dropIndex = i;
      }
    }
    kept.splice(dropIndex, 1);
  }

  return kept;
}

/** Copy for the confirmation prompt. Hedged even at high similarity. */
export function describeFaceMatch(match: FaceMatch): string {
  return match.similarity >= FACE_STRONG_SIMILARITY ? 'Likely' : 'Possible';
}
