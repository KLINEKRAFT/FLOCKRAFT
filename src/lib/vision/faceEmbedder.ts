import type { Human } from '@vladmandic/human';
import type { NormalizedBox } from '@/types/domain';

/**
 * FACE EMBEDDER
 * ---------------------------------------------------------------------------
 * Produces a face descriptor — a 1024-float vector — from a person crop, so a
 * subject can be recognised on a later day and in different clothes. Colour and
 * recency, the signals that came before this, cannot do that.
 *
 * This is a biometric identifier. Everything below is written on that basis:
 *
 *   Opt-in       Nothing here loads or runs unless `faceRecognition` is on,
 *                and it is off by default like every other sensitive setting.
 *   Local        Weights are served from this origin, not a CDN. A CDN request
 *                would disclose to a third party that face recognition is
 *                running, which is exactly the kind of leak this product
 *                should not have. Frames never leave the device either way.
 *   Descriptor   Only `global_pooling/Mean` is read. The same model also emits
 *                age and gender heads; they are deliberately ignored. The
 *                product's position is that gender is not visually
 *                determinable, and a model asserting it would be confidently
 *                wrong about real people.
 *   Normalised   Vectors are L2-normalised on the way out, so downstream
 *                comparison is a dot product and every stored vector is
 *                directly comparable to every other.
 *
 * The model pair is BlazeFace (detection) and HSE FaceRes (description) via
 * `@vladmandic/human`, with mesh, iris, emotion, anti-spoof, body and hand all
 * disabled — roughly 7.4 MB of weights against ~30 MB for the full set.
 */

/** L2-normalised face descriptor, 1024 dimensions. */
export type FaceDescriptor = Float32Array;

export const DESCRIPTOR_LENGTH = 1024;

/**
 * Identifies the producing model. Stored on every descriptor so that vectors
 * from a future model can be told apart from these and retired, rather than
 * being compared against them and scoring like noise.
 */
export const FACE_MODEL_ID = 'human/faceres-1024';

export interface FaceEmbedding {
  descriptor: FaceDescriptor;
  /** Detector confidence for the face this came from, 0..1. */
  score: number;
  /** Face box within the source frame, normalised — used for quality checks. */
  box: NormalizedBox;
}

export class FaceEmbedderLoadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'FaceEmbedderLoadError';
  }
}

/**
 * Minimum face pixel width before an embedding is trusted.
 *
 * A face 20 px across produces a descriptor, and that descriptor is noise. It
 * would still match *something* with a plausible-looking score, which is worse
 * than returning nothing: a confident wrong identity is the failure mode this
 * whole product is built to avoid.
 */
export const MIN_FACE_PIXELS = 64;

/**
 * Minimum detector confidence for the face itself.
 *
 * Raised from 0.6 after a real session showed what 0.6 admits. Two subjects
 * cleared it at 0.61 and 0.67, and their descriptors matched nothing —
 * topping out at 0.36 against every other signature in the set, including
 * each other. Every signature above 0.86 in the same session clustered
 * sensibly, and one pair of repeat sightings of the same person scored 0.903.
 *
 * A marginal crop does not produce a weak identity, it produces noise stored
 * as identity: a vector that will never match the person it came from, and
 * might one day match someone else. Refusing it costs a signature that was
 * worthless anyway.
 */
export const MIN_FACE_SCORE = 0.75;

/**
 * Score at which a descriptor is good enough to stop looking for a better one.
 * Above this the marginal gain is not worth another inference.
 */
export const GOOD_FACE_SCORE = 0.9;

/** Shortest gap between capture attempts within one observation. */
export const FACE_RETRY_INTERVAL_MS = 1500;

/** Attempts per observation, so a subject who lingers cannot run inference forever. */
export const MAX_FACE_ATTEMPTS = 8;

/** What one open observation has managed to capture so far. */
export interface FaceCaptureState {
  /** Detector score of the best descriptor captured; 0 when none. */
  bestScore: number;
  attempts: number;
  lastAttemptAt: number;
}

export const INITIAL_FACE_CAPTURE: FaceCaptureState = {
  bestScore: 0,
  attempts: 0,
  lastAttemptAt: 0,
};

/**
 * Whether an open observation should try again for a face.
 *
 * The embedder used to run exactly once, at promotion. A real session showed
 * the cost of that: the two longest looks of the session — 45.8 and 28.2
 * seconds — produced no signature at all, because the one instant we checked
 * happened to catch them turned away. Somebody standing in frame for
 * three-quarters of a minute deserves more than one glance.
 *
 * Retrying is bounded on three axes so it cannot become the loop's problem:
 * stop once the capture is good, wait between attempts, and cap the total.
 */
export function shouldAttemptFace(state: FaceCaptureState, now: number): boolean {
  if (state.bestScore >= GOOD_FACE_SCORE) return false;
  if (state.attempts >= MAX_FACE_ATTEMPTS) return false;
  return now - state.lastAttemptAt >= FACE_RETRY_INTERVAL_MS;
}

/**
 * Picks which of several open observations gets this tick's attempt.
 *
 * One attempt per tick regardless of how many people are in frame: inference
 * cost is per-face, and a busy doorway would otherwise multiply it by the
 * crowd. Subjects with nothing captured come first, then whoever has waited
 * longest — so the queue drains rather than one subject monopolising it.
 */
export function pickFaceAttempt<T>(
  candidates: Array<{ key: T; state: FaceCaptureState }>,
  now: number,
): T | null {
  const eligible = candidates.filter((entry) => shouldAttemptFace(entry.state, now));
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    const aHas = a.state.bestScore > 0 ? 1 : 0;
    const bHas = b.state.bestScore > 0 ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas;
    return a.state.lastAttemptAt - b.state.lastAttemptAt;
  });
  return eligible[0]!.key;
}

let human: Human | null = null;
let loading: Promise<Human> | null = null;

/** True once the models are resident and usable. */
export function isFaceEmbedderLoaded(): boolean {
  return human !== null;
}

/**
 * Loads the face models. Idempotent, and collapses concurrent callers onto one
 * in-flight promise the way the detector registry does.
 */
export async function loadFaceEmbedder(
  onProgress?: (fraction: number) => void,
): Promise<Human> {
  if (human) return human;
  if (loading) return loading;

  loading = (async () => {
    try {
      onProgress?.(0.05);
      // Resolves to the browser ESM build via the alias in `next.config.ts`.
      // That build bundles its own TensorFlow.js rather than sharing the copy
      // COCO-SSD uses — an acceptable cost given it is fetched only when face
      // recognition is on, and small next to the 7.4 MB of weights with it.
      const { Human } = await import('@vladmandic/human');
      onProgress?.(0.3);

      const instance = new Human({
        // Same-origin weights. See the note above on why this is not a CDN.
        modelBasePath: '/models/human/',
        backend: 'webgl',
        // Human's own warm-up runs the full enabled pipeline; we do our own
        // below against a real-sized canvas instead.
        warmup: 'none',
        cacheSensitivity: 0,
        face: {
          enabled: true,
          // `return: false` is load-bearing, not a default left alone. Setting
          // it true hands back the cropped face tensor and makes the caller
          // responsible for freeing it — Human's own documentation says it
          // "must be manually deallocated to avoid memory leak". Nothing here
          // reads that tensor, and leaving it enabled leaked one tensor and
          // roughly 0.75 MB per observation: invisible in a short test, fatal
          // over a day of watching a door.
          detector: { enabled: true, rotation: false, maxDetected: 1, return: false },
          // Mesh off: the detector crop is what FaceRes consumes, and the mesh
          // is 1.5 MB of weights for landmarks nothing here reads.
          mesh: { enabled: false },
          iris: { enabled: false },
          emotion: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false },
          description: { enabled: true },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        gesture: { enabled: false },
        segmentation: { enabled: false },
        filter: { enabled: false },
      });

      await instance.load();
      onProgress?.(0.85);

      // Compile shaders before the first real crop, so the observation that
      // triggers the first embedding is not the one that stalls.
      const warm = document.createElement('canvas');
      warm.width = 256;
      warm.height = 256;
      await instance.detect(warm);
      onProgress?.(1);

      human = instance;
      return instance;
    } catch (error) {
      loading = null;
      throw new FaceEmbedderLoadError(
        'Face recognition models failed to load. Check the connection and retry.',
        error,
      );
    }
  })();

  return loading;
}

/**
 * Extracts a descriptor for the largest face inside `box`.
 *
 * Returns null — rather than a low-confidence guess — whenever the face is
 * absent, too small, or below the detector's confidence floor. Callers treat a
 * null as "no face signal available", never as "no match".
 */
export async function embedFace(
  source: HTMLVideoElement | HTMLCanvasElement,
  box: NormalizedBox,
): Promise<FaceEmbedding | null> {
  if (!human) return null;

  // Crop the person first. Running the face detector on the whole frame would
  // find every face in it, and there is no reliable way to attribute one of
  // those back to the track being promoted.
  const crop = cropToCanvas(source, box);
  if (!crop) return null;

  try {
    const result = await human.detect(crop);
    const face = result.face
      .filter((candidate) => candidate.score >= MIN_FACE_SCORE)
      .sort((a, b) => area(b.box) - area(a.box))[0];

    if (!face?.embedding || face.embedding.length !== DESCRIPTOR_LENGTH) return null;

    const [, , faceWidth, faceHeight] = face.box;
    if (Math.min(faceWidth, faceHeight) < MIN_FACE_PIXELS) return null;

    return {
      descriptor: l2Normalise(Float32Array.from(face.embedding)),
      score: face.score,
      box: {
        // Face box is relative to the crop; re-express it in frame coordinates
        // so a caller can reason about it alongside the person box.
        x: box.x + (face.box[0] / crop.width) * box.width,
        y: box.y + (face.box[1] / crop.height) * box.height,
        width: (faceWidth / crop.width) * box.width,
        height: (faceHeight / crop.height) * box.height,
      },
    };
  } catch {
    // An inference failure must never abort the observation being recorded.
    return null;
  }
}

/** Frees GPU memory. Called when face recognition is switched off. */
export function disposeFaceEmbedder(): void {
  human = null;
  loading = null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const area = (box: [number, number, number, number]) => box[2] * box[3];

/**
 * Unit length, so cosine similarity is a plain dot product.
 *
 * A zero vector cannot be normalised; it is returned unchanged and will score
 * zero against everything, which is the correct outcome for a degenerate
 * reading.
 */
export function l2Normalise(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) return vector;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i]! / norm;
  return out;
}

/** Extracts the person region at native resolution, padded slightly upward. */
function cropToCanvas(
  source: HTMLVideoElement | HTMLCanvasElement,
  box: NormalizedBox,
): HTMLCanvasElement | null {
  const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!sourceWidth || !sourceHeight) return null;

  // Heads sit at the top of a person box, and a tight box often clips the
  // crown. Padding upward costs nothing and recovers those detections.
  const padX = box.width * 0.08;
  const padY = box.height * 0.06;
  const sx = Math.max(0, (box.x - padX) * sourceWidth);
  const sy = Math.max(0, (box.y - padY * 2) * sourceHeight);
  const sw = Math.min(sourceWidth - sx, (box.width + padX * 2) * sourceWidth);
  const sh = Math.min(sourceHeight - sy, (box.height + padY * 3) * sourceHeight);
  if (sw < 16 || sh < 16) return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}
