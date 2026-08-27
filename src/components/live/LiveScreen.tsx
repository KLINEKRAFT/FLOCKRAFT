'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronUp, Radio } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InlineTelemetry } from '@/components/ui/TelemetryValue';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PermissionState, type PermissionVariant } from '@/components/ui/PermissionState';
import { Panel } from '@/components/ui/Panel';
import { CameraStage, type StageMetrics } from './CameraStage';
import { CameraControls } from './CameraControls';
import { DetectionOverlay } from './DetectionOverlay';
import { SessionSummary } from './SessionSummary';
import { LiveEventsPanel } from './LiveEventsPanel';
import { DetectionSettingsSheet } from './DetectionSettingsSheet';
import { MatchPrompt } from './MatchPrompt';
import { ResizeHandle } from './ResizeHandle';
import { useCamera } from '@/hooks/useCamera';
import { useSettings } from '@/hooks/useSettings';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useDetectionPipeline } from '@/hooks/useDetectionPipeline';
import { usePanelWidth } from '@/hooks/usePanelWidth';
import type { RecordedObservation } from '@/lib/observationRecorder';
import type { Track } from '@/types/domain';
import { captureSnapshot } from '@/lib/vision/capture';
import { getRepository } from '@/lib/store';
import { createId } from '@/lib/id';
import { formatClock, formatCoord } from '@/lib/format';
import { logError } from '@/lib/logger';

/**
 * LIVE — the primary screen.
 *
 * Layout contract:
 *   mobile   camera fills the viewport; summary and event log are a sheet that
 *            can be pulled up over it
 *   desktop  camera on the left, a persistent intel column on the right
 *
 * The pipeline runs only when the camera is active, the page is visible, and
 * the user has not paused. All three conditions are enforced in one place so
 * there is no path where inference continues against a stale or hidden frame.
 */
export function LiveScreen() {
  const camera = useCamera();
  const { settings, update: updateSettings, hydrated } = useSettings();
  const visible = usePageVisibility();
  const panel = usePanelWidth();
  const geo = useGeolocation(settings.saveLocation);

  const [paused, setPaused] = useState(false);
  const [metrics, setMetrics] = useState<StageMetrics>({
    displayWidth: 0,
    displayHeight: 0,
    sourceWidth: 0,
    sourceHeight: 0,
  });
  const [recent, setRecent] = useState<RecordedObservation[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [clock, setClock] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const startedRef = useRef(false);

  const pipelineEnabled = camera.status === 'active' && visible && !paused && hydrated;

  const onObservation = useCallback((observation: RecordedObservation) => {
    // Newest first, bounded — the live log is a window, not an archive.
    setRecent((current) => [observation, ...current].slice(0, 30));
  }, []);

  const pipeline = useDetectionPipeline({
    videoRef: camera.videoRef,
    settings,
    enabled: pipelineEnabled,
    location: settings.saveLocation ? geo.fix : null,
    facingMode: camera.facingMode,
    deviceLabel: camera.devices.find((device) => device.deviceId === camera.activeDeviceId)?.label,
    onObservation,
  });

  // Start the camera once, after settings hydrate. Autostart is deliberate:
  // LIVE is the app's entire purpose, and an extra tap before every session is
  // friction with no benefit — the browser still gates the permission itself.
  useEffect(() => {
    if (!hydrated || startedRef.current) return;
    startedRef.current = true;
    void camera.start();
  }, [hydrated, camera]);

  // Header clock. Rendered null on the server so the markup matches, then
  // ticks once a second.
  useEffect(() => {
    const tick = () => setClock(formatClock(Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);

  // Not wrapped in `useCallback`: it reads `videoRef.current`, so its identity
  // cannot be derived from a dependency list, and it is only ever passed to a
  // DOM handler where identity is irrelevant.
  const onSnapshot = async () => {
    const video = camera.videoRef.current;
    if (!video) return;
    try {
      const blob = await captureSnapshot(video);
      if (!blob) return;
      if (!settings.saveImages) {
        setToast('Image storage is off — snapshot discarded');
        return;
      }
      await getRepository().putMedia({
        id: createId('med'),
        sessionId: pipeline.sessionId ?? 'unbound',
        kind: 'snapshot',
        mimeType: blob.type,
        width: video.videoWidth,
        height: video.videoHeight,
        byteSize: blob.size,
        createdAt: Date.now(),
        blob,
      });
      setToast('Snapshot saved');
    } catch (error) {
      logError('camera', error);
      setToast('Snapshot failed');
    }
  };

  const { confirmMatch, rejectMatch } = pipeline;

  const onConfirmMatch = useCallback(
    async (trackId: string) => {
      try {
        await confirmMatch(trackId);
        setToast('Match confirmed');
      } catch (error) {
        logError('store', error);
        setToast('Could not confirm match');
      }
    },
    [confirmMatch],
  );

  const onSelectTrack = useCallback((track: Track) => {
    setSelectedTrackId((current) => (current === track.id ? null : track.id));
  }, []);

  const cameraVariant = useMemo<PermissionVariant | null>(() => {
    switch (camera.status) {
      case 'denied':
        return 'camera-denied';
      case 'unavailable':
        return typeof window !== 'undefined' && !window.isSecureContext
          ? 'insecure-context'
          : 'camera-unavailable';
      case 'error':
        return 'camera-error';
      default:
        return null;
    }
  }, [camera.status]);

  const overlayVisible =
    settings.showOverlays && pipeline.status === 'running' && camera.status === 'active';

  /*
   * One proposal at a time, oldest first.
   *
   * Two subjects can qualify in the same second, and stacking their prompts
   * would put two irreversible decisions on screen at once, over the very feed
   * the operator needs to look at to answer either. Queuing keeps the decision
   * singular; the rest reappear as each is resolved.
   */
  const pendingMatch = useMemo(
    () =>
      pipeline.tracks
        .filter((track) => track.candidateMatch)
        .sort((a, b) => a.firstSeenAt - b.firstSeenAt)[0] ?? null,
    [pipeline.tracks],
  );

  // Compact fix state for the narrow strip; the coordinates themselves appear
  // in a separate field once the viewport can hold them.
  const gpsShort = !settings.saveLocation
    ? 'OFF'
    : geo.status === 'active'
      ? 'FIX'
      : geo.status === 'denied'
        ? 'DENIED'
        : geo.status.toUpperCase();
  const gpsTone = geo.status === 'denied' ? 'fault' : geo.status === 'active' ? 'accent' : 'muted';

  return (
    <>
      <TopBar
        transparent
        status={
          <div className="flex items-center gap-1.5">
            {pipeline.status === 'running' ? (
              <StatusBadge tone="live" pulse size="sm">
                Live
              </StatusBadge>
            ) : pipeline.status === 'loading-model' ? (
              <StatusBadge tone="caution" size="sm">
                Loading
              </StatusBadge>
            ) : pipeline.status === 'model-error' ? (
              <StatusBadge tone="fault" size="sm">
                Model
              </StatusBadge>
            ) : (
              <StatusBadge tone="idle" size="sm">
                {paused ? 'Paused' : 'Standby'}
              </StatusBadge>
            )}
          </div>
        }
      >
        {/*
          Telemetry strip. Density is tiered by breakpoint rather than letting
          six values fight for a 393px viewport: at that width the last item is
          pushed off-screen, and the clock — the value operators glance at most
          — was the one being lost. Phones get camera, rate, fix and time;
          resolution and inference latency appear once there is room, and the
          full coordinate pair only on wide screens.
        */}
        <div className="flex items-center justify-between gap-3 border-t border-hairline/60 px-3 py-1.5 lg:px-5">
          <div className="fk-rail flex min-w-0 items-center gap-3 overflow-x-auto sm:gap-4">
            <InlineTelemetry
              label="CAM"
              value={camera.facingMode === 'user' ? 'FRONT' : 'REAR'}
              tone="muted"
            />
            <InlineTelemetry
              className="hidden sm:inline-flex"
              label="RES"
              value={
                camera.resolution
                  ? `${camera.resolution.width}×${camera.resolution.height}`
                  : '—'
              }
              tone="muted"
            />
            <InlineTelemetry
              label="FPS"
              value={pipeline.stats.fps ? pipeline.stats.fps.toFixed(1) : '—'}
              tone={pipeline.stats.throttled ? 'fault' : 'accent'}
            />
            <InlineTelemetry
              className="hidden sm:inline-flex"
              label="INF"
              value={pipeline.stats.inferenceMs ? `${pipeline.stats.inferenceMs}ms` : '—'}
              tone="muted"
            />
            <InlineTelemetry label="GPS" value={gpsShort} tone={gpsTone} />
            <InlineTelemetry
              className="hidden md:inline-flex"
              label="POS"
              value={
                geo.fix
                  ? `${formatCoord(geo.fix.latitude, 'lat')} ${formatCoord(geo.fix.longitude, 'lon')}`
                  : '—'
              }
              tone="muted"
            />
          </div>
          {/* Outside the scroll container so the clock is never scrolled away. */}
          <InlineTelemetry
            className="shrink-0"
            label="UTC"
            value={clock ?? '--:--:--'}
            tone="muted"
          />
        </div>
      </TopBar>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* ---- Camera column ---- */}
        <section className="relative flex-1 lg:min-h-0" aria-label="Camera">
          <CameraStage
            videoRef={camera.videoRef}
            mirrored={camera.facingMode === 'user'}
            active={camera.status === 'active'}
            onMetrics={setMetrics}
            className="h-[62dvh] min-h-[340px] lg:h-full lg:min-h-0"
            fallback={
              cameraVariant ? (
                <PermissionState
                  variant={cameraVariant}
                  detail={camera.error}
                  onRetry={() => void camera.start()}
                />
              ) : (
                <EmptyState
                  icon={<Camera aria-hidden className="size-5" />}
                  title="Camera standby"
                  description="Grant camera access to begin observing."
                  action={
                    <Button variant="primary" onClick={() => void camera.start()}>
                      Start camera
                    </Button>
                  }
                />
              )
            }
          >
            {overlayVisible && (
              <DetectionOverlay
                tracks={pipeline.tracks}
                sourceWidth={metrics.sourceWidth}
                sourceHeight={metrics.sourceHeight}
                displayWidth={metrics.displayWidth}
                displayHeight={metrics.displayHeight}
                mirrored={camera.facingMode === 'user'}
                showTrails={settings.showTrails}
                onSelect={onSelectTrack}
                selectedTrackId={selectedTrackId}
              />
            )}

            {/* Model loading and failure are surfaced over the live feed rather
                than replacing it — the operator can still see the scene. */}
            {(pipeline.status === 'loading-model' || pipeline.status === 'model-error') && (
              <div className="absolute inset-x-0 bottom-28 mx-auto max-w-sm px-4">
                <Panel tone="glass">
                  <PermissionState
                    variant={
                      pipeline.status === 'loading-model' ? 'model-loading' : 'model-error'
                    }
                    progress={pipeline.modelProgress}
                    detail={pipeline.error}
                    onRetry={pipeline.retryModel}
                    onFallback={() => updateSettings({ detectorId: 'simulated' })}
                  />
                </Panel>
              </div>
            )}

            {settings.detectorId === 'simulated' && pipeline.status === 'running' && (
              <div className="absolute top-3 left-3">
                <StatusBadge tone="caution" size="sm">
                  Simulated detections
                </StatusBadge>
              </div>
            )}

            {paused && (
              <div className="absolute inset-0 flex items-center justify-center bg-void/45">
                <StatusBadge tone="caution">Detection paused</StatusBadge>
              </div>
            )}

            {pendingMatch && (
              <MatchPrompt
                className="absolute inset-x-0 bottom-20 mx-auto max-w-sm px-4"
                track={pendingMatch}
                onConfirm={() => void onConfirmMatch(pendingMatch.id)}
                onReject={() => rejectMatch(pendingMatch.id)}
              />
            )}

            <CameraControls
              className="absolute inset-x-0 bottom-4 px-4"
              capabilities={camera.capabilities}
              torchOn={camera.torchOn}
              zoom={camera.zoom}
              paused={paused}
              busy={camera.status === 'requesting'}
              onFlip={() => void camera.flip()}
              onTorch={(on) => void camera.setTorch(on)}
              onZoom={(value) => void camera.setZoom(value)}
              onSnapshot={() => void onSnapshot()}
              onTogglePause={() => setPaused((current) => !current)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </CameraStage>
        </section>

        <ResizeHandle width={panel.width} onWidth={panel.setWidth} onReset={panel.reset} />

        {/*
          Intel column: stacked under the camera on mobile, a resizable rail on
          desktop. The inline width is applied only once the stored value has
          hydrated — rendering it on the server would emit a width the markup
          cannot know, and React would flag the mismatch.
        */}
        <aside
          className="flex flex-col border-hairline bg-void lg:w-[var(--panel-w,380px)] lg:shrink-0 lg:overflow-y-auto"
          style={panel.hydrated ? { ['--panel-w']: `${panel.width}px` } as React.CSSProperties : undefined}
          aria-label="Session intelligence"
        >
          <SessionSummary counts={pipeline.counts} className="border-b border-hairline" />

          <button
            type="button"
            onClick={() => setSheetOpen((open) => !open)}
            aria-expanded={sheetOpen}
            className="flex min-h-11 items-center justify-between gap-2 border-b border-hairline px-3 text-left lg:hidden"
          >
            <span className="fk-label">Latest events</span>
            <span className="flex items-center gap-2">
              <span className="tabular font-mono text-[10px] text-tactical">
                {String(recent.length).padStart(2, '0')}
              </span>
              <ChevronUp
                aria-hidden
                className={`size-3.5 text-slate transition-transform ${sheetOpen ? '' : 'rotate-180'}`}
              />
            </span>
          </button>

          <div className={`${sheetOpen ? 'block' : 'hidden'} lg:block`}>
            <LiveEventsPanel observations={recent} tracks={pipeline.tracks} />
          </div>
        </aside>
      </div>

      <DetectionSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={updateSettings}
        stats={pipeline.stats}
      />

      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[calc(var(--nav-height)+var(--safe-bottom)+12px)] z-40 mx-auto w-fit rounded-sm border border-hairline bg-charcoal px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-bone uppercase lg:bottom-6"
        >
          <span className="inline-flex items-center gap-2">
            <Radio aria-hidden className="size-3 text-tactical" />
            {toast}
          </span>
        </div>
      )}
    </>
  );
}
