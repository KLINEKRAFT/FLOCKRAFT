import type { Detection, DetectionClass } from '@/types/domain';

/**
 * DETECTOR CONTRACT
 * ---------------------------------------------------------------------------
 * Every detection backend — TensorFlow.js, ONNX Runtime Web, a WebGPU model, a
 * remote endpoint, or the synthetic generator used for UI work — implements
 * this interface. Nothing above this layer knows which model is running.
 *
 * Implementations must:
 *   - be safe to `load()` more than once (idempotent, single in-flight promise)
 *   - return boxes normalised to 0..1 of the *source frame*
 *   - never throw from `detect()`; return an empty array instead
 *   - release all GPU/WASM resources on `dispose()`
 */
export interface Detector {
  readonly id: string;
  readonly displayName: string;
  /** Short description surfaced in the detection-settings sheet. */
  readonly description: string;
  /** Approximate download size in MB, shown before the user opts in. */
  readonly approxSizeMb: number;
  readonly isLoaded: boolean;

  load(onProgress?: (fraction: number) => void): Promise<void>;
  detect(source: DetectorSource, options: DetectOptions): Promise<Detection[]>;
  dispose(): void;
}

/** Any frame source the browser can hand to a model without a manual copy. */
export type DetectorSource = HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

export interface DetectOptions {
  /** Detections below this score are discarded before they reach the tracker. */
  minScore: number;
  /** Restricts output to these classes; empty means "all supported". */
  enabledClasses: DetectionClass[];
  /** Upper bound on returned detections, highest score first. */
  maxDetections: number;
}

export const DEFAULT_DETECT_OPTIONS: DetectOptions = {
  minScore: 0.55,
  enabledClasses: [],
  maxDetections: 20,
};

/** Raised when a model fails to download or initialise. */
export class DetectorLoadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DetectorLoadError';
  }
}

/** Reads the intrinsic pixel dimensions of any supported frame source. */
export function sourceDimensions(source: DetectorSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  return { width: source.width, height: source.height };
}
