'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="p-6 max-w-lg mx-auto mt-10 text-center space-y-3">
      <h1 className="text-lg font-bold text-charcoal">That did not work</h1>
      <p className="text-sm text-charcoal/70">
        {error.message || 'Something went wrong while saving. Nothing was lost.'}
      </p>
      <Button onClick={reset}>Go back and retry</Button>
    </Card>
  );
}
