import type { Detection, DetectionClass, NormalizedBox } from '@/types/domain';
import type { DetectOptions, Detector } from './detector';

/**
 * SIMULATED DETECTOR
 * ---------------------------------------------------------------------------
 * Produces plausible, temporally-coherent detections without loading a model.
 * It exists for three real reasons, not as a toy:
 *
 *   1. UI and interaction work can proceed without burning battery on inference.
 *   2. It is the fallback when the real model fails to load, so the LIVE screen
 *      still demonstrates the full pipeline rather than showing a dead frame.
 *   3. It gives QA a deterministic, reproducible stream for regression work on
 *      the tracker and entity matcher.
 *
 * Subjects follow smooth sinusoidal paths and have finite lifetimes, which
 * exercises track creation, continuation, and eviction exactly as real subjects
 * would. It is always clearly labelled as simulated in the interface.
 */
export class SimulatedDetector implements Detector {
  readonly id = 'simulated';
  readonly displayName = 'Simulated Feed';
  readonly description = 'Synthetic detections. No model download, no inference cost.';
  readonly approxSizeMb = 0;
  readonly isLoaded = true;

  #subjects: SyntheticSubject[] = [];
  #startedAt = 0;
  #nextSpawnAt = 0;
  #seed = 0x2f6e2b1;

  async load(onProgress?: (fraction: number) => void): Promise<void> {
    onProgress?.(1);
    this.#startedAt = performance.now();
    this.#subjects = [this.#spawn(0), this.#spawn(1)];
    this.#nextSpawnAt = this.#startedAt + 6_000;
  }

  async detect(_source: unknown, options: DetectOptions): Promise<Detection[]> {
    const now = performance.now();
    const elapsed = now - this.#startedAt;

    // Retire expired subjects and spawn replacements on a slow cadence, so the
    // tracker sees genuine entries and exits rather than a static scene.
    this.#subjects = this.#subjects.filter((s) => elapsed < s.bornAt + s.lifetimeMs);
    if (now >= this.#nextSpawnAt && this.#subjects.length < 5) {
      this.#subjects.push(this.#spawn(elapsed));
      this.#nextSpawnAt = now + 4_000 + this.#random() * 6_000;
    }

    const allowed = new Set(options.enabledClasses);
    const detections: Detection[] = [];

    for (const subject of this.#subjects) {
      if (allowed.size > 0 && !allowed.has(subject.class)) continue;
      const age = (elapsed - subject.bornAt) / 1000;
      const box = subject.trajectory(age);
      // Confidence breathes slightly, as a real model's does frame to frame.
      const score = clamp(subject.baseScore + Math.sin(age * 1.7) * 0.04, 0.4, 0.98);
      if (score < options.minScore) continue;
      detections.push({ class: subject.class, score, box });
    }

    detections.sort((a, b) => b.score - a.score);
    return detections.slice(0, options.maxDetections);
  }

  dispose(): void {
    this.#subjects = [];
  }

  /** Deterministic PRNG (mulberry32) — reproducible sequences for QA. */
  #random(): number {
    this.#seed = (this.#seed + 0x6d2b79f5) | 0;
    let t = this.#seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  #spawn(bornAt: number): SyntheticSubject {
    const palette: Array<{ cls: DetectionClass; w: number; h: number; score: number }> = [
      { cls: 'person', w: 0.16, h: 0.42, score: 0.93 },
      { cls: 'person', w: 0.13, h: 0.36, score: 0.88 },
      { cls: 'car', w: 0.3, h: 0.22, score: 0.95 },
      { cls: 'dog', w: 0.14, h: 0.12, score: 0.86 },
      { cls: 'truck', w: 0.36, h: 0.28, score: 0.91 },
      { cls: 'bicycle', w: 0.18, h: 0.16, score: 0.79 },
    ];
    const pick = palette[Math.floor(this.#random() * palette.length)] ?? palette[0]!;

    const direction = this.#random() > 0.5 ? 1 : -1;
    const speed = 0.03 + this.#random() * 0.05;
    const startX = direction > 0 ? -pick.w : 1;
    const baseY = 0.2 + this.#random() * 0.45;
    const bobAmplitude = 0.01 + this.#random() * 0.02;
    const bobRate = 1.2 + this.#random();

    return {
      class: pick.cls,
      baseScore: pick.score,
      bornAt,
      lifetimeMs: 8_000 + this.#random() * 14_000,
      trajectory: (age) => ({
        x: clamp(startX + direction * speed * age, -pick.w, 1),
        y: clamp(baseY + Math.sin(age * bobRate) * bobAmplitude, 0, 1 - pick.h),
        width: pick.w,
        height: pick.h,
      }),
    };
  }
}

interface SyntheticSubject {
  class: DetectionClass;
  baseScore: number;
  bornAt: number;
  lifetimeMs: number;
  trajectory: (ageSeconds: number) => NormalizedBox;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
