import type {
  CameraDirection,
  Detection,
  DetectionClass,
  NormalizedBox,
  Track,
  TrackId,
} from '@/types/domain';
import { kindForClass } from '@/lib/taxonomy';
import { createId } from '@/lib/id';

/**
 * MULTI-OBJECT TRACKER
 * ---------------------------------------------------------------------------
 * A detector is stateless: it reports what is in *this* frame and nothing more.
 * Without a tracker, a person standing in view for thirty frames produces
 * thirty unrelated detections — and thirty spurious entities.
 *
 * This is a tracking-by-detection associator in the SORT family, simplified for
 * the browser. Per detection tick:
 *
 *   1. PREDICT   advance each track's box by its smoothed velocity, so that
 *                fast subjects are still matched when the gap between detection
 *                frames is large (at 8 FPS that gap is 125 ms — enough for a
 *                walking person to move a meaningful fraction of the frame).
 *   2. SCORE     build a cost matrix over (track, detection) pairs from IoU,
 *                centroid distance, and box-shape similarity. Class mismatches
 *                are rejected outright: a car never becomes a dog.
 *   3. ASSIGN    greedy assignment in descending score order. Greedy rather
 *                than Hungarian: with a realistic upper bound of ~20 tracks the
 *                optimality gain is negligible and the cost is real, and greedy
 *                is far easier to reason about when it misbehaves.
 *   4. UPDATE    matched tracks absorb the detection; velocity is smoothed with
 *                an EMA to reject single-frame jitter.
 *   5. AGE       unmatched tracks accumulate misses and are evicted past a
 *                grace period, which lets a track survive brief occlusion
 *                (someone walking behind a pole) without fragmenting.
 *
 * Deliberately *not* modelled: appearance embeddings. A re-identification
 * embedding is the correct long-term answer for occlusion recovery, but it is a
 * second model to download and a second inference per crop per frame. The
 * architecture leaves room for it — `Track` already carries the fields an
 * embedding-based matcher would populate — but shipping one is a later
 * milestone, not a milestone-two obligation.
 */

export interface TrackerConfig {
  /** Minimum combined association score for a track/detection pair to match. */
  matchThreshold: number;
  /** Frames a track may go unmatched before eviction. */
  maxMissedFrames: number;
  /** Hits required before a track is considered confirmed and drawn. */
  minHitsToConfirm: number;
  /** EMA factor for velocity smoothing; higher reacts faster, noisier. */
  velocitySmoothing: number;
  /** Centroid speed below which a subject is reported as static. */
  staticSpeedThreshold: number;
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  matchThreshold: 0.28,
  maxMissedFrames: 12,
  minHitsToConfirm: 2,
  velocitySmoothing: 0.35,
  staticSpeedThreshold: 0.015,
};

export interface TrackerUpdate {
  /** All confirmed, currently-live tracks. */
  tracks: Track[];
  /** Tracks created on this tick. */
  created: Track[];
  /** Tracks evicted on this tick, carrying their final state. */
  ended: Track[];
}

export class ObjectTracker {
  #tracks = new Map<TrackId, Track>();
  #config: TrackerConfig;
  #lastTickAt = 0;
  /** Per-class running ordinal, producing `PERSON TEMP-04` style labels. */
  #tempOrdinals = new Map<DetectionClass, number>();

  constructor(config: Partial<TrackerConfig> = {}) {
    this.#config = { ...DEFAULT_TRACKER_CONFIG, ...config };
  }

  get tracks(): Track[] {
    return [...this.#tracks.values()];
  }

  reset(): void {
    this.#tracks.clear();
    this.#tempOrdinals.clear();
    this.#lastTickAt = 0;
  }

  /** Applies one frame of detections and returns the resulting track deltas. */
  update(detections: Detection[], now: number = Date.now()): TrackerUpdate {
    // Guard against a zero or absurd delta on the first tick and after a tab
    // has been backgrounded — a huge dt would fling every prediction offscreen.
    const dtSeconds =
      this.#lastTickAt === 0 ? 0 : Math.min(1, Math.max(0, (now - this.#lastTickAt) / 1000));
    this.#lastTickAt = now;

    const created: Track[] = [];
    const ended: Track[] = [];

    // ---- 1. PREDICT -------------------------------------------------------
    const predictions = new Map<TrackId, NormalizedBox>();
    for (const track of this.#tracks.values()) {
      predictions.set(track.id, predictBox(track.box, track.velocity, dtSeconds));
    }

    // ---- 2. SCORE ---------------------------------------------------------
    const candidates: Array<{ trackId: TrackId; detectionIndex: number; score: number }> = [];
    for (const track of this.#tracks.values()) {
      const predicted = predictions.get(track.id) ?? track.box;
      detections.forEach((detection, index) => {
        // Hard class gate. Cross-class association produces nonsense entities
        // and is never worth the recall it buys.
        if (detection.class !== track.class) return;
        const score = associationScore(predicted, detection.box);
        if (score >= this.#config.matchThreshold) {
          candidates.push({ trackId: track.id, detectionIndex: index, score });
        }
      });
    }

    // ---- 3. ASSIGN --------------------------------------------------------
    candidates.sort((a, b) => b.score - a.score);
    const claimedTracks = new Set<TrackId>();
    const claimedDetections = new Set<number>();
    const assignments = new Map<TrackId, number>();

    for (const candidate of candidates) {
      if (claimedTracks.has(candidate.trackId)) continue;
      if (claimedDetections.has(candidate.detectionIndex)) continue;
      claimedTracks.add(candidate.trackId);
      claimedDetections.add(candidate.detectionIndex);
      assignments.set(candidate.trackId, candidate.detectionIndex);
    }

    // ---- 4. UPDATE MATCHED ------------------------------------------------
    for (const [trackId, detectionIndex] of assignments) {
      const track = this.#tracks.get(trackId);
      const detection = detections[detectionIndex];
      if (!track || !detection) continue;

      const previousCentroid = centroid(track.box);
      const nextCentroid = centroid(detection.box);

      // Smooth velocity with an EMA. dt can be 0 on the very first matched
      // frame; in that case retain the previous estimate rather than dividing.
      const instantaneous =
        dtSeconds > 0
          ? {
              x: (nextCentroid.x - previousCentroid.x) / dtSeconds,
              y: (nextCentroid.y - previousCentroid.y) / dtSeconds,
            }
          : track.velocity;

      const alpha = this.#config.velocitySmoothing;
      const velocity = {
        x: track.velocity.x * (1 - alpha) + instantaneous.x * alpha,
        y: track.velocity.y * (1 - alpha) + instantaneous.y * alpha,
      };

      // Growth in apparent area is the only depth cue available from a single
      // uncalibrated camera. It is reported as toward/away, never as distance.
      const areaRatio = area(detection.box) / Math.max(area(track.box), 1e-6);

      track.box = detection.box;
      track.score = detection.score;
      track.peakScore = Math.max(track.peakScore, detection.score);
      track.lastSeenAt = now;
      track.hits += 1;
      track.missedFrames = 0;
      track.velocity = velocity;
      track.direction = inferDirection(velocity, areaRatio, this.#config.staticSpeedThreshold);
    }

    // ---- 5. AGE UNMATCHED -------------------------------------------------
    for (const track of [...this.#tracks.values()]) {
      if (assignments.has(track.id)) continue;
      track.missedFrames += 1;
      // Coast the box forward while occluded so the overlay does not freeze in
      // place, but stop accumulating hits.
      track.box = predictions.get(track.id) ?? track.box;
      if (track.missedFrames > this.#config.maxMissedFrames) {
        this.#tracks.delete(track.id);
        ended.push(track);
      }
    }

    // ---- 6. SPAWN NEW -----------------------------------------------------
    detections.forEach((detection, index) => {
      if (claimedDetections.has(index)) return;
      const track = this.#createTrack(detection, now);
      this.#tracks.set(track.id, track);
      created.push(track);
    });

    return {
      tracks: this.tracks.filter((t) => t.hits >= this.#config.minHitsToConfirm),
      created,
      ended,
    };
  }

  /** Ends every live track — used when the session stops or the camera closes. */
  flush(): Track[] {
    const remaining = this.tracks;
    this.#tracks.clear();
    return remaining;
  }

  #createTrack(detection: Detection, now: number): Track {
    const ordinal = (this.#tempOrdinals.get(detection.class) ?? 0) + 1;
    this.#tempOrdinals.set(detection.class, ordinal);

    return {
      id: createId('trk'),
      label: `${detection.class.toUpperCase()} TEMP-${String(ordinal).padStart(2, '0')}`,
      class: detection.class,
      kind: kindForClass(detection.class),
      box: detection.box,
      score: detection.score,
      peakScore: detection.score,
      firstSeenAt: now,
      lastSeenAt: now,
      hits: 1,
      missedFrames: 0,
      velocity: { x: 0, y: 0 },
      direction: 'static',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

export function centroid(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function area(box: NormalizedBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

/** Intersection over union. 0 when the boxes are disjoint. */
export function iou(a: NormalizedBox, b: NormalizedBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const overlap = (right - left) * (bottom - top);
  const union = area(a) + area(b) - overlap;
  return union > 0 ? overlap / union : 0;
}

/**
 * Combined association score in 0..1.
 *
 * IoU alone fails for small, fast subjects: a distant person moving between two
 * detection frames can have exactly zero overlap with the prediction while
 * still obviously being the same subject. Centroid proximity recovers those
 * cases, and shape similarity suppresses the mismatches that proximity alone
 * would let through (a person and a nearby car have close centroids but very
 * different aspect ratios).
 *
 * Weights are tuned for a 5-15 FPS detection cadence at typical framing.
 */
export function associationScore(predicted: NormalizedBox, detected: NormalizedBox): number {
  const overlap = iou(predicted, detected);

  const pc = centroid(predicted);
  const dc = centroid(detected);
  const distance = Math.hypot(pc.x - dc.x, pc.y - dc.y);
  // Normalise against the predicted box's diagonal: displacement that is small
  // relative to the subject counts as proximate regardless of absolute scale.
  const diagonal = Math.max(Math.hypot(predicted.width, predicted.height), 0.05);
  const proximity = Math.max(0, 1 - distance / (diagonal * 2));

  const widthRatio = ratio(predicted.width, detected.width);
  const heightRatio = ratio(predicted.height, detected.height);
  const shape = widthRatio * heightRatio;

  return overlap * 0.5 + proximity * 0.35 + shape * 0.15;
}

const ratio = (a: number, b: number) => {
  const max = Math.max(a, b);
  return max > 0 ? Math.min(a, b) / max : 0;
};

function predictBox(box: NormalizedBox, velocity: { x: number; y: number }, dt: number) {
  return {
    x: box.x + velocity.x * dt,
    y: box.y + velocity.y * dt,
    width: box.width,
    height: box.height,
  };
}

/**
 * Direction of travel *in camera space*. This is explicitly not geographic
 * movement — a subject standing still while the operator pans reads as motion.
 * The interface labels this as camera-frame movement wherever it is shown.
 */
export function inferDirection(
  velocity: { x: number; y: number },
  areaRatio: number,
  staticThreshold: number,
): CameraDirection {
  // Depth change dominates when apparent size is changing sharply.
  if (areaRatio > 1.06) return 'toward';
  if (areaRatio < 0.94) return 'away';

  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed < staticThreshold) return 'static';
  if (Math.abs(velocity.x) >= Math.abs(velocity.y)) {
    return velocity.x > 0 ? 'right' : 'left';
  }
  return velocity.y > 0 ? 'down' : 'up';
}

export const DIRECTION_LABEL: Record<CameraDirection, string> = {
  left: 'LEFT',
  right: 'RIGHT',
  up: 'UP',
  down: 'DOWN',
  toward: 'APPROACHING',
  away: 'RECEDING',
  static: 'STATIC',
};
