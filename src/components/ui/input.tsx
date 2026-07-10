import { cn } from '@/lib/cn';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const base =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-charcoal placeholder:text-charcoal/40 focus:border-midblue';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, 'min-h-24', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(base, 'pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Label({
  className,
  children,
  htmlFor,
}: {
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn('block text-sm font-semibold text-charcoal mb-1', className)}>
      {children}
    </label>
  );
}
