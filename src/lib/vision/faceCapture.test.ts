import { describe, expect, it } from 'vitest';
import {
  shouldAttemptFace,
  pickFaceAttempt,
  FACE_RETRY_INTERVAL_MS,
  GOOD_FACE_SCORE,
  MAX_FACE_ATTEMPTS,
  MIN_FACE_SCORE,
  INITIAL_FACE_CAPTURE,
  type FaceCaptureState,
} from '@/lib/vision/faceEmbedder';

const T = 1_800_000_000_000;
const state = (patch: Partial<FaceCaptureState> = {}): FaceCaptureState => ({
  ...INITIAL_FACE_CAPTURE,
  ...patch,
});

describe('MIN_FACE_SCORE', () => {
  it('excludes the marginal crops that produced unusable descriptors', () => {
    // A real session admitted faces at 0.61 and 0.67, and both matched nothing
    // — 0.36 at best against every other signature, including each other.
    expect(0.61).toBeLessThan(MIN_FACE_SCORE);
    expect(0.67).toBeLessThan(MIN_FACE_SCORE);
    // Everything from that session that clustered sensibly still qualifies.
    for (const good of [0.86, 0.9, 0.94]) expect(good).toBeGreaterThan(MIN_FACE_SCORE);
  });
});

describe('shouldAttemptFace', () => {
  it('attempts when nothing has been captured and the interval has passed', () => {
    expect(shouldAttemptFace(state({ lastAttemptAt: T - FACE_RETRY_INTERVAL_MS }), T)).toBe(true);
  });

  it('waits out the interval between attempts', () => {
    // Otherwise every tick runs an inference and the detection loop starves.
    expect(shouldAttemptFace(state({ lastAttemptAt: T - 200 }), T)).toBe(false);
  });

  it('stops once the capture is good enough', () => {
    const good = state({ bestScore: GOOD_FACE_SCORE, lastAttemptAt: T - 60_000 });
    expect(shouldAttemptFace(good, T)).toBe(false);
  });

  it('keeps trying while the capture is merely acceptable', () => {
    // The floor is what may be stored; it is not what is worth settling for.
    const weak = state({ bestScore: MIN_FACE_SCORE + 0.01, lastAttemptAt: T - 60_000 });
    expect(shouldAttemptFace(weak, T)).toBe(true);
  });

  it('gives up after the attempt cap', () => {
    // A subject who lingers for ten minutes must not run inference forever.
    const spent = state({ attempts: MAX_FACE_ATTEMPTS, lastAttemptAt: T - 60_000 });
    expect(shouldAttemptFace(spent, T)).toBe(false);
  });
});

describe('pickFaceAttempt', () => {
  it('returns nothing when no observation is eligible', () => {
    expect(pickFaceAttempt([{ key: 'a', state: state({ lastAttemptAt: T }) }], T)).toBeNull();
  });

  it('chooses at most one, so a crowd cannot multiply inference cost', () => {
    const waited = { lastAttemptAt: T - 60_000 };
    const picked = pickFaceAttempt(
      [
        { key: 'a', state: state(waited) },
        { key: 'b', state: state(waited) },
        { key: 'c', state: state(waited) },
      ],
      T,
    );
    expect(picked).not.toBeNull();
    expect(['a', 'b', 'c']).toContain(picked);
  });

  it('prioritises a subject with no capture over one with a weak capture', () => {
    const picked = pickFaceAttempt(
      [
        { key: 'has-weak', state: state({ bestScore: 0.8, lastAttemptAt: T - 90_000 }) },
        { key: 'has-none', state: state({ bestScore: 0, lastAttemptAt: T - 60_000 }) },
      ],
      T,
    );
    expect(picked).toBe('has-none');
  });

  it('among equals, takes whoever has waited longest', () => {
    const picked = pickFaceAttempt(
      [
        { key: 'recent', state: state({ lastAttemptAt: T - 2000 }) },
        { key: 'stale', state: state({ lastAttemptAt: T - 90_000 }) },
      ],
      T,
    );
    expect(picked).toBe('stale');
  });

  it('skips the ineligible even when others are waiting', () => {
    const picked = pickFaceAttempt(
      [
        { key: 'done', state: state({ bestScore: GOOD_FACE_SCORE, lastAttemptAt: T - 90_000 }) },
        { key: 'eligible', state: state({ lastAttemptAt: T - 5000 }) },
      ],
      T,
    );
    expect(picked).toBe('eligible');
  });

  it('would have kept looking at the 45-second subject that produced nothing', () => {
    // The case from the field: one look at promotion, none after, no signature
    // despite 45.8s in frame. Attempts are now available across that window.
    let s = state({ attempts: 1, lastAttemptAt: T });
    let attempts = 0;
    for (let elapsed = 0; elapsed <= 45_800; elapsed += 500) {
      if (shouldAttemptFace(s, T + elapsed)) {
        attempts += 1;
        s = { ...s, attempts: s.attempts + 1, lastAttemptAt: T + elapsed };
      }
    }
    expect(attempts).toBeGreaterThanOrEqual(7);
  });
});
