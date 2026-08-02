import Link from "next/link";
import { TASK_QUEUE_GROUPS, TASK_QUEUE_GROUP_LABELS, taskQueueGroup } from "@/domain/task";
import { dateInTimezone } from "@/lib/dates";
import { listMyWork, type TaskQueueItem } from "@/services/tasks";
import { createClient } from "@/lib/supabase/server";
import { getCachedActor } from "../_actor";
import { checkRouteAccess } from "../_access";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { TaskRow } from "./TaskRow";

type Tab = "assigned_to_me" | "assigned_by_me";

const TAB_LABELS: Record<Tab, string> = { assigned_to_me: "Assigned to me", assigned_by_me: "Assigned by me" };

// docs/06-ui-spec.md's My Work screen (docs/07-build-backlog.md M4.5): "Grouped as Overdue (red,
// collapsed only if empty), Due today, This week, Later, and No date... Tabs: Assigned to me and
// Assigned by me". "Team" (a third tab for leaders) is explicitly M4.6's own backlog line ("Team
// view for Team Lead and Director with per-person open, overdue and completed counts"), not this
// one - not built here, the same vertical-slice-per-backlog-line discipline this project has kept
// throughout. "Collapsed only if empty" is implemented as simply not rendering a group's section at
// all when it has zero tasks - the simplest reading that satisfies "don't show an empty Overdue
// section taking up space" without inventing a stateful collapse/expand interaction nobody asked for.
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        {(["assigned_to_me", "assigned_by_me"] as const).map((t) => (
          <Link
            key={t}
            href={t === "assigned_to_me" ? "/my-work" : "/my-work?tab=assigned_by_me"}
            prefetch={false}
            aria-current={tab === t ? "page" : undefined}
            className={`rounded-token px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              tab === t ? "bg-accent text-surface" : "border border-line text-ink hover:bg-raised"
            }`}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </div>

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
