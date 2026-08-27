import { describe, expect, it } from 'vitest';
import type { FaceEmbeddingRecord } from '@/types/domain';
import {
  decodeDescriptor,
  encodeDescriptor,
  faceEmbeddingToRow,
  rowToFaceEmbedding,
} from '@/lib/sync/mappers';
import type { Tables } from '@/types/supabase';

const T = 1_800_000_000_000;

describe('descriptor encoding', () => {
  it('round-trips every value exactly', () => {
    // Exactness is the whole reason this is base64 and not a JSON number
    // array: a descriptor that drifts in its low bits on each sync would move
    // similarity scores for no observable reason.
    const original = new Float32Array(1024);
    for (let i = 0; i < original.length; i += 1) {
      original[i] = Math.sin(i) * 0.37;
    }

    const restored = decodeDescriptor(encodeDescriptor(original));
    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i += 1) {
      expect(restored[i]).toBe(original[i]);
    }
  });

  it('preserves negative, zero and subnormal values', () => {
    const original = Float32Array.from([0, -0.5, 1e-38, -1e-38, 3.4e38, -3.4e38]);
    expect([...decodeDescriptor(encodeDescriptor(original))]).toEqual([...original]);
  });

  it('is materially smaller than a JSON number array', () => {
    const descriptor = new Float32Array(1024).map((_, i) => Math.cos(i) * 0.5);
    const encoded = encodeDescriptor(descriptor);
    expect(encoded.length).toBeLessThan(JSON.stringify([...descriptor]).length / 2);
  });

  it('produces the documented 1024-float payload size', () => {
    // 1024 floats -> 4096 bytes -> ceil(4096/3)*4 = 5464 base64 characters.
    expect(encodeDescriptor(new Float32Array(1024)).length).toBe(5464);
  });
});

describe('face embedding mapping', () => {
  const record: FaceEmbeddingRecord = {
    id: 'emb_1',
    entityId: 'ent_1',
    sightingId: 'sig_1',
    descriptor: Float32Array.from({ length: 8 }, (_, i) => i / 10),
    score: 0.91,
    model: 'human/faceres-1024',
    createdAt: T,
  };

  it('maps to a row with dimensions derived from the descriptor', () => {
    const row = faceEmbeddingToRow(record, 'user_1');
    expect(row.user_id).toBe('user_1');
    expect(row.entity_id).toBe('ent_1');
    expect(row.dimensions).toBe(8);
    expect(row.model).toBe('human/faceres-1024');
    expect(row.created_at).toBe(new Date(T).toISOString());
  });

  it('round-trips through a row without losing the descriptor', () => {
    const row = faceEmbeddingToRow(record, 'user_1');
    const restored = rowToFaceEmbedding({
      ...row,
      id: 'emb_1',
      sighting_id: row.sighting_id ?? null,
      created_at: row.created_at!,
      updated_at: row.created_at!,
    } as Tables<'face_embeddings'>);

    expect(restored.id).toBe(record.id);
    expect(restored.entityId).toBe(record.entityId);
    expect(restored.sightingId).toBe(record.sightingId);
    expect(restored.createdAt).toBe(record.createdAt);
    expect([...restored.descriptor]).toEqual([...record.descriptor]);
  });

  it('maps an absent sighting to null and back to undefined', () => {
    const { sightingId: _omitted, ...rest } = record;
    const row = faceEmbeddingToRow(rest as FaceEmbeddingRecord, 'user_1');
    expect(row.sighting_id).toBeNull();

    const restored = rowToFaceEmbedding({
      ...row,
      id: 'emb_1',
      sighting_id: null,
      created_at: row.created_at!,
      updated_at: row.created_at!,
    } as Tables<'face_embeddings'>);
    expect(restored.sightingId).toBeUndefined();
  });
});
