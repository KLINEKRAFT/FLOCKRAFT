import type { NormalizedBox } from '@/types/domain';

/**
 * FRAME CAPTURE
 * ---------------------------------------------------------------------------
 * Frames are drawn into a single reused canvas rather than allocating one per
 * tick. Allocating a canvas at 8 FPS creates sustained GC pressure that shows
 * up as visible preview stutter on mobile Safari.
 */

let scratch: HTMLCanvasElement | null = null;

/** Downscaled working canvas holding the most recent frame. */
export function captureFrame(video: HTMLVideoElement, maxEdge = 480): HTMLCanvasElement | null {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));

  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }

  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return scratch;
}

/**
 * Crops a normalised box out of a frame and encodes it as a JPEG blob.
 *
 * The crop is padded outward because detector boxes sit tight against the
 * subject, and a thumbnail with no margin is hard to recognise later. JPEG at
 * 0.72 keeps a 160 px thumbnail in the 4-8 KB range, which is what makes it
 * viable to retain thousands of them in IndexedDB.
 */
export async function cropThumbnail(
  frame: HTMLCanvasElement,
  box: NormalizedBox,
  options: { size?: number; padding?: number; quality?: number } = {},
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const { size = 160, padding = 0.14, quality = 0.72 } = options;

  const padX = box.width * padding;
  const padY = box.height * padding;
  const sx = Math.max(0, (box.x - padX) * frame.width);
  const sy = Math.max(0, (box.y - padY) * frame.height);
  const sw = Math.min(frame.width - sx, (box.width + padX * 2) * frame.width);
  const sh = Math.min(frame.height - sy, (box.height + padY * 2) * frame.height);
  if (sw < 8 || sh < 8) return null;

  // Square output, letterboxed on the shorter axis, so grids stay uniform.
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#0b0e10';
  ctx.fillRect(0, 0, size, size);

  const scale = Math.min(size / sw, size / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(frame, sx, sy, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh);

  const blob = await canvasToBlob(out, 'image/jpeg', quality);
  return blob ? { blob, width: size, height: size } : null;
}

/** Full-frame snapshot at native resolution, for the manual capture control. */
export async function captureSnapshot(video: HTMLVideoElement): Promise<Blob | null> {
  if (video.videoWidth === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return canvasToBlob(canvas, 'image/jpeg', 0.9);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/** Frees the shared scratch canvas. Called when LIVE unmounts. */
export function releaseCaptureResources(): void {
  if (scratch) {
    scratch.width = 0;
    scratch.height = 0;
    scratch = null;
  }
}
