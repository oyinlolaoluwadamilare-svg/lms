import { ResetPasswordForm } from "./ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
      <ResetPasswordForm />
    </main>
  );
}
