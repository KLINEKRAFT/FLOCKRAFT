'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/cn';

/**
 * CameraStage — the video surface and everything painted on top of it.
 *
 * Measures its own rendered size with a ResizeObserver so the overlay can
 * project detector coordinates correctly. Polling or window-resize listeners
 * are not sufficient: on iOS the element resizes on rotation, on URL-bar
 * collapse, and when the virtual keyboard appears, none of which reliably fire
 * a window resize.
 */
interface CameraStageProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  mirrored: boolean;
  children?: ReactNode;
  /** Rendered when the stream is not active, in place of the video. */
  fallback?: ReactNode;
  active: boolean;
  className?: string;
  onMetrics?: (metrics: StageMetrics) => void;
}

export interface StageMetrics {
  displayWidth: number;
  displayHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export function CameraStage({
  videoRef,
  mirrored,
  children,
  fallback,
  active,
  className,
  onMetrics,
}: CameraStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<StageMetrics>({
    displayWidth: 0,
    displayHeight: 0,
    sourceWidth: 0,
    sourceHeight: 0,
  });

  // Latest-callback ref, assigned after render rather than during it: reading
  // or writing a ref mid-render is not safe under concurrent rendering.
  const onMetricsRef = useRef(onMetrics);
  useEffect(() => {
    onMetricsRef.current = onMetrics;
  });

  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;

    const publish = () => {
      const next: StageMetrics = {
        displayWidth: container.clientWidth,
        displayHeight: container.clientHeight,
        sourceWidth: video?.videoWidth ?? 0,
        sourceHeight: video?.videoHeight ?? 0,
      };
      setMetrics((current) =>
        current.displayWidth === next.displayWidth &&
        current.displayHeight === next.displayHeight &&
        current.sourceWidth === next.sourceWidth &&
        current.sourceHeight === next.sourceHeight
          ? current
          : next,
      );
      onMetricsRef.current?.(next);
    };

    const observer = new ResizeObserver(publish);
    observer.observe(container);

    // The intrinsic video size is unknown until metadata arrives, and changes
    // when the camera is switched.
    video?.addEventListener('loadedmetadata', publish);
    video?.addEventListener('resize', publish);
    publish();

    return () => {
      observer.disconnect();
      video?.removeEventListener('loadedmetadata', publish);
      video?.removeEventListener('resize', publish);
    };
  }, [videoRef, active]);

  return (
    <div ref={containerRef} className={cn('relative overflow-hidden bg-void', className)}>
      <video
        ref={videoRef}
        // All three are mandatory on iOS: without `playsInline` Safari opens a
        // fullscreen native player and the overlay is lost entirely.
        playsInline
        muted
        autoPlay
        aria-label="Live camera feed"
        className={cn(
          'size-full object-cover transition-opacity duration-300',
          active ? 'opacity-100' : 'opacity-0',
          mirrored && 'scale-x-[-1]',
        )}
      />

      {!active && fallback && (
        <div className="absolute inset-0 flex items-center justify-center">{fallback}</div>
      )}

      {active && children}

      {/* Vignette: pulls the eye to the centre of frame and lifts contrast
          under the top and bottom control clusters. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(7,9,10,0.55)_100%)]"
      />

      <span className="sr-only" aria-live="polite">
        {active
          ? `Camera active at ${metrics.sourceWidth} by ${metrics.sourceHeight}`
          : 'Camera inactive'}
      </span>
    </div>
  );
}
