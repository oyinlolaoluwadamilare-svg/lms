import Link from "next/link";
import { ACTIVITY_TYPE_LABELS } from "@/domain/activity";
import { DECISION_ROLE_LABELS } from "@/domain/contact";
import { TASK_PRIORITY_LABELS } from "@/domain/task";
import { formatDateInTimezone, formatPlainDate } from "@/lib/dates";
import type { HandoverSummary } from "@/services/handover";

// M5.9 (docs/07-build-backlog.md): "Handover panel: last ten engagements, open tasks and contacts,
// shown on owner change." Shared by both owner-change flows this milestone builds
// (ChangeOwnerModal.tsx here, and app/(app)/accounts/[id]/ReassignOwnerModal.tsx) - a plain
// presentational component over src/services/handover.ts's own HandoverSummary shape, since both
// callers already fetch that shape identically and there is nothing flow-specific left for this
// component to know about. Rendered inside whichever modal just completed a reassignment, not a
// standalone page - "shown on owner change" names a moment, not a route.
export function HandoverPanel({ summary, timezone }: { summary: HandoverSummary; timezone: string }) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">Last {summary.recentEngagements.length} engagements</h3>
        {summary.recentEngagements.length === 0 ? (
          <p className="text-sm text-muted">No engagement logged yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {summary.recentEngagements.map((entry) =>
              entry.kind === "activity" ? (
                <li key={`activity-${entry.id}`} className="flex flex-col gap-0.5 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                  <p className={`text-ink ${entry.retractedAt ? "line-through" : ""}`}>
                    <span className="mr-2 rounded-token bg-accent px-1.5 py-0.5 text-xs font-medium text-surface">
                      {ACTIVITY_TYPE_LABELS[entry.type]}
                    </span>
                    {entry.summary}
                  </p>
                  <p className="text-xs text-muted">
                    {entry.dealName} · {entry.authorName ?? "Unknown"} · {formatPlainDate(entry.activityDate)}
                  </p>
                </li>
              ) : (
                <li key={`stage-${entry.id}`} className="flex flex-col gap-0.5 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                  <p className="text-ink">
                    <span className="mr-2 rounded-token bg-raised px-1.5 py-0.5 text-xs font-medium text-muted">Stage change</span>
                    {entry.fromStageName ? `${entry.fromStageName} → ${entry.toStageName}` : entry.toStageName}
                  </p>
                  <p className="text-xs text-muted">
                    {entry.dealName} · {entry.actorName ?? "System"} · {formatDateInTimezone(entry.occurredAt, timezone)}
                  </p>
                </li>
              ),
            )}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">Open tasks</h3>
        {summary.openTasks.length === 0 ? (
          <p className="text-sm text-muted">No open tasks.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.openTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                <div>
                  <p className="text-ink">{task.title}</p>
                  <p className="text-xs text-muted">
                    {task.dealName ?? "—"} · {task.assigneeName} · Due {task.dueDate}
                  </p>
                </div>
                <span className="rounded-token bg-raised px-1.5 py-0.5 text-xs font-medium text-muted">{TASK_PRIORITY_LABELS[task.priority]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">Contacts</h3>
        {summary.contacts.length === 0 ? (
          <p className="text-sm text-muted">No contacts linked yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.contacts.map((contact) => (
              <li key={contact.contactId} className="border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                <p className="text-ink">
                  {contact.firstName} {contact.lastName ?? ""}
                </p>
                <p className="text-xs text-muted">{contact.jobTitle ?? "—"}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {contact.dealLinks.map((link) => (
                    <li key={link.dealId} className="rounded-token bg-raised px-2 py-0.5 text-xs text-ink">
                      <Link href={`/deals/${link.dealId}`} prefetch={false} className="text-accent hover:underline">
                        {link.dealName}
                      </Link>
                      {" · "}
                      {DECISION_ROLE_LABELS[link.decisionRole]}
                      {link.isPrimary ? " · Primary" : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
