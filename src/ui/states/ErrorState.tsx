// docs/06-ui-spec.md: "error (states what failed and offers retry)." Designed to be usable
// directly from a Next.js error.tsx boundary, which supplies exactly this shape (error, reset).
export function ErrorState({
  message = "Something went wrong loading this page.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-token border border-line bg-raised p-8 text-center"
    >
      <p className="font-medium text-lost">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-token border border-line px-4 py-2 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
