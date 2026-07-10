'use client';

import { Button } from './button';
import type { ComponentProps } from 'react';

/** A submit button that asks before firing its parent form. */
export function ConfirmButton({
  message,
  children,
  ...props
}: ComponentProps<typeof Button> & { message: string }) {
  return (
    <Button
      type="submit"
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
