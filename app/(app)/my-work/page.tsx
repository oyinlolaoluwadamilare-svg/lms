import { TASK_QUEUE_GROUPS, TASK_QUEUE_GROUP_LABELS, taskQueueGroup } from "@/domain/task";
import { dateInTimezone } from "@/lib/dates";
import { listMyWork, type TaskQueueItem } from "@/services/tasks";
import { createClient } from "@/lib/supabase/server";
import { getCachedActor } from "../_actor";
import { checkRouteAccess } from "../_access";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { WorkTabs } from "@/ui/nav/WorkTabs";
import { TaskRow } from "./TaskRow";

type Tab = "assigned_to_me" | "assigned_by_me";

// docs/06-ui-spec.md's My Work screen (docs/07-build-backlog.md M4.5): "Grouped as Overdue (red,
// collapsed only if empty), Due today, This week, Later, and No date... Tabs: Assigned to me and
// Assigned by me". The third "Team" tab is M4.6's own deliverable, built as a separate `/team`
// route sharing this page's own tab bar (src/ui/nav/WorkTabs.tsx's own comment explains why: a real
// nav-table entry, not a query-param tab, per that table's own structure). "Collapsed only if
// empty" is implemented as simply not rendering a group's section at all when it has zero tasks -
// the simplest reading that satisfies "don't show an empty Overdue section taking up space" without
// inventing a stateful collapse/expand interaction nobody asked for.
export default async function MyWorkPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { allowed } = await checkRouteAccess("/my-work");
  if (!allowed) return <DeniedState message="My Work is available to BDE and Team Lead roles." />;

  const session = await getCachedActor();
  if (session.status !== "active") return <DeniedState message="Your session has expired. Sign in again." />;

  const rawTab = (await searchParams).tab;
  const tab: Tab = rawTab === "assigned_by_me" ? "assigned_by_me" : "assigned_to_me";

  const supabase = await createClient();
  const tasks = await listMyWork(supabase, session.actor, tab);
  const today = dateInTimezone(new Date().toISOString(), session.timezone);

  const grouped = new Map<string, TaskQueueItem[]>();
  for (const group of TASK_QUEUE_GROUPS) grouped.set(group, []);
  for (const task of tasks) grouped.get(taskQueueGroup(task.dueDate, today))!.push(task);

  const showTeamTab = session.actor.roleGrants.some((g) => g.role === "team_lead" || g.role === "director");

  return (
    <div className="flex flex-col gap-6">
      <WorkTabs active={tab} showTeamTab={showTeamTab} />

      {tasks.length === 0 ? (
        <EmptyState title="Nothing due" description="No open tasks here right now." />
      ) : (
        <div className="flex flex-col gap-6">
          {TASK_QUEUE_GROUPS.map((group) => {
            const groupTasks = grouped.get(group) ?? [];
            if (groupTasks.length === 0) return null;
            return (
              <section key={group} className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
                <h2 className={`text-sm font-semibold ${group === "overdue" ? "text-lost" : "text-ink"}`}>
                  {TASK_QUEUE_GROUP_LABELS[group]} ({groupTasks.length})
                </h2>
                <ol className="flex flex-col gap-2">
                  {groupTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      viewerId={session.actor.id}
                      timezone={session.timezone}
                      showAssignee={tab === "assigned_by_me"}
                    />
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
