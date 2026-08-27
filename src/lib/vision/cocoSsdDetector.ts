import type { Detection } from '@/types/domain';
import { normalizeClass } from '@/lib/taxonomy';
import {
  DetectorLoadError,
  sourceDimensions,
  type DetectOptions,
  type Detector,
  type DetectorSource,
} from './detector';

/**
 * COCO-SSD (MobileNet v2) detector.
 * ---------------------------------------------------------------------------
 * Chosen for milestone two because it is the best-supported trade-off available
 * in the browser today:
 *
 *   size      ~6 MB of weights, cached by the browser after first load
 *   latency   ~25-60 ms per frame on an A15-class iPhone via WebGL
 *   classes   80 COCO classes, covering every priority class FLOCKRAFT needs
 *   support   WebGL backend works on iOS Safari, where WebGPU is still gated
 *
 * TensorFlow.js is imported dynamically so that ~1 MB of JS never enters the
 * initial bundle — the LIVE screen renders, camera starts, and the shell is
 * fully interactive before the model is even requested.
 *
 * Backend selection: WebGL is preferred over WASM because iOS Safari's WASM
 * SIMD support is inconsistent across versions, and the CPU backend is far too
 * slow for interactive use. We do not request WebGPU yet — as of this build it
 * is behind a flag on iOS and offers no advantage for a model this small.
 */
export class CocoSsdDetector implements Detector {
  readonly id = 'coco-ssd';
  readonly displayName = 'COCO-SSD · MobileNet V2';
  readonly description = '80-class general detector. Balanced accuracy and latency on mobile.';
  readonly approxSizeMb = 6;

  #model: CocoSsdModel | null = null;
  #loading: Promise<void> | null = null;

  get isLoaded(): boolean {
    return this.#model !== null;
  }

  async load(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.#model) return;
    // Collapse concurrent load requests onto a single in-flight promise.
    if (this.#loading) return this.#loading;

    this.#loading = (async () => {
      try {
        onProgress?.(0.05);
        const tf = await import('@tensorflow/tfjs');
        onProgress?.(0.35);

        // WebGL first; fall back to CPU so the app degrades rather than fails.
        try {
          await tf.setBackend('webgl');
        } catch {
          await tf.setBackend('cpu');
        }
        await tf.ready();
        onProgress?.(0.5);

        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        onProgress?.(0.65);

        const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        onProgress?.(0.95);

        // A warm-up pass compiles the WebGL shader programs. Without it the
        // first real frame stalls for several hundred milliseconds mid-preview.
        const warmup = document.createElement('canvas');
        warmup.width = 128;
        warmup.height = 128;
        await model.detect(warmup);

        this.#model = model as unknown as CocoSsdModel;
        onProgress?.(1);
      } catch (error) {
        this.#loading = null;
        throw new DetectorLoadError(
          'Detection model failed to load. Check the network connection and retry.',
          error,
        );
      }
    })();

    return this.#loading;
  }

  async detect(source: DetectorSource, options: DetectOptions): Promise<Detection[]> {
    const model = this.#model;
    if (!model) return [];

    const { width, height } = sourceDimensions(source);
    // A zero-sized source means the video has not produced a frame yet.
    if (width === 0 || height === 0) return [];

    try {
      const raw = await model.detect(source, options.maxDetections, options.minScore);
      const allowed = new Set(options.enabledClasses);

      const detections: Detection[] = [];
      for (const item of raw) {
        if (item.score < options.minScore) continue;
        const cls = normalizeClass(item.class);
        if (cls === 'unknown') continue;
        if (allowed.size > 0 && !allowed.has(cls)) continue;

        const [bx = 0, by = 0, bw = 0, bh = 0] = item.bbox;
        detections.push({
          class: cls,
          score: item.score,
          box: {
            x: clamp01(bx / width),
            y: clamp01(by / height),
            width: clamp01(bw / width),
            height: clamp01(bh / height),
          },
        });
      }

      detections.sort((a, b) => b.score - a.score);
      return detections.slice(0, options.maxDetections);
    } catch {
      // A transient WebGL context loss must not tear down the session; the
      // next tick simply retries.
      return [];
    }
  }

  dispose(): void {
    this.#model?.dispose?.();
    this.#model = null;
    this.#loading = null;
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Minimal structural type for the coco-ssd model, to avoid a type-only import. */
interface CocoSsdModel {
  detect(
    source: DetectorSource,
    maxNumBoxes?: number,
    minScore?: number,
  ): Promise<Array<{ class: string; score: number; bbox: number[] }>>;
  dispose?(): void;
}
