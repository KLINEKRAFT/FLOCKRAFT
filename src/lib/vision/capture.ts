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

/** A frame source that can be cropped. Video is preferred — see below. */
export type CropSource = HTMLVideoElement | HTMLCanvasElement;

function sourceSize(source: CropSource): { width: number; height: number } {
  return source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight }
    : { width: source.width, height: source.height };
}

/**
 * Crops a normalised box out of a frame and encodes it as a JPEG blob.
 *
 * **Crop from the video element, not the inference canvas.** The canvas passed
 * to the detector is downscaled to ~480px on its long edge for speed, so a
 * person filling a third of the frame is only ~160px tall in it. Cropping that
 * and asking for a 320px thumbnail just upscales blur. The video element still
 * holds the full sensor frame — typically 1280x720 — and cropping from it is
 * what actually buys resolution. It costs nothing extra: this runs once per
 * observation, not once per detection tick.
 *
 * The crop is padded outward because detector boxes sit tight against the
 * subject, and a thumbnail with no margin is hard to recognise later.
 */
export async function cropThumbnail(
  frame: CropSource,
  box: NormalizedBox,
  options: { size?: number; padding?: number; quality?: number } = {},
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const { size = 320, padding = 0.14, quality = 0.82 } = options;

  const { width: fw, height: fh } = sourceSize(frame);
  if (fw === 0 || fh === 0) return null;

  const padX = box.width * padding;
  const padY = box.height * padding;
  const sx = Math.max(0, (box.x - padX) * fw);
  const sy = Math.max(0, (box.y - padY) * fh);
  const sw = Math.min(fw - sx, (box.width + padX * 2) * fw);
  const sh = Math.min(fh - sy, (box.height + padY * 2) * fh);
  if (sw < 8 || sh < 8) return null;

  // Square output, letterboxed on the shorter axis, so grids stay uniform.
  // Never upscale past the source crop: producing a 512px thumbnail from a
  // 180px subject makes a bigger file with no more detail in it.
  const edge = Math.min(size, Math.max(64, Math.round(Math.max(sw, sh))));
  const out = document.createElement('canvas');
  out.width = edge;
  out.height = edge;
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  // Smoothing matters when downscaling a large crop; the default is nearest-
  // neighbour in some engines, which makes faces look posterised.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = '#0b0e10';
  ctx.fillRect(0, 0, edge, edge);

  const scale = Math.min(edge / sw, edge / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(frame, sx, sy, sw, sh, (edge - dw) / 2, (edge - dh) / 2, dw, dh);

  const blob = await canvasToBlob(out, 'image/jpeg', quality);
  return blob ? { blob, width: edge, height: edge } : null;
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
