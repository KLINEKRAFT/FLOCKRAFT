import type { Detector } from './detector';
import { CocoSsdDetector } from './cocoSsdDetector';
import { SimulatedDetector } from './simulatedDetector';

/**
 * DETECTOR REGISTRY
 * ---------------------------------------------------------------------------
 * Single point at which detection backends are registered. Adding an ONNX
 * Runtime Web or WebGPU adapter later means implementing `Detector` and adding
 * one line here — nothing else in the application changes.
 *
 * Instances are memoised because model weights are expensive: switching away
 * from a detector and back must not re-download several megabytes.
 */
const factories: Record<string, () => Detector> = {
  'coco-ssd': () => new CocoSsdDetector(),
  simulated: () => new SimulatedDetector(),
};

const instances = new Map<string, Detector>();

export function getDetector(id: string): Detector {
  const existing = instances.get(id);
  if (existing) return existing;

  const factory = factories[id] ?? factories['simulated']!;
  const detector = factory();
  instances.set(detector.id, detector);
  return detector;
}

/** Metadata for every registered detector, for the settings sheet. */
export function listDetectors(): Array<Pick<Detector, 'id' | 'displayName' | 'description' | 'approxSizeMb'>> {
  return Object.keys(factories).map((id) => {
    const detector = getDetector(id);
    return {
      id: detector.id,
      displayName: detector.displayName,
      description: detector.description,
      approxSizeMb: detector.approxSizeMb,
    };
  });
}

/** Releases every instantiated detector. Called when the session tears down. */
export function disposeAllDetectors(): void {
  for (const detector of instances.values()) detector.dispose();
  instances.clear();
}
