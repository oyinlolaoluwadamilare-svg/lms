import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-3 py-24">
      <h1 className="text-2xl font-bold text-charcoal">Page not found</h1>
      <p className="text-sm text-charcoal/60">
        That page does not exist, or you may not have access to it.
      </p>
      <Link href="/" className="text-navy font-semibold hover:underline">
        Back to your dashboard
      </Link>
    </main>
  );
}
