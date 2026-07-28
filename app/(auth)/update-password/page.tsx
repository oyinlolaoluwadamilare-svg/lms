import { UpdatePasswordGate } from "./UpdatePasswordGate";

export default function UpdatePasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-xl font-semibold text-ink">Choose a new password</h1>
      <UpdatePasswordGate />
    </main>
  );
}
