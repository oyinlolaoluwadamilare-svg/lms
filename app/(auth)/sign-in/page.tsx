import { SignInForm } from "./SignInForm";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-xl font-semibold text-ink">Sign in to Pipeline Intelligence</h1>
      <SignInForm next={next && next.startsWith("/") ? next : "/"} />
    </main>
  );
}
