'use client';

import { CameraOff, Loader2, ShieldAlert, TriangleAlert, VideoOff } from 'lucide-react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

/**
 * PermissionState — every terminal state the camera pipeline can reach.
 *
 * Each variant answers three questions: what happened, why, and what the user
 * can do next. A denied permission in particular cannot be re-requested
 * programmatically once refused, so the copy must direct the user to the
 * browser's own controls rather than offering a button that would do nothing.
 */
export type PermissionVariant =
  | 'camera-denied'
  | 'camera-unavailable'
  | 'camera-error'
  | 'insecure-context'
  | 'model-loading'
  | 'model-error';

interface PermissionStateProps {
  variant: PermissionVariant;
  detail?: string | null;
  progress?: number;
  onRetry?: () => void;
  onFallback?: () => void;
}

export function PermissionState({
  variant,
  detail,
  progress = 0,
  onRetry,
  onFallback,
}: PermissionStateProps) {
  switch (variant) {
    case 'camera-denied':
      return (
        <EmptyState
          tone="fault"
          icon={<ShieldAlert aria-hidden className="size-5" />}
          title="Camera access denied"
          description={
            detail ??
            'FLOCKRAFT cannot observe without camera access. Enable it for this site in your browser settings, then reload.'
          }
          action={
            onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                Retry
              </Button>
            )
          }
        />
      );

    case 'camera-unavailable':
      return (
        <EmptyState
          tone="fault"
          icon={<VideoOff aria-hidden className="size-5" />}
          title="No camera available"
          description={
            detail ?? 'No video input device was found. Connect a camera and try again.'
          }
          action={
            onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                Retry
              </Button>
            )
          }
        />
      );

    case 'insecure-context':
      return (
        <EmptyState
          tone="fault"
          icon={<ShieldAlert aria-hidden className="size-5" />}
          title="Secure context required"
          description="Browsers only expose the camera over HTTPS or on localhost. Open FLOCKRAFT over a secure connection."
        />
      );

    case 'camera-error':
      return (
        <EmptyState
          tone="fault"
          icon={<CameraOff aria-hidden className="size-5" />}
          title="Camera fault"
          description={detail ?? 'The camera stream could not be started.'}
          action={
            onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                Retry
              </Button>
            )
          }
        />
      );

    case 'model-loading':
      return (
        <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
          <Loader2 aria-hidden className="size-5 animate-spin text-tactical" />
          <div className="w-full max-w-[220px]">
            <p className="mb-2 font-mono text-[11px] tracking-[0.16em] text-bone uppercase">
              Loading detection model
            </p>
            {/* An indeterminate spinner alone leaves the user unsure whether a
                slow connection is progressing; the bar reports real progress. */}
            <div
              className="h-0.5 w-full overflow-hidden bg-gunmetal"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Model download progress"
            >
              <div
                className="h-full bg-tactical transition-[width] duration-200"
                style={{ width: `${Math.max(4, progress * 100)}%` }}
              />
            </div>
            <p className="tabular mt-2 font-mono text-[10px] text-slate">
              {Math.round(progress * 100)}%
            </p>
          </div>
        </div>
      );

    case 'model-error':
      return (
        <EmptyState
          tone="fault"
          icon={<TriangleAlert aria-hidden className="size-5" />}
          title="Model failed to load"
          description={
            detail ??
            'The detection model could not be downloaded. Check the connection, or continue with the simulated feed.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {onRetry && (
                <Button variant="primary" onClick={onRetry}>
                  Retry
                </Button>
              )}
              {onFallback && (
                <Button variant="secondary" onClick={onFallback}>
                  Use simulated feed
                </Button>
              )}
            </div>
          }
        />
      );
  }
}
