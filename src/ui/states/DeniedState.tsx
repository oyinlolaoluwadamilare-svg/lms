// docs/06-ui-spec.md: "permission-denied (explains that access is limited by role, never a blank
// screen)." Reached when a role directly navigates to a route their nav doesn't include - hiding
// the link is presentation only and is never the sole control (CLAUDE.md #1); this is the actual
// server-side gate for that case.
export function DeniedState({ message = "This section isn't available for your role." }: { message?: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-token border border-line bg-raised p-8 text-center"
    >
      <p className="font-medium text-ink">Access limited by role</p>
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
