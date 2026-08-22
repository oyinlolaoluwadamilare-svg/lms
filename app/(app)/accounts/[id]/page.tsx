import Link from "next/link";
import { ACTIVITY_TYPE_LABELS } from "@/domain/activity";
import { DECISION_ROLE_LABELS } from "@/domain/contact";
import { formatLastEngaged } from "@/domain/deal";
import { formatMoney } from "@/domain/money";
import { dateInTimezone, daysSincePlainDate, formatDateInTimezone, formatPlainDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { getAccount360 } from "@/services/accounts";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../../_access";
import { PipelineTable } from "../../deals/PipelineTable";
import { AccountTabs } from "./AccountTabs";
import { AttachmentLink } from "../../deals/[id]/AttachmentLink";

// M5.8 (docs/07-build-backlog.md): "Account 360 screen, showing each practice-line relationship
// with its own owner (D-03)." Reuses the deal detail page's own "detail pages reuse the parent list
// route's nav check" precedent (checkRouteAccess("/accounts"), not a per-record href) - the same
// shape app/(app)/deals/[id]/page.tsx already establishes.
export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { allowed } = await checkRouteAccess("/accounts");
  if (!allowed) return <DeniedState message="Accounts is not available for your role." />;

  const { id } = await params;
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  const timezone = session.status === "active" ? session.timezone : "Africa/Lagos";

  const account = await getAccount360(supabase, id, timezone);
  if (!account) {
    return <EmptyState title="Account not found" description="It may not exist, or isn't visible to your role." />;
  }

  const today = dateInTimezone(new Date().toISOString(), timezone);
  const daysSinceLastEngagement = account.tiles.lastEngagedAt ? daysSincePlainDate(account.tiles.lastEngagedAt, today) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-ink">{account.name}</h1>
          {account.industry ? <span className="rounded-token bg-surface px-2 py-0.5 text-xs font-medium text-muted">{account.industry}</span> : null}
          {account.region ? <span className="rounded-token bg-surface px-2 py-0.5 text-xs font-medium text-muted">{account.region}</span> : null}
        </div>
        {account.parentAccountName ? <p className="text-sm text-muted">Part of {account.parentAccountName}</p> : null}

        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">Owner{account.practiceLineOwners.length === 1 ? "" : "s"} by practice line</p>
          {account.practiceLineOwners.length === 0 ? (
            <p className="text-sm text-muted">No practice-line relationship recorded yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-3 text-sm text-ink">
              {account.practiceLineOwners.map((po) => (
                <li key={po.practiceLineId} className="rounded-token bg-surface px-2.5 py-1">
                  <span className="text-muted">{po.practiceLineName}:</span> {po.ownerName}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Open pipeline" value={account.tiles.openPipelineValue} />
        <Tile label="Won revenue" value={account.tiles.wonRevenue} />
        <div className="flex flex-col gap-1 rounded-token border border-line bg-raised p-4">
          <p className="text-xs font-medium text-muted">Active deals</p>
          <p className="text-lg font-semibold text-ink">{account.tiles.activeDealsCount}</p>
        </div>
        <div className="flex flex-col gap-1 rounded-token border border-line bg-raised p-4">
          <p className="text-xs font-medium text-muted">Last engagement</p>
          <p className={`text-lg font-semibold ${daysSinceLastEngagement === null ? "text-lost" : "text-ink"}`}>
            {formatLastEngaged(daysSinceLastEngagement)}
          </p>
        </div>
      </div>

      <AccountTabs
        tabs={[
          {
            label: "Deals",
            content:
              account.deals.length === 0 ? (
                <EmptyState title="No deals yet" description="Deals on this account will appear here." />
              ) : (
                <PipelineTable deals={account.deals} />
              ),
          },
          {
            label: "Contacts",
            content:
              account.contacts.length === 0 ? (
                <EmptyState title="No contacts yet" description="Contacts on this account will appear here." />
              ) : (
                <ul className="flex flex-col gap-3">
                  {account.contacts.map((contact) => (
                    <li key={contact.contactId} className="rounded-token border border-line bg-raised p-4">
                      <p className="font-medium text-ink">
                        {contact.firstName} {contact.lastName ?? ""}
                      </p>
                      <p className="text-xs text-muted">{contact.jobTitle ?? "—"}</p>
                      {contact.dealLinks.length === 0 ? (
                        <p className="mt-2 text-xs text-muted">Not yet linked to a deal.</p>
                      ) : (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {contact.dealLinks.map((link) => (
                            <li key={link.dealId} className="rounded-token bg-surface px-2 py-0.5 text-xs text-ink">
                              <Link href={`/deals/${link.dealId}`} prefetch={false} className="text-accent hover:underline">
                                {link.dealName}
                              </Link>
                              {" · "}
                              {DECISION_ROLE_LABELS[link.decisionRole]}
                              {link.isPrimary ? " · Primary" : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            label: "Merged timeline",
            content:
              account.timeline.length === 0 ? (
                <EmptyState title="No engagement logged yet" description="Activities and stage changes across this account's deals will appear here." />
              ) : (
                <ol className="flex flex-col gap-2">
                  {account.timeline.map((entry) =>
                    entry.kind === "activity" ? (
                      <li key={`activity-${entry.id}`} className="flex flex-col gap-1 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                        <p className={`text-ink ${entry.retractedAt ? "line-through" : ""}`}>
                          <span className="mr-2 rounded-token bg-accent px-1.5 py-0.5 text-xs font-medium text-surface">
                            {ACTIVITY_TYPE_LABELS[entry.type]}
                          </span>
                          {entry.summary}
                        </p>
                        <p className="text-xs text-muted">
                          <Link href={`/deals/${entry.dealId}`} prefetch={false} className="text-accent hover:underline">
                            {entry.dealName}
                          </Link>
                          {" · "}
                          {entry.authorName ?? "Unknown"} · {formatPlainDate(entry.activityDate)}
                        </p>
                      </li>
                    ) : (
                      <li key={`stage-${entry.id}`} className="flex flex-col gap-1 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                        <p className="text-ink">
                          <span className="mr-2 rounded-token bg-raised px-1.5 py-0.5 text-xs font-medium text-muted">Stage change</span>
                          {entry.fromStageName ? `${entry.fromStageName} → ${entry.toStageName}` : entry.toStageName}
                        </p>
                        <p className="text-xs text-muted">
                          <Link href={`/deals/${entry.dealId}`} prefetch={false} className="text-accent hover:underline">
                            {entry.dealName}
                          </Link>
                          {" · "}
                          {entry.actorName ?? "System"} · {formatDateInTimezone(entry.occurredAt, timezone)}
                        </p>
                      </li>
                    ),
                  )}
                </ol>
              ),
          },
          {
            label: "Documents",
            content:
              account.documents.length === 0 ? (
                <EmptyState title="No documents yet" description="Files attached to this account's deals will appear here." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {account.documents.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                      <AttachmentLink documentId={doc.id} fileName={doc.fileName} />
                      <span className="text-xs text-muted">{doc.uploadedByName ?? "Unknown"} · {formatDateInTimezone(doc.createdAt, timezone)}</span>
                    </li>
                  ))}
                </ul>
              ),
          },
        ]}
      />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: Array<{ amountMinor: bigint; currency: string }> }) {
  return (
    <div className="flex flex-col gap-1 rounded-token border border-line bg-raised p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      {value.length === 0 ? (
        <p className="text-lg font-semibold text-ink">—</p>
      ) : (
        value.map((money) => (
          <p key={money.currency} className="text-lg font-semibold text-ink">
            {formatMoney(money)}
          </p>
        ))
      )}
    </div>
  );
}
