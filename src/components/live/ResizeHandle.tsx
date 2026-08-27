'use client';

import { useCallback, useRef } from 'react';
import { cn } from '@/lib/cn';
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, PANEL_STEP } from '@/lib/panelWidthStore';

/**
 * The divider between the camera and the intel column.
 *
 * Built as a real `separator` with keyboard support rather than a mouse-only
 * drag strip. A pointer-only divider is invisible to anyone working by
 * keyboard, and the layout it controls is the difference between seeing the
 * subject and seeing the log — not a decorative preference.
 *
 * The visible line stays 1px so the interface keeps its hairline construction;
 * the *grab* area is 11px, centred on it with negative margin, because a 1px
 * pointer target is a joke and a 11px one costs nothing visually.
 */

export interface ResizeHandleProps {
  width: number;
  onWidth: (next: number) => void;
  onReset: () => void;
  className?: string;
}

export function ResizeHandle({ width, onWidth, onReset, className }: ResizeHandleProps) {
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Ignore secondary buttons: a right-click drag is not a resize.
    if (event.button !== 0) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Without this the drag selects the page text it passes over.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      // Width is measured from the right edge of the window, because the panel
      // is the right-hand element. Using the handle's own offset instead would
      // drift by the handle width on every drag.
      onWidth(window.innerWidth - event.clientX);
    },
    [onWidth],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? PANEL_STEP * 4 : PANEL_STEP;
      // Left widens the panel because the panel is on the right: dragging the
      // divider left gives it more room. Matching that keeps the two input
      // methods describing the same gesture.
      if (event.key === 'ArrowLeft') onWidth(width + step);
      else if (event.key === 'ArrowRight') onWidth(width - step);
      else if (event.key === 'Home' || event.key === 'End') onReset();
      else return;
      event.preventDefault();
    },
    [onReset, onWidth, width],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize camera and intel columns"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      title="Drag to resize · double-click to reset"
      className={cn(
        'group relative z-20 -mx-[5px] hidden w-[11px] shrink-0 cursor-col-resize touch-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-tactical lg:block',
        className,
      )}
    >
      {/* The hairline itself, brightening on hover and focus so the affordance
          is discoverable without adding a permanent visual seam. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-hairline transition-colors group-hover:bg-tactical/60 group-focus-visible:bg-tactical"
      />
      {/* Grip marks, shown only on hover — enough to say "this moves". */}
      <span
        aria-hidden
        className="absolute top-1/2 left-1/2 flex h-8 w-[3px] -translate-x-1/2 -translate-y-1/2 flex-col justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <span className="h-1 w-[3px] rounded-full bg-slate" />
        <span className="h-1 w-[3px] rounded-full bg-slate" />
        <span className="h-1 w-[3px] rounded-full bg-slate" />
      </span>
    </div>
  );
}
