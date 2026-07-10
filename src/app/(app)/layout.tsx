import { requireUser } from '@/lib/session';
import { Topbar } from '@/components/nav/topbar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex-1 flex flex-col">
      <Topbar name={user.name} email={user.email} role={user.role} unitId={user.unitId} />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
