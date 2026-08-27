'use client';

import Link from 'next/link';
import { Sheet } from '@/components/ui/Sheet';
import { SegmentedControl, Slider, Toggle } from '@/components/ui/Controls';
import { Divider, SectionLabel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { listDetectors } from '@/lib/vision/registry';
import { DEFAULT_ENABLED_CLASSES } from '@/lib/taxonomy';
import {
  THUMBNAIL_SIZES,
  THUMBNAIL_SIZE_BYTES,
  THUMBNAIL_SIZE_LABEL,
  type FlockraftSettings,
} from '@/lib/settings';
import type { PipelineStats } from '@/hooks/useDetectionPipeline';
import type { DetectionClass } from '@/types/domain';
import { cn } from '@/lib/cn';

/**
 * DetectionSettingsSheet — per-session tuning that belongs next to the camera.
 *
 * Only controls that change how detection behaves right now live here. Privacy
 * and retention are a separate, deliberate destination (`/settings`) because
 * they are decisions about what is kept, not about what is seen — mixing the
 * two invites a user to change a retention policy while reaching for a slider.
 */
interface DetectionSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  settings: FlockraftSettings;
  onChange: (patch: Partial<FlockraftSettings>) => void;
  stats: PipelineStats;
}

export function DetectionSettingsSheet({
  open,
  onClose,
  settings,
  onChange,
  stats,
}: DetectionSettingsSheetProps) {
  const detectors = listDetectors();

  const toggleClass = (cls: DetectionClass) => {
    const enabled = new Set(settings.enabledClasses);
    if (enabled.has(cls)) enabled.delete(cls);
    else enabled.add(cls);
    // An empty set would silently disable detection entirely; restore defaults.
    const next = [...enabled];
    onChange({ enabledClasses: next.length > 0 ? next : DEFAULT_ENABLED_CLASSES });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Detection">
      <div className="px-4 pb-6">
        <SectionLabel>Model</SectionLabel>
        <div className="flex flex-col gap-2">
          {detectors.map((detector) => {
            const active = detector.id === settings.detectorId;
            return (
              <button
                key={detector.id}
                type="button"
                onClick={() => onChange({ detectorId: detector.id })}
                aria-pressed={active}
                className={cn(
                  'rounded-sm border p-3 text-left transition-colors',
                  active
                    ? 'border-tactical/45 bg-tactical/10'
                    : 'border-hairline bg-gunmetal hover:bg-graphite',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'font-mono text-[11px] tracking-[0.1em] uppercase',
                      active ? 'text-tactical' : 'text-bone',
                    )}
                  >
                    {detector.displayName}
                  </span>
                  <span className="tabular font-mono text-[10px] text-slate">
                    {detector.approxSizeMb > 0 ? `~${detector.approxSizeMb} MB` : 'NO DOWNLOAD'}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ash">
                  {detector.description}
                </p>
              </button>
            );
          })}
        </div>

        <Divider className="my-4" />

        <SectionLabel
          action={
            stats.throttled ? (
              <StatusBadge tone="caution" size="sm">
                Throttled
              </StatusBadge>
            ) : (
              <span className="tabular font-mono text-[10px] text-slate">
                {stats.fps.toFixed(1)} FPS · {stats.inferenceMs}ms
              </span>
            )
          }
        >
          Performance
        </SectionLabel>

        <Slider
          label="Detection rate"
          value={settings.detectionFps}
          min={1}
          max={15}
          step={1}
          onChange={(detectionFps) => onChange({ detectionFps })}
          format={(value) => `${value} FPS`}
        />
        <p className="-mt-1 mb-2 text-[11px] leading-relaxed text-slate">
          The camera preview always runs at full rate. This limits how often the model is invoked.
        </p>

        <Slider
          label="Confidence threshold"
          value={settings.confidenceThreshold}
          min={0.2}
          max={0.95}
          step={0.05}
          onChange={(confidenceThreshold) => onChange({ confidenceThreshold })}
          format={(value) => `${Math.round(value * 100)}%`}
        />

        <Slider
          label="Dwell before logging"
          value={settings.observationThresholdMs}
          min={500}
          max={6000}
          step={250}
          onChange={(observationThresholdMs) => onChange({ observationThresholdMs })}
          format={(value) => `${(value / 1000).toFixed(2)}s`}
        />
        <p className="-mt-1 mb-2 text-[11px] leading-relaxed text-slate">
          A subject must stay continuously visible this long before it becomes an observation.
          Lower values log more, including more false positives.
        </p>

        <Toggle
          label="Low performance mode"
          description="Halves the detection rate, reduces the sampled frame size and skips appearance analysis. Use when the device is hot or the interface stutters."
          checked={settings.lowPerformanceMode}
          onChange={(lowPerformanceMode) => onChange({ lowPerformanceMode })}
        />

        <Divider className="my-4" />

        <SectionLabel
          action={
            <span className="tabular font-mono text-[10px] text-slate">
              {THUMBNAIL_SIZE_BYTES[settings.thumbnailSize] ?? ''} each
            </span>
          }
        >
          Image detail
        </SectionLabel>

        <div className="flex gap-1.5">
          {THUMBNAIL_SIZES.map((size) => {
            const active = settings.thumbnailSize === size;
            return (
              <button
                key={size}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ thumbnailSize: size })}
                disabled={!settings.saveImages}
                className={cn(
                  'min-h-11 flex-1 rounded-sm border px-2 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                  active
                    ? 'border-tactical/45 bg-tactical/12 text-tactical'
                    : 'border-hairline bg-gunmetal text-slate hover:text-bone',
                )}
              >
                <span className="block">{THUMBNAIL_SIZE_LABEL[size] ?? size}</span>
                <span className="tabular mt-0.5 block text-[9px] opacity-70">{size}px</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate">
          Thumbnails are cropped from the full camera frame, not the downscaled one the detector
          uses — so this is real detail, and it does not slow detection. It is the main driver of
          how much storage a day of observation costs.
          {!settings.saveImages && ' Image capture is currently off.'}
        </p>

        <Divider className="my-4" />

        <SectionLabel>Overlay</SectionLabel>
        <Toggle
          label="Show detection boxes"
          checked={settings.showOverlays}
          onChange={(showOverlays) => onChange({ showOverlays })}
        />
        <Toggle
          label="Show movement indicators"
          description="Direction of travel within the camera frame. This is not geographic movement."
          checked={settings.showTrails}
          onChange={(showTrails) => onChange({ showTrails })}
        />

        <Divider className="my-4" />

        <SectionLabel
          action={
            <SegmentedControl
              label="Class preset"
              className="scale-90 origin-right"
              value={
                settings.enabledClasses.length === DEFAULT_ENABLED_CLASSES.length
                  ? 'default'
                  : 'custom'
              }
              options={[
                { value: 'default', label: 'Default' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(value) => {
                if (value === 'default') onChange({ enabledClasses: DEFAULT_ENABLED_CLASSES });
              }}
            />
          }
        >
          Classes
        </SectionLabel>

        <div className="flex flex-wrap gap-1.5">
          {DETECTABLE.map((cls) => {
            const enabled = settings.enabledClasses.includes(cls);
            return (
              <button
                key={cls}
                type="button"
                onClick={() => toggleClass(cls)}
                aria-pressed={enabled}
                className={cn(
                  'min-h-9 rounded-xs border px-2.5 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors',
                  enabled
                    ? 'border-tactical/45 bg-tactical/12 text-tactical'
                    : 'border-hairline bg-gunmetal text-slate hover:text-bone',
                )}
              >
                {cls}
              </button>
            );
          })}
        </div>

        <Divider className="my-4" />

        <Link
          href="/settings"
          className="flex min-h-11 items-center justify-between rounded-sm border border-hairline bg-gunmetal px-3 transition-colors hover:bg-graphite"
        >
          <span className="font-mono text-[11px] tracking-[0.1em] text-bone uppercase">
            Privacy &amp; storage
          </span>
          <span className="font-mono text-[10px] text-slate">→</span>
        </Link>
      </div>
    </Sheet>
  );
}

/** Classes offered in the picker. A superset of the default enabled list. */
const DETECTABLE: DetectionClass[] = [
  'person',
  'dog',
  'cat',
  'bird',
  'horse',
  'car',
  'truck',
  'bus',
  'motorcycle',
  'bicycle',
  'boat',
  'airplane',
  'train',
  'backpack',
  'handbag',
  'suitcase',
  'umbrella',
];
