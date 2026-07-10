import { cn } from '@/lib/cn';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-navy text-white hover:bg-navy-700 disabled:bg-navy/50',
  secondary:
    'bg-white text-navy border border-line hover:border-midblue hover:text-navy-700 disabled:text-navy/40',
  ghost: 'bg-transparent text-navy hover:bg-navy/5 disabled:text-navy/40',
  danger: 'bg-rag-red text-white hover:opacity-90 disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-sm rounded-md',
  md: 'px-4 py-2 text-sm rounded-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
