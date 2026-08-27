import type { DetectionClass } from '@/types/domain';
import { DEFAULT_ENABLED_CLASSES } from '@/lib/taxonomy';

/**
 * PRIVACY & CAPTURE SETTINGS
 * ---------------------------------------------------------------------------
 * Defaults are deliberately conservative. Nothing that could constitute
 * biometric identification, location retention or media retention beyond a
 * thumbnail is enabled without an explicit user action.
 */
export interface FlockraftSettings {
  /** Persist observations at all. When false the app is a live viewer only. */
  saveObservations: boolean;
  /** Persist representative thumbnails alongside sightings. */
  saveImages: boolean;
  /**
   * Thumbnail edge length in pixels.
   *
   * Cropped from the full-resolution camera frame, so this is real detail
   * rather than upscaling — but it is also the single biggest driver of how
   * much storage a day of observation consumes, and of how much a sync
   * uploads. Roughly 4-8 KB at 160, 15-25 KB at 320, 35-55 KB at 512.
   */
  thumbnailSize: number;
  /** Persist short event clips. Off by default — storage and privacy cost. */
  saveClips: boolean;
  /** Attach a geographic fix to sightings. Requires geolocation permission. */
  saveLocation: boolean;
  /** Run face detection (bounding boxes / landmarks only). */
  faceAnalysis: boolean;
  /**
   * Propose entity matches automatically. Even when enabled, a match is only
   * ever *proposed* — binding a sighting to an existing entity requires
   * explicit user confirmation.
   */
  autoEntityMatching: boolean;

  /** Target detector invocations per second. The preview stays at display rate. */
  detectionFps: number;
  /** Minimum detector score for a detection to enter the tracker. */
  confidenceThreshold: number;
  /** Continuous visibility required before a track becomes an observation. */
  observationThresholdMs: number;
  enabledClasses: DetectionClass[];
  /** Detector adapter id — see `lib/vision/registry.ts`. */
  detectorId: string;
  /** Halve inference rate and skip attribute analysis on constrained devices. */
  lowPerformanceMode: boolean;
  /** Render detection overlays. */
  showOverlays: boolean;
  /** Render the camera-space motion trail behind each track. */
  showTrails: boolean;
}

export const DEFAULT_SETTINGS: FlockraftSettings = {
  saveObservations: true,
  saveImages: true,
  // 160 was too small to recognise a person later, which is the entire point of
  // keeping the image. 320 costs a few KB more and is legible.
  thumbnailSize: 320,
  saveClips: false,
  saveLocation: false,
  faceAnalysis: false,
  autoEntityMatching: false,

  detectionFps: 8,
  confidenceThreshold: 0.55,
  observationThresholdMs: 1500,
  enabledClasses: DEFAULT_ENABLED_CLASSES,
  detectorId: 'coco-ssd',
  lowPerformanceMode: false,
  showOverlays: true,
  showTrails: true,
};

const STORAGE_KEY = 'flockraft.settings.v1';

/**
 * Reads settings from localStorage, merging over defaults so that a settings
 * object written by an older build never yields `undefined` fields.
 */
export function loadSettings(): FlockraftSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<FlockraftSettings>;
    return sanitize({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: FlockraftSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota exceeded or storage disabled — settings simply do not persist.
  }
}

/** Clamps numeric settings into ranges the pipeline can actually honour. */
function sanitize(settings: FlockraftSettings): FlockraftSettings {
  return {
    ...settings,
    detectionFps: clamp(settings.detectionFps, 1, 15),
    confidenceThreshold: clamp(settings.confidenceThreshold, 0.2, 0.95),
    observationThresholdMs: clamp(settings.observationThresholdMs, 300, 10_000),
    // Snap to the offered sizes: an arbitrary value from an older build or a
    // hand-edited store would silently change storage cost per observation.
    thumbnailSize: THUMBNAIL_SIZES.includes(settings.thumbnailSize) ? settings.thumbnailSize : 320,
    enabledClasses: settings.enabledClasses?.length
      ? settings.enabledClasses
      : DEFAULT_ENABLED_CLASSES,
  };
}

/** Offered thumbnail sizes, smallest first. */
export const THUMBNAIL_SIZES: number[] = [160, 320, 512];

export const THUMBNAIL_SIZE_LABEL: Record<number, string> = {
  160: 'Standard',
  320: 'High',
  512: 'Maximum',
};

/** Rough encoded size per thumbnail, for the storage-cost hint in settings. */
export const THUMBNAIL_SIZE_BYTES: Record<number, string> = {
  160: '~6 KB',
  320: '~20 KB',
  512: '~45 KB',
};

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
