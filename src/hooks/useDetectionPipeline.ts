'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoFix, SessionCounts, Track } from '@/types/domain';
import type { FlockraftSettings } from '@/lib/settings';
import { getDetector } from '@/lib/vision/registry';
import { ObjectTracker } from '@/lib/vision/tracker';
import { captureFrame, releaseCaptureResources } from '@/lib/vision/capture';
import { ObservationRecorder, type RecordedObservation } from '@/lib/observationRecorder';
import { getRepository } from '@/lib/store';
import { createId } from '@/lib/id';
import { DetectorLoadError } from '@/lib/vision/detector';

/**
 * DETECTION PIPELINE
 * ---------------------------------------------------------------------------
 *          camera → frame sample → detect → track → record → store
 *
 * Scheduling: the preview element runs at the display refresh rate untouched;
 * only the *inference* loop is throttled. Detection is driven by a
 * self-rescheduling timer rather than `requestAnimationFrame` so that the
 * cadence is decoupled from paint — a slow inference cannot stall compositing,
 * and the loop keeps its target rate rather than free-running.
 *
 * Adaptive backoff: inference latency is tracked as a moving average. When it
 * exceeds the frame budget the interval stretches to match actual capability
 * rather than queueing work the device cannot complete. This is what keeps a
 * thermally-throttled phone responsive instead of progressively locking up.
 *
 * The loop is suspended entirely when the page is hidden, when the user pauses,
 * and when the camera is not active.
 */

export type PipelineStatus =
  | 'idle'
  | 'loading-model'
  | 'running'
  | 'paused'
  | 'model-error';

/** Internal run state. `paused` is derived from it plus `enabled`. */
type RunState = 'idle' | 'loading-model' | 'running' | 'model-error';

export interface PipelineStats {
  /** Achieved detection rate, exponentially smoothed. */
  fps: number;
  /** Moving-average inference latency in milliseconds. */
  inferenceMs: number;
  /** True once backoff has reduced the rate below the configured target. */
  throttled: boolean;
  frames: number;
}

export interface UseDetectionPipelineOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  settings: FlockraftSettings;
  /** Pipeline only runs while this is true (camera active, page visible, …). */
  enabled: boolean;
  location: GeoFix | null;
  onObservation?: (observation: RecordedObservation) => void;
}

export interface UseDetectionPipelineResult {
  status: PipelineStatus;
  tracks: Track[];
  stats: PipelineStats;
  counts: SessionCounts;
  modelProgress: number;
  error: string | null;
  sessionId: string | null;
  retryModel: () => void;
}

const INITIAL_STATS: PipelineStats = { fps: 0, inferenceMs: 0, throttled: false, frames: 0 };
const INITIAL_COUNTS: SessionCounts = {
  person: 0,
  vehicle: 0,
  animal: 0,
  object: 0,
  newEntities: 0,
};

export function useDetectionPipeline({
  videoRef,
  settings,
  enabled,
  location,
  onObservation,
}: UseDetectionPipelineOptions): UseDetectionPipelineResult {
  const [runState, setRunState] = useState<RunState>('idle');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [stats, setStats] = useState<PipelineStats>(INITIAL_STATS);
  const [counts, setCounts] = useState<SessionCounts>(INITIAL_COUNTS);
  const [modelProgress, setModelProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const trackerRef = useRef<ObjectTracker | null>(null);
  const recorderRef = useRef<ObservationRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const latencyRef = useRef(0);
  const lastTickRef = useRef(0);
  const frameCountRef = useRef(0);
  const fpsRef = useRef(0);

  // Settings and callbacks are read through refs so that changing a slider does
  // not tear down and restart the loop mid-session. The refs are assigned after
  // render, never during it — the detection loop is asynchronous and always
  // reads them well after effects have flushed.
  const settingsRef = useRef(settings);
  const locationRef = useRef(location);
  const onObservationRef = useRef(onObservation);
  useEffect(() => {
    settingsRef.current = settings;
    locationRef.current = location;
    onObservationRef.current = onObservation;
  });

  const retryModel = useCallback(() => {
    setError(null);
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    // When disabled the loop simply does not start; the exposed status is
    // derived below, so nothing needs to be written here.
    if (!enabled) return;

    let cancelled = false;
    const detectorId = settingsRef.current.detectorId;
    const detector = getDetector(detectorId);
    const tracker = new ObjectTracker();
    trackerRef.current = tracker;

    const repository = getRepository();
    const newSessionId = createId('ses');

    const recorder = new ObservationRecorder({
      repository,
      sessionId: newSessionId,
      settings: settingsRef.current,
      location: locationRef.current,
    });
    recorderRef.current = recorder;

    /** One detection tick. Returns the delay before the next tick. */
    const tick = async (): Promise<number> => {
      const video = videoRef.current;
      const current = settingsRef.current;

      // Target interval from the configured rate, halved in low-power mode.
      const targetFps = current.lowPerformanceMode
        ? Math.max(2, Math.floor(current.detectionFps / 2))
        : current.detectionFps;
      const budgetMs = 1000 / targetFps;

      if (!video || video.readyState < 2 /* HAVE_CURRENT_DATA */) return budgetMs;

      const startedAt = performance.now();
      const frame = captureFrame(video, current.lowPerformanceMode ? 320 : 480);
      if (!frame) return budgetMs;

      const detections = await detector.detect(frame, {
        minScore: current.confidenceThreshold,
        enabledClasses: current.enabledClasses,
        maxDetections: current.lowPerformanceMode ? 10 : 20,
      });
      if (cancelled) return budgetMs;

      const now = Date.now();
      const update = tracker.update(detections, now);

      // Persist: promote qualifying tracks, close evicted ones.
      recorder.updateContext({ settings: current, location: locationRef.current });
      // Both sources: the detector ran on the downscaled canvas, but
      // thumbnails are cropped from the full-resolution video element.
      await recorder.observe(update.tracks, { inference: frame, video }, now);
      if (update.ended.length > 0) {
        const closed = await recorder.close(update.ended, now);
        for (const observation of closed) onObservationRef.current?.(observation);
      }

      if (cancelled) return budgetMs;
      setTracks(update.tracks);
      setCounts(recorder.counts);

      // ---- Telemetry and adaptive backoff --------------------------------
      const elapsed = performance.now() - startedAt;
      // EMA over inference latency; alpha=0.2 smooths single-frame spikes
      // without lagging a genuine thermal slowdown.
      latencyRef.current = latencyRef.current * 0.8 + elapsed * 0.2;

      const wallDelta = startedAt - lastTickRef.current;
      if (lastTickRef.current > 0 && wallDelta > 0) {
        fpsRef.current = fpsRef.current * 0.8 + (1000 / wallDelta) * 0.2;
      }
      lastTickRef.current = startedAt;
      frameCountRef.current += 1;

      // Only publish telemetry a few times a second — a state update per tick
      // would re-render the overlay far more often than it needs.
      if (frameCountRef.current % 4 === 0) {
        setStats({
          fps: Math.round(fpsRef.current * 10) / 10,
          inferenceMs: Math.round(latencyRef.current),
          throttled: latencyRef.current > budgetMs,
          frames: frameCountRef.current,
        });
      }

      // Never schedule the next tick sooner than the device can finish one.
      // The 1.15 headroom leaves room for paint and GC between inferences.
      return Math.max(budgetMs, latencyRef.current * 1.15) - elapsed;
    };

    const loop = async () => {
      if (cancelled || !runningRef.current) return;
      let delay = 1000 / settingsRef.current.detectionFps;
      try {
        delay = await tick();
      } catch {
        // A single failed tick must not kill the session.
        delay = 500;
      }
      if (cancelled || !runningRef.current) return;
      timerRef.current = setTimeout(() => void loop(), Math.max(16, delay));
    };

    const startPipeline = async () => {
      setRunState('loading-model');
      setModelProgress(0);
      setError(null);

      try {
        await detector.load((fraction) => {
          if (!cancelled) setModelProgress(fraction);
        });
      } catch (cause) {
        if (cancelled) return;
        const message =
          cause instanceof DetectorLoadError
            ? cause.message
            : 'Detection model failed to load.';
        setError(message);
        setRunState('model-error');
        return;
      }
      if (cancelled) return;

      await repository.createSession({
        id: newSessionId,
        startedAt: Date.now(),
        detectorId,
        counts: { ...INITIAL_COUNTS },
        location: locationRef.current ?? undefined,
      });
      if (cancelled) return;

      setSessionId(newSessionId);
      setRunState('running');
      runningRef.current = true;
      lastTickRef.current = 0;
      void loop();
    };

    void startPipeline();

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;

      // Close any observation still open, then stamp the session as ended.
      const closing = recorderRef.current;
      const endedAt = Date.now();
      if (closing) {
        void closing.closeAll(endedAt).then((observations) => {
          for (const observation of observations) onObservationRef.current?.(observation);
          void repository.updateSession(newSessionId, {
            endedAt,
            counts: closing.counts,
          });
        });
      }

      tracker.reset();
      trackerRef.current = null;
      recorderRef.current = null;
      releaseCaptureResources();
      setTracks([]);
    };
    // `settings` beyond `detectorId` is intentionally absent: the loop reads it
    // through a ref, so adjusting a threshold tunes the running session instead
    // of restarting it. Only swapping the detector forces a rebuild.
  }, [enabled, settings.detectorId, videoRef, retryToken]);

  // A paused pipeline is a running one whose loop is suspended — represented
  // as derived state rather than a stored value that could drift out of sync.
  const status: PipelineStatus = enabled
    ? runState
    : runState === 'running'
      ? 'paused'
      : runState;

  return {
    status,
    tracks,
    stats,
    counts,
    modelProgress,
    error,
    sessionId,
    retryModel,
  };
}
