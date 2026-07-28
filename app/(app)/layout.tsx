import { redirect } from "next/navigation";
import { navItemsForRoles } from "@/domain/navigation";
import { AppShell } from "@/ui/shell/AppShell";
import { getCachedActor } from "./_actor";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const result = await getCachedActor();

  if (result.status === "signed-out") redirect("/sign-in");
  if (result.status === "suspended") redirect("/account-suspended");

  const roles = result.actor.roleGrants.map((grant) => grant.role);
  const navItems = navItemsForRoles(roles);

  return (
    <AppShell navItems={navItems} userName={result.fullName} tenantName={result.tenantName}>
      {children}
    </AppShell>
  );
}
