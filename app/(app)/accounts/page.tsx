import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listAccountsForDirectory } from "@/services/accounts";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

// M5.8 (docs/07-build-backlog.md): "Account 360 screen." This list is the necessary entry point
// into it, not a separately-specified screen of its own - nothing in docs/06-ui-spec.md names an
// "Accounts list" screen, and nothing else in this codebase links to /accounts/[id] yet. Kept
// deliberately minimal (name, industry, region, a link) rather than reproducing Account 360's own
// richer per-practice-line-owner detail here - a directory's job is letting a viewer find and open
// the right account, not duplicate what opening it shows.
export default async function AccountsPage() {
  const { allowed } = await checkRouteAccess("/accounts");
  if (!allowed) return <DeniedState message="Accounts is not available for your role." />;

  const supabase = await createClient();
  const accounts = await listAccountsForDirectory(supabase);

  if (accounts.length === 0) {
    return <EmptyState title="No accounts to show yet" description="Accounts you're entitled to will appear here." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">Accounts</h1>
      <div className="overflow-x-auto rounded-token border border-line">
        <table className="w-full min-w-[600px] text-[13.5px]">
          <thead className="bg-raised text-left text-ink">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Industry</th>
              <th className="px-3 py-2 font-medium">Region</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id} className="border-t border-line hover:bg-raised">
                <td className="px-3 py-2">
                  <Link href={`/accounts/${account.id}`} prefetch={false} className="font-medium text-accent outline-none hover:underline">
                    {account.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted">{account.industry ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{account.region ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
