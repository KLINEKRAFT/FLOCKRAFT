'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * CAMERA LIFECYCLE
 * ---------------------------------------------------------------------------
 * Owns `getUserMedia`, device enumeration, facing-mode switching, torch and
 * zoom. Several behaviours here exist specifically because of mobile Safari:
 *
 *  - Device labels are empty until permission is granted, so enumeration is
 *    always re-run after the stream starts.
 *  - Only one camera track may be live at a time on iOS. The previous stream is
 *    fully stopped before a new one is requested, otherwise the switch fails
 *    with `NotReadableError`.
 *  - `playsInline` and a muted element are mandatory or iOS opens a fullscreen
 *    native player instead of compositing the overlay.
 *  - Tracks must be stopped on unmount and on `pagehide`, or the camera
 *    indicator stays lit and the device keeps drawing power.
 */

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'error';

export type FacingMode = 'user' | 'environment';

export interface CameraCapabilities {
  torch: boolean;
  zoom: boolean;
  zoomMin: number;
  zoomMax: number;
  zoomStep: number;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: string | null;
  devices: CameraDevice[];
  activeDeviceId: string | null;
  facingMode: FacingMode;
  capabilities: CameraCapabilities;
  torchOn: boolean;
  zoom: number;
  resolution: { width: number; height: number } | null;
  start: (options?: { deviceId?: string; facingMode?: FacingMode }) => Promise<void>;
  stop: () => void;
  flip: () => Promise<void>;
  selectDevice: (deviceId: string) => Promise<void>;
  setTorch: (on: boolean) => Promise<void>;
  setZoom: (value: number) => Promise<void>;
}

const NO_CAPABILITIES: CameraCapabilities = {
  torch: false,
  zoom: false,
  zoomMin: 1,
  zoomMax: 1,
  zoomStep: 0.1,
};

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [capabilities, setCapabilities] = useState<CameraCapabilities>(NO_CAPABILITIES);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoomState] = useState(1);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);

  /** Stops every track and detaches the element. Safe to call repeatedly. */
  const stop = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
    setTorchOn(false);
    setResolution(null);
    setCapabilities(NO_CAPABILITIES);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((device) => device.kind === 'videoinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            // Labels are empty until permission is granted.
            label: device.label || `Camera ${index + 1}`,
          })),
      );
    } catch {
      // Enumeration failure is non-fatal — the app falls back to facing mode.
    }
  }, []);

  const start = useCallback(
    async (options: { deviceId?: string; facingMode?: FacingMode } = {}) => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        setError(
          'This browser does not expose camera access. A secure context (HTTPS) is required.',
        );
        return;
      }

      // iOS permits one live camera track; release the old one first.
      stop();
      setStatus('requesting');
      setError(null);

      const target = options.facingMode ?? facingMode;
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: options.deviceId
          ? {
              deviceId: { exact: options.deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: { ideal: target },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            },
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // Safari rejects the play() promise if the element is detached mid
          // transition; that is recoverable and must not surface as an error.
          try {
            await video.play();
          } catch {
            /* autoplay interruption — the element recovers on its own */
          }
        }

        const [track] = stream.getVideoTracks();
        if (track) {
          const settings = track.getSettings();
          setActiveDeviceId(settings.deviceId ?? options.deviceId ?? null);
          if (settings.facingMode === 'user' || settings.facingMode === 'environment') {
            setFacingMode(settings.facingMode);
          } else {
            setFacingMode(target);
          }
          setResolution(
            settings.width && settings.height
              ? { width: settings.width, height: settings.height }
              : null,
          );
          setCapabilities(readCapabilities(track));
          setZoomState(readZoom(track));
        }

        setStatus('active');
        // Labels only become available post-grant, so re-enumerate now.
        void refreshDevices();
      } catch (cause) {
        const name = cause instanceof Error ? cause.name : 'Error';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('denied');
          setError('Camera access was denied. Grant permission in browser settings to continue.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('unavailable');
          setError('No camera matching the requested configuration is available.');
        } else if (name === 'NotReadableError') {
          setStatus('error');
          setError('The camera is in use by another application.');
        } else {
          setStatus('error');
          setError(cause instanceof Error ? cause.message : 'Camera failed to start.');
        }
      }
    },
    [facingMode, refreshDevices, stop],
  );

  const flip = useCallback(async () => {
    const next: FacingMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    await start({ facingMode: next });
  }, [facingMode, start]);

  const selectDevice = useCallback(
    async (deviceId: string) => {
      await start({ deviceId });
    },
    [start],
  );

  const setTorch = useCallback(async (on: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      // `torch` is declared in src/types/media.d.ts — see the note there.
      await track.applyConstraints({ advanced: [{ torch: on }] });
      setTorchOn(on);
    } catch {
      setTorchOn(false);
    }
  }, []);

  const setZoom = useCallback(async (value: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] });
      setZoomState(value);
    } catch {
      /* zoom unsupported on this track */
    }
  }, []);

  // Release the camera on unmount and when the page is being torn down. The
  // `pagehide` listener matters on iOS, where unmount may never run before the
  // tab is frozen.
  useEffect(() => {
    const release = () => stop();
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [stop]);

  // Keep the device list current when cameras are attached or removed.
  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const handler = () => void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, [refreshDevices]);

  return {
    videoRef,
    status,
    error,
    devices,
    activeDeviceId,
    facingMode,
    capabilities,
    torchOn,
    zoom,
    resolution,
    start,
    stop,
    flip,
    selectDevice,
    setTorch,
    setZoom,
  };
}

/** Reads torch/zoom support. Both are absent on desktop and most front cameras. */
function readCapabilities(track: MediaStreamTrack): CameraCapabilities {
  if (typeof track.getCapabilities !== 'function') return NO_CAPABILITIES;
  try {
    const caps = track.getCapabilities();
    return {
      torch: Boolean(caps.torch),
      zoom: Boolean(caps.zoom && caps.zoom.max > caps.zoom.min),
      zoomMin: caps.zoom?.min ?? 1,
      zoomMax: caps.zoom?.max ?? 1,
      zoomStep: caps.zoom?.step || 0.1,
    };
  } catch {
    return NO_CAPABILITIES;
  }
}

function readZoom(track: MediaStreamTrack): number {
  try {
    return track.getSettings().zoom ?? 1;
  } catch {
    return 1;
  }
}
