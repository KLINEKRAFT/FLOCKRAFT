import { FACE_STRONG_SIMILARITY } from './faceMatcher';
import type {
  Attribute,
  Entity,
  EntityMatchCandidate,
  MatchBasis,
  Track,
} from '@/types/domain';

/**
 * ENTITY MATCHER
 * ---------------------------------------------------------------------------
 * Decides whether a newly-observed track *might* be an entity FLOCKRAFT has
 * seen before. The output is a proposal — `possible match` — and never an
 * assertion. Binding a sighting to an existing entity always requires an
 * explicit user confirmation.
 *
 * This is a deliberate product constraint, not a technical limitation. A system
 * that silently accumulates a biometric identity database of people who never
 * consented to it is a different product than the one we are building. The
 * signals below are intentionally weak-but-honest: class agreement, appearance
 * colour agreement, and recency. There is no face embedding here.
 *
 * Because the signals are weak, the thresholds are high and the language is
 * hedged. Below `MIN_PROPOSAL_SIMILARITY` nothing is proposed at all — an
 * absent proposal is far better than a wrong one.
 */

export const MIN_PROPOSAL_SIMILARITY = 0.62;
/** Above this, the proposal is shown first but still requires confirmation. */
export const STRONG_PROPOSAL_SIMILARITY = 0.82;

export interface MatchContext {
  /** Candidate entities, normally the recently-active set rather than all. */
  entities: Entity[];
  /** Attributes indexed by entity id, most recent first. */
  attributesByEntity: Map<string, Attribute[]>;
  /** Attributes just observed for the track under consideration. */
  observedAttributes: Attribute[];
  now: number;
}

/**
 * Returns the best proposal for a track, or `null` when nothing is close
 * enough to be worth putting in front of the user.
 */
export function proposeMatch(track: Track, context: MatchContext): EntityMatchCandidate | null {
  let best: EntityMatchCandidate | null = null;

  for (const entity of context.entities) {
    if (entity.archivedAt) continue;
    // Class agreement is a hard gate, not a weighted signal.
    if (entity.class !== track.class) continue;

    const basis: MatchBasis[] = ['class'];
    // Class agreement alone is near-worthless evidence and is scored as such.
    let score = 0.3;

    const stored = context.attributesByEntity.get(entity.id) ?? [];
    const appearance = appearanceSimilarity(context.observedAttributes, stored);
    if (appearance !== null) {
      score += appearance * 0.5;
      if (appearance > 0.5) basis.push('appearance');
    }

    const recency = recencyScore(entity.lastSeenAt, context.now);
    score += recency * 0.2;
    if (recency > 0.5) basis.push('temporal-proximity');

    const similarity = clamp01(score);
    if (similarity < MIN_PROPOSAL_SIMILARITY) continue;
    if (best && best.similarity >= similarity) continue;

    best = { entityId: entity.id, entityLabel: entity.label, similarity, basis };
  }

  return best;
}

/**
 * Agreement between two attribute sets, weighted by the confidence of both
 * sides. Returns `null` when there is no overlapping key to compare, which is
 * meaningfully different from "compared and disagreed".
 */
export function appearanceSimilarity(
  observed: Attribute[],
  stored: Attribute[],
): number | null {
  if (observed.length === 0 || stored.length === 0) return null;

  // Most recent stored reading wins per key — appearance changes over time.
  const storedByKey = new Map<string, Attribute>();
  for (const attribute of stored) {
    const existing = storedByKey.get(attribute.key);
    if (!existing || attribute.observedAt > existing.observedAt) {
      storedByKey.set(attribute.key, attribute);
    }
  }

  let weightedAgreement = 0;
  let totalWeight = 0;

  for (const attribute of observed) {
    const counterpart = storedByKey.get(attribute.key);
    if (!counterpart) continue;
    // A comparison between two uncertain readings is itself uncertain.
    const weight = attribute.confidence * counterpart.confidence;
    const agrees = attribute.value === counterpart.value ? 1 : 0;
    weightedAgreement += agrees * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;
  return weightedAgreement / totalWeight;
}

/**
 * Recency prior. A subject seen two minutes ago is far more likely to be the
 * one now in frame than one last seen a week ago. Decays to zero over 24 h.
 */
export function recencyScore(lastSeenAt: number, now: number): number {
  const elapsedMinutes = Math.max(0, now - lastSeenAt) / 60_000;
  if (elapsedMinutes <= 5) return 1;
  if (elapsedMinutes >= 1440) return 0;
  return 1 - Math.log10(elapsedMinutes / 5 + 1) / Math.log10(1440 / 5 + 1);
}

/**
 * Copy for the confirmation prompt — hedged by design.
 *
 * A face proposal and a colour proposal are not on the same scale: a 0.75
 * cosine between face descriptors is strong evidence, while 0.75 from colour
 * agreement and recency is barely worth showing. Each is therefore read against
 * its own threshold rather than against a single shared number that would
 * flatter one and undersell the other.
 */
export function describeProposal(candidate: EntityMatchCandidate): string {
  const strong = candidate.basis.includes('face')
    ? candidate.similarity >= FACE_STRONG_SIMILARITY
    : candidate.similarity >= STRONG_PROPOSAL_SIMILARITY;
  return strong ? `Likely ${candidate.entityLabel}` : `Possible ${candidate.entityLabel}`;
}

export const BASIS_LABEL: Record<MatchBasis, string> = {
  class: 'Same class',
  appearance: 'Appearance agreement',
  face: 'Face match',
  'temporal-proximity': 'Seen recently',
  'spatial-proximity': 'Same location',
  'user-confirmed': 'Previously confirmed',
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
