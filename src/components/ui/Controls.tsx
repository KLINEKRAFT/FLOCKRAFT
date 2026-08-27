'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Toggle — labelled switch. The control is a real checkbox input so it keeps
 * native keyboard behaviour and announces its state; the visual track is
 * purely decorative.
 */
export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
  tone = 'default',
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  tone?: 'default' | 'sensitive';
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className={cn(
            'block cursor-pointer font-mono text-[11px] tracking-[0.1em] uppercase',
            disabled ? 'text-slate' : 'text-bone',
          )}
        >
          {label}
          {tone === 'sensitive' && (
            <span className="ml-2 text-[9px] tracking-[0.14em] text-caution">SENSITIVE</span>
          )}
        </label>
        {description && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-ash">{description}</p>
        )}
      </div>
      {/* The visible track is 24px tall, but the input is stretched to a 44px
          hit area around it. Sizing the input to the artwork would leave the
          control below the comfortable touch target on every phone. */}
      <span className="relative -my-2.5 flex h-11 shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className={cn(
            'flex h-6 w-11 items-center rounded-full border px-0.5 transition-colors',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-tactical',
            checked ? 'border-tactical/50 bg-tactical/25' : 'border-hairline bg-gunmetal',
            disabled && 'opacity-40',
          )}
        >
          <span
            className={cn(
              'size-4 rounded-full transition-transform duration-150',
              checked ? 'translate-x-5 bg-tactical' : 'translate-x-0 bg-slate',
            )}
          />
        </span>
      </span>
    </div>
  );
}

/** Slider — numeric range with a live tabular readout. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="py-3">
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor={id} className="fk-label">
          {label}
        </label>
        <span className="tabular font-mono text-[11px] text-tactical">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn(
          'h-1 w-full cursor-pointer appearance-none rounded-full bg-gunmetal',
          'accent-[var(--color-tactical)] disabled:cursor-not-allowed disabled:opacity-40',
        )}
      />
    </div>
  );
}

/** Segmented control — mutually exclusive options in a single strip. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-sm border border-hairline bg-abyss p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xs px-3 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors',
              active ? 'bg-gunmetal text-tactical' : 'text-slate hover:text-bone',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Search field with a consistent affordance across screens. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  icon,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  icon?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {icon && (
        <span aria-hidden className="absolute top-1/2 left-3 -translate-y-1/2 text-slate">
          {icon}
        </span>
      )}
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-11 w-full rounded-sm border border-hairline bg-abyss text-[13px] text-bone',
          'placeholder:text-shadowtext focus:border-tactical/40',
          icon ? 'pr-3 pl-9' : 'px-3',
        )}
      />
    </div>
  );
}
