'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-tactical/15 text-tactical border-tactical/45 hover:bg-tactical/25 active:bg-tactical/30',
  secondary: 'bg-gunmetal text-bone border-hairline hover:bg-graphite active:bg-graphite',
  ghost: 'bg-transparent text-ash border-transparent hover:bg-gunmetal hover:text-bone',
  danger: 'bg-alert/10 text-alert border-alert/40 hover:bg-alert/20',
};

const SIZE: Record<Size, string> = {
  // Every size keeps a >=36px box; `md` and `lg` clear the 44px target used
  // for anything a user reaches for on a moving vehicle or with gloves.
  sm: 'h-9 px-3 text-[11px]',
  md: 'h-11 px-4 text-xs',
  lg: 'h-12 px-5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  children,
  icon,
  fullWidth,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sm border font-mono tracking-[0.12em] uppercase',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only controls must always carry an accessible name. */
  label: string;
  children: ReactNode;
  active?: boolean;
  variant?: 'solid' | 'glass';
}

export function IconButton({
  label,
  children,
  active,
  variant = 'solid',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'fk-tap inline-flex items-center justify-center rounded-sm border transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-35',
        variant === 'glass'
          ? 'border-hairline bg-abyss/70 backdrop-blur-sm'
          : 'border-hairline bg-gunmetal',
        active
          ? 'border-tactical/50 bg-tactical/15 text-tactical'
          : 'text-ash hover:bg-graphite hover:text-bone',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
