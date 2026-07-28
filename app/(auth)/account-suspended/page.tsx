export default function AccountSuspendedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-ink">Your account is not active</h1>
      <p className="max-w-sm text-sm text-muted">
        This account has been suspended or deactivated. Contact your tenant administrator if you
        believe this is a mistake.
      </p>
      <a href="/sign-in" className="text-sm text-accent underline underline-offset-2">
        Back to sign in
      </a>
    </main>
  );
}
