import type { DetectionClass, EntityKind } from '@/types/domain';
import { KIND_ACCENT } from '@/lib/taxonomy';
import { cn } from '@/lib/cn';

/**
 * EntityLabel — the canonical rendering of an entity designation.
 *
 * The leading colour bar encodes entity kind; the text always carries the
 * designation, so the bar is reinforcement rather than the sole signal.
 */
interface EntityLabelProps {
  label: string;
  kind: EntityKind;
  cls?: DetectionClass;
  confidence?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-[11px]',
  md: 'text-[13px]',
  lg: 'text-base',
};

export function EntityLabel({ label, kind, confidence, size = 'md', className }: EntityLabelProps) {
  const accent = KIND_ACCENT[kind];
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className="h-3 w-0.5 shrink-0 rounded-full"
        style={{ backgroundColor: accent.color }}
      />
      <span
        className={cn('font-mono tracking-[0.08em] whitespace-nowrap uppercase', SIZE[size])}
        style={{ color: accent.color }}
      >
        {label}
      </span>
      {confidence !== undefined && (
        <span className="tabular font-mono text-[10px] text-slate">
          {Math.round(confidence * 100)}%
        </span>
      )}
    </span>
  );
}

/** Small kind chip used in filter rails and card corners. */
export function KindTag({ kind, className }: { kind: EntityKind; className?: string }) {
  const accent = KIND_ACCENT[kind];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] uppercase',
        className,
      )}
      style={{ color: accent.color, borderColor: accent.color, backgroundColor: accent.wash }}
    >
      {kind}
    </span>
  );
}
