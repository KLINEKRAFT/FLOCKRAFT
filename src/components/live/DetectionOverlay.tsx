'use client';

import { useMemo } from 'react';
import type { Track } from '@/types/domain';
import { KIND_ACCENT } from '@/lib/taxonomy';
import { DIRECTION_LABEL } from '@/lib/vision/tracker';
import { cn } from '@/lib/cn';

/**
 * DetectionOverlay — bounding boxes over the live feed.
 *
 * Design constraints, in priority order:
 *   1. The camera image must remain readable. Boxes are corner brackets, not
 *      filled rectangles, so no more than ~20% of a subject's outline is ever
 *      occluded.
 *   2. Labels sit outside the box where there is room, and flip inside near the
 *      frame edge so they are never clipped.
 *   3. Colour encodes entity kind, but every box also carries a text
 *      designation — colour is never the only signal.
 *
 * Rendered as absolutely-positioned DOM rather than a canvas: the element count
 * is small (capped at 20 tracks), CSS transitions give free interpolation
 * between detection frames, and the text stays selectable and accessible.
 *
 * `object-fit: cover` on the video means the source frame is cropped, so
 * normalised detector coordinates must be projected through the same transform
 * or every box lands in the wrong place on any non-matching aspect ratio.
 */
interface DetectionOverlayProps {
  tracks: Track[];
  /** Intrinsic dimensions of the video source. */
  sourceWidth: number;
  sourceHeight: number;
  /** Rendered dimensions of the video element. */
  displayWidth: number;
  displayHeight: number;
  /** Mirrored preview (front camera) — boxes must mirror with it. */
  mirrored: boolean;
  showTrails: boolean;
  className?: string;
  onSelect?: (track: Track) => void;
  selectedTrackId?: string | null;
}

export function DetectionOverlay({
  tracks,
  sourceWidth,
  sourceHeight,
  displayWidth,
  displayHeight,
  mirrored,
  showTrails,
  className,
  onSelect,
  selectedTrackId,
}: DetectionOverlayProps) {
  /**
   * Projection for `object-fit: cover`: the source is scaled by the larger of
   * the two axis ratios and centred, so the overflow is split evenly and
   * clipped.
   */
  const project = useMemo(() => {
    if (!sourceWidth || !sourceHeight || !displayWidth || !displayHeight) return null;
    const scale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight);
    const scaledWidth = sourceWidth * scale;
    const scaledHeight = sourceHeight * scale;
    const offsetX = (displayWidth - scaledWidth) / 2;
    const offsetY = (displayHeight - scaledHeight) / 2;

    return (box: Track['box']) => {
      const left = offsetX + box.x * scaledWidth;
      const top = offsetY + box.y * scaledHeight;
      const width = box.width * scaledWidth;
      const height = box.height * scaledHeight;
      return {
        // The front camera preview is mirrored; boxes must be mirrored to match
        // what the operator actually sees on screen.
        left: mirrored ? displayWidth - left - width : left,
        top,
        width,
        height,
      };
    };
  }, [sourceWidth, sourceHeight, displayWidth, displayHeight, mirrored]);

  if (!project) return null;

  return (
    <div
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      aria-hidden={!onSelect}
    >
      {tracks.map((track) => {
        const rect = project(track.box);
        const accent = KIND_ACCENT[track.kind];
        const selected = selectedTrackId === track.id;
        // Flip the label inside the box when it would overflow the top edge.
        const labelBelow = rect.top < 26;

        return (
          <div
            key={track.id}
            className="absolute transition-[left,top,width,height] duration-100 ease-linear"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          >
            <CornerBrackets color={accent.color} emphasised={selected} />

            {/* Faint fill only on the selected track, to disambiguate without
                obscuring the image. */}
            {selected && (
              <span
                aria-hidden
                className="absolute inset-0"
                style={{ backgroundColor: accent.wash }}
              />
            )}

            {showTrails && track.direction !== 'static' && (
              <VelocityIndicator direction={track.direction} color={accent.color} />
            )}

            <button
              type="button"
              onClick={() => onSelect?.(track)}
              disabled={!onSelect}
              className={cn(
                'absolute left-0 flex max-w-[240px] items-center gap-1.5 rounded-xs px-1.5 py-0.5',
                'border font-mono text-[9px] tracking-[0.1em] whitespace-nowrap uppercase backdrop-blur-[2px]',
                onSelect ? 'pointer-events-auto cursor-pointer' : 'cursor-default',
                labelBelow ? 'top-full mt-1' : 'bottom-full mb-1',
              )}
              style={{
                color: accent.color,
                borderColor: `${accent.color}66`,
                backgroundColor: 'rgba(7, 9, 10, 0.72)',
              }}
            >
              <span>{track.entityId ? track.label.replace(/ TEMP-\d+$/, '') : track.label}</span>
              <span className="tabular opacity-70">{Math.round(track.score * 100)}%</span>
              {track.candidateMatch && (
                <span
                  className="ml-0.5 border-l pl-1.5 text-caution"
                  style={{ borderColor: `${accent.color}44` }}
                  title="Possible match — confirmation required"
                >
                  ?
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Corner brackets. Four L-shapes at the box corners: enough to communicate
 * extent precisely while leaving the subject's silhouette unobstructed.
 */
function CornerBrackets({ color, emphasised }: { color: string; emphasised: boolean }) {
  const length = emphasised ? 14 : 10;
  const thickness = emphasised ? 2 : 1;
  const corners = [
    { top: 0, left: 0, borderTop: true, borderLeft: true },
    { top: 0, right: 0, borderTop: true, borderRight: true },
    { bottom: 0, left: 0, borderBottom: true, borderLeft: true },
    { bottom: 0, right: 0, borderBottom: true, borderRight: true },
  ] as const;

  return (
    <>
      {corners.map((corner, index) => (
        <span
          key={index}
          aria-hidden
          className="absolute"
          style={{
            top: 'top' in corner ? corner.top : undefined,
            bottom: 'bottom' in corner ? corner.bottom : undefined,
            left: 'left' in corner ? corner.left : undefined,
            right: 'right' in corner ? corner.right : undefined,
            width: length,
            height: length,
            borderTopWidth: 'borderTop' in corner ? thickness : 0,
            borderBottomWidth: 'borderBottom' in corner ? thickness : 0,
            borderLeftWidth: 'borderLeft' in corner ? thickness : 0,
            borderRightWidth: 'borderRight' in corner ? thickness : 0,
            borderColor: color,
            borderStyle: 'solid',
          }}
        />
      ))}
    </>
  );
}

/** Camera-frame direction of travel. Explicitly not geographic heading. */
function VelocityIndicator({
  direction,
  color,
}: {
  direction: Track['direction'];
  color: string;
}) {
  const glyph: Record<string, string> = {
    left: '◀',
    right: '▶',
    up: '▲',
    down: '▼',
    toward: '⊕',
    away: '⊖',
  };
  return (
    <span
      aria-hidden
      title={`Camera-frame movement: ${DIRECTION_LABEL[direction]}`}
      className="absolute -top-px -right-px translate-x-full pl-1 font-mono text-[8px] leading-none"
      style={{ color, opacity: 0.75 }}
    >
      {glyph[direction] ?? ''}
    </span>
  );
}
