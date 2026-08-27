'use client';

import {
  Aperture,
  Flashlight,
  FlashlightOff,
  Pause,
  Play,
  SlidersHorizontal,
  SwitchCamera,
  ZoomIn,
} from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import type { CameraCapabilities } from '@/hooks/useCamera';
import { cn } from '@/lib/cn';

/**
 * CameraControls — the operating cluster.
 *
 * Positioned bottom-centre within thumb reach on a phone held one-handed, and
 * kept to five controls. Anything else belongs in the detection-settings sheet:
 * a control strip that grows without limit is how camera UIs become unusable.
 */
interface CameraControlsProps {
  capabilities: CameraCapabilities;
  torchOn: boolean;
  zoom: number;
  paused: boolean;
  busy: boolean;
  onFlip: () => void;
  onTorch: (on: boolean) => void;
  onZoom: (value: number) => void;
  onSnapshot: () => void;
  onTogglePause: () => void;
  onOpenSettings: () => void;
  className?: string;
}

export function CameraControls({
  capabilities,
  torchOn,
  zoom,
  paused,
  busy,
  onFlip,
  onTorch,
  onZoom,
  onSnapshot,
  onTogglePause,
  onOpenSettings,
  className,
}: CameraControlsProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      {capabilities.zoom && (
        <div className="flex w-full max-w-[280px] items-center gap-2 rounded-sm border border-hairline bg-abyss/70 px-3 py-2 backdrop-blur-sm">
          <ZoomIn aria-hidden className="size-3.5 shrink-0 text-slate" />
          <input
            type="range"
            aria-label="Zoom"
            min={capabilities.zoomMin}
            max={capabilities.zoomMax}
            step={capabilities.zoomStep}
            value={zoom}
            onChange={(event) => onZoom(Number(event.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-gunmetal accent-[var(--color-tactical)]"
          />
          <span className="tabular w-9 text-right font-mono text-[10px] text-tactical">
            {zoom.toFixed(1)}×
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <IconButton
          label={torchOn ? 'Turn torch off' : 'Turn torch on'}
          variant="glass"
          active={torchOn}
          disabled={!capabilities.torch}
          onClick={() => onTorch(!torchOn)}
        >
          {torchOn ? (
            <Flashlight aria-hidden className="size-[18px]" strokeWidth={1.75} />
          ) : (
            <FlashlightOff aria-hidden className="size-[18px]" strokeWidth={1.75} />
          )}
        </IconButton>

        <IconButton label="Switch camera" variant="glass" onClick={onFlip} disabled={busy}>
          <SwitchCamera aria-hidden className="size-[18px]" strokeWidth={1.75} />
        </IconButton>

        {/* Capture is the largest target — the one control used under pressure. */}
        <IconButton
          label="Capture snapshot"
          variant="glass"
          onClick={onSnapshot}
          className="size-14 border-tactical/40 bg-tactical/10 text-tactical hover:bg-tactical/20"
        >
          <Aperture aria-hidden className="size-6" strokeWidth={1.5} />
        </IconButton>

        <IconButton
          label={paused ? 'Resume detection' : 'Pause detection'}
          variant="glass"
          active={paused}
          onClick={onTogglePause}
        >
          {paused ? (
            <Play aria-hidden className="size-[18px]" strokeWidth={1.75} />
          ) : (
            <Pause aria-hidden className="size-[18px]" strokeWidth={1.75} />
          )}
        </IconButton>

        <IconButton label="Detection settings" variant="glass" onClick={onOpenSettings}>
          <SlidersHorizontal aria-hidden className="size-[18px]" strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  );
}
