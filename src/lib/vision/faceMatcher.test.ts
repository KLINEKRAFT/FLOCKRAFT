import { describe, expect, it } from 'vitest';
import type { FaceEmbeddingRecord } from '@/types/domain';
import {
  cosineSimilarity,
  matchFace,
  pruneGallery,
  describeFaceMatch,
  FACE_MATCH_SIMILARITY,
  FACE_STRONG_SIMILARITY,
  GALLERY_SIZE,
} from '@/lib/vision/faceMatcher';
import { DESCRIPTOR_LENGTH, l2Normalise } from '@/lib/vision/faceEmbedder';

/** A deterministic unit vector; `seed` controls its direction. */
function vector(seed: number, length = DESCRIPTOR_LENGTH): Float32Array {
  const out = new Float32Array(length);
  let state = seed * 2654435761;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = state / 0xffffffff - 0.5;
  }
  return l2Normalise(out);
}

/** Interpolates toward `target`, so similarity can be dialled precisely. */
function nudge(base: Float32Array, target: Float32Array, weight: number): Float32Array {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 1) {
    out[i] = base[i]! * (1 - weight) + target[i]! * weight;
  }
  return l2Normalise(out);
}

function record(
  entityId: string,
  descriptor: Float32Array,
  overrides: Partial<FaceEmbeddingRecord> = {},
): FaceEmbeddingRecord {
  return {
    id: `emb_${entityId}_${Math.round(descriptor[0]! * 1e6)}`,
    entityId,
    descriptor,
    score: 0.9,
    model: 'human/faceres-1024',
    createdAt: 1_800_000_000_000,
    ...overrides,
  };
}

describe('cosineSimilarity', () => {
  it('is 1 for a vector against itself', () => {
    const v = vector(1);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it('is near 0 for independent random vectors', () => {
    // Two unrelated 1024-d unit vectors are close to orthogonal.
    expect(cosineSimilarity(vector(1), vector(2))).toBeLessThan(0.2);
  });

  it('never returns a negative similarity', () => {
    const v = vector(3);
    const opposite = v.map((value) => -value) as Float32Array;
    expect(cosineSimilarity(v, opposite)).toBe(0);
  });

  it('returns 0 rather than throwing on a length mismatch', () => {
    // A descriptor from a different model must degrade, not crash.
    expect(cosineSimilarity(vector(1, 128), vector(1, 1024))).toBe(0);
  });
});

describe('matchFace', () => {
  it('finds the entity whose descriptor is closest', () => {
    const target = vector(10);
    const stored = [
      record('ent_a', vector(11)),
      record('ent_b', nudge(vector(12), target, 0.97)),
      record('ent_c', vector(13)),
    ];

    const match = matchFace(target, stored);
    expect(match?.entityId).toBe('ent_b');
    expect(match!.similarity).toBeGreaterThan(FACE_MATCH_SIMILARITY);
  });

  it('returns null when nothing clears the threshold', () => {
    // The important direction: an unknown face must produce no proposal at all.
    const stored = [record('ent_a', vector(21)), record('ent_b', vector(22))];
    expect(matchFace(vector(20), stored)).toBeNull();
  });

  it('returns null against an empty gallery', () => {
    expect(matchFace(vector(1), [])).toBeNull();
  });

  it('scores an entity by its best descriptor, not its average', () => {
    const target = vector(30);
    const stored = [
      record('ent_a', vector(31)),
      record('ent_a', vector(32)),
      record('ent_a', nudge(vector(33), target, 0.98)),
    ];

    const match = matchFace(target, stored);
    expect(match?.entityId).toBe('ent_a');
    expect(match?.gallerySize).toBe(3);
    expect(match!.similarity).toBeGreaterThan(0.9);
  });

  it('never proposes an entity that is currently in frame elsewhere', () => {
    // Two tracks at once are two people, whatever the vectors say.
    const target = vector(40);
    const stored = [record('ent_open', nudge(vector(41), target, 0.99))];
    expect(matchFace(target, stored, { exclude: new Set(['ent_open']) })).toBeNull();
  });

  it('rejects a descriptor of the wrong dimensionality', () => {
    const stored = [record('ent_a', vector(50))];
    expect(matchFace(vector(50, 512), stored)).toBeNull();
  });

  it('honours a caller-supplied threshold', () => {
    const target = vector(60);
    const stored = [record('ent_a', nudge(vector(61), target, 0.75))];
    expect(matchFace(target, stored, { threshold: 0.99 })).toBeNull();
    expect(matchFace(target, stored, { threshold: 0.1 })?.entityId).toBe('ent_a');
  });
});

describe('pruneGallery', () => {
  it('leaves a gallery that is already within bounds untouched', () => {
    const gallery = [record('ent_a', vector(70)), record('ent_a', vector(71))];
    expect(pruneGallery(gallery)).toHaveLength(2);
  });

  it('trims to the limit', () => {
    const gallery = Array.from({ length: 10 }, (_, i) => record('ent_a', vector(80 + i)));
    expect(pruneGallery(gallery)).toHaveLength(GALLERY_SIZE);
  });

  it('drops the most redundant member, keeping diversity', () => {
    // Three near-duplicates and two distinct views: pruning to 3 must not throw
    // away both distinct views to keep near-identical copies.
    const base = vector(90);
    const gallery = [
      record('ent_a', base),
      record('ent_a', nudge(base, vector(91), 0.02)),
      record('ent_a', nudge(base, vector(92), 0.02)),
      record('ent_a', vector(93)),
      record('ent_a', vector(94)),
    ];

    const kept = pruneGallery(gallery, 3);
    expect(kept).toHaveLength(3);

    // At least one of the two genuinely different views survives.
    const distinctKept = kept.filter(
      (entry) =>
        cosineSimilarity(entry.descriptor, vector(93)) > 0.99 ||
        cosineSimilarity(entry.descriptor, vector(94)) > 0.99,
    );
    expect(distinctKept.length).toBeGreaterThanOrEqual(2);
  });
});

describe('describeFaceMatch', () => {
  it('hedges below the strong threshold', () => {
    expect(describeFaceMatch({ entityId: 'a', similarity: 0.65, gallerySize: 1 })).toBe('Possible');
  });

  it('says likely at or above it, and never says certain', () => {
    const label = describeFaceMatch({
      entityId: 'a',
      similarity: FACE_STRONG_SIMILARITY,
      gallerySize: 4,
    });
    expect(label).toBe('Likely');
  });
});
