import Link from "next/link";

export type WorkTab = "assigned_to_me" | "assigned_by_me" | "team";

const TAB_LABELS: Record<WorkTab, string> = { assigned_to_me: "Assigned to me", assigned_by_me: "Assigned by me", team: "Team" };
const TAB_HREFS: Record<WorkTab, string> = { assigned_to_me: "/my-work", assigned_by_me: "/my-work?tab=assigned_by_me", team: "/team" };

// Shared between app/(app)/my-work/page.tsx and app/(app)/team/page.tsx - docs/06-ui-spec.md
// describes Team as "a third Team tab" alongside My Work's own "Assigned to me"/"Assigned by me",
// but docs/06-ui-spec.md's own "Navigation, per role" table gives Team Lead a separate top-level
// `/team` nav entry, not a query-param tab on `/my-work` (and gives Director neither entry at all -
// a genuine inconsistency the M4.6 backlog line's "Team Lead and Director" surfaced; the user did
// not answer when asked, so the recommended default was taken: Director gets the same `/team` nav
// entry Team Lead has, flagged here and in src/domain/navigation.ts). This component reconciles
// both readings: `/team` is a real, separate route (matching the nav table), but it renders with
// the same tab-bar styling as My Work's own two tabs (matching the "third tab" prose) - one visual
// tab bar spanning two routes, not two different UI treatments.
export function WorkTabs({ active, showTeamTab }: { active: WorkTab; showTeamTab: boolean }) {
  const tabs: WorkTab[] = showTeamTab ? ["assigned_to_me", "assigned_by_me", "team"] : ["assigned_to_me", "assigned_by_me"];
  return (
    <div className="flex items-center gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab}
          href={TAB_HREFS[tab]}
          prefetch={false}
          aria-current={active === tab ? "page" : undefined}
          className={`rounded-token px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            active === tab ? "bg-accent text-surface" : "border border-line text-ink hover:bg-raised"
          }`}
        >
          {TAB_LABELS[tab]}
        </Link>
      ))}
    </div>
  );
}
