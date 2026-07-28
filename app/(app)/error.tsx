"use client";

import { ErrorState } from "@/ui/states/ErrorState";

// Next.js's error boundary convention - catches a rendering error anywhere in this segment and
// its children, supplying reset() as the retry callback. docs/06-ui-spec.md: "error (states what
// failed and offers retry)."
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState onRetry={reset} />;
}
