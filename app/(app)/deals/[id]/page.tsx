import Link from "next/link";
import { formatMoney } from "@/domain/money";
import { ACTIVITY_TYPE_LABELS } from "@/domain/activity";
import { formatLastEngaged, stalenessBand, type StalenessBand } from "@/domain/deal";
import { formatDateInTimezone, formatDurationSeconds, formatPlainDate } from "@/lib/dates";
import { getChangeOwnerContext, getCloseDealAvailability, getDealDetail, getDealForEditView } from "@/services/deals";
import { getSessionActor } from "@/services/actor";
import { canLogActivity, canRetractActivity } from "@/services/activities";
import { getActiveOutcomeReasons } from "@/services/outcomeReasons";
import { getDealContactsSection } from "@/services/contacts";
import { DECISION_ROLE_LABELS } from "@/domain/contact";
import { getEngagementTimeline, type TimelineFilters as TimelineFilterValues } from "@/services/engagementTimeline";
import { getAddTaskContext } from "@/services/tasks";
import { createClient } from "@/lib/supabase/server";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../../_access";
import { AddContactModal } from "./AddContactModal";
import { AddTaskModal } from "./AddTaskModal";
import { AttachmentLink } from "./AttachmentLink";
import { ChangeOwnerModal } from "./ChangeOwnerModal";
import { EditActivityModal } from "./EditActivityModal";
import { LogActivityModal } from "./LogActivityModal";
import { MarkLostModal } from "./MarkLostModal";
import { MarkWonModal } from "./MarkWonModal";
import { NextActionStrip } from "./NextActionStrip";
import { RetractActivityModal } from "./RetractActivityModal";
import { TimelineFilters } from "./TimelineFilters";

const STAGE_TYPE_LABEL: Record<string, string> = { open: "Open", won: "Won", lost: "Lost" };

// docs/06-ui-spec.md: "Never engaged" is red - the same red as the 46+ "cold" band (tailwind.config.ts:
// stale.cold and stale.never share no distinct token because the spec never asks for a fifth colour,
// only a fifth distinct STATE), so "never" maps onto the "cold" class rather than getting its own.
const STALENESS_CLASS: Record<StalenessBand, string> = {
  fresh: "text-stale-fresh",
  ok: "text-stale-ok",
  warn: "text-stale-warn",
  cold: "text-stale-cold",
  never: "text-stale-cold",
};

type SearchParams = { type?: string; author?: string };

export default async function DealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { allowed } = await checkRouteAccess("/deals");
  if (!allowed) return <DeniedState message="Pipeline is not available for your role." />;

  const { id } = await params;
  const rawParams = await searchParams;
  const timelineFilters: TimelineFilterValues = {
    type: rawParams.type ? (rawParams.type as TimelineFilterValues["type"]) : undefined,
    authorId: rawParams.author || undefined,
  };
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  const timezone = session.status === "active" ? session.timezone : "Africa/Lagos";

  // getDealDetail reads through this caller's own RLS-scoped session (migration 0005's
  // deals_select policy) - null means either the deal doesn't exist or this actor can't see it,
  // deliberately not distinguished (same reasoning as changeStage's not_found case). The
  // engagement timeline reads through the same session (activities_select/stage_events_select) -
  // if the deal itself is invisible to this actor, this comes back empty rather than erroring,
  // which the early return below makes moot anyway.
  const [deal, editView, timeline, canLog, canRetract, addTaskContext, closeAvailability, winReasons, lossReasons, changeOwnerContext] =
    await Promise.all([
      getDealDetail(supabase, id, timezone),
      session.status === "active" ? getDealForEditView(supabase, session.actor, id) : null,
      getEngagementTimeline(supabase, id, timelineFilters),
      session.status === "active" ? canLogActivity(supabase, session.actor, id) : false,
      session.status === "active" ? canRetractActivity(supabase, session.actor, id) : false,
      session.status === "active" ? getAddTaskContext(supabase, session.actor, id) : { canAddTask: false, assignableUsers: [] },
      session.status === "active" ? getCloseDealAvailability(supabase, session.actor, id) : { canMarkWon: false, canMarkLost: false },
      session.status === "active" ? getActiveOutcomeReasons(supabase, session.actor.tenantId, "win") : [],
      session.status === "active" ? getActiveOutcomeReasons(supabase, session.actor.tenantId, "loss") : [],
      session.status === "active" ? getChangeOwnerContext(supabase, session.actor, id) : { canChangeOwner: false, assignableOwners: [] },
    ]);
  const currentActorId = session.status === "active" ? session.actor.id : null;

  if (!deal) {
    return <EmptyState title="Deal not found" description="It may not exist, or isn't visible to your role." />;
  }

  // Depends on deal.stage.sortOrder (getDealContactsSection's currentStageSortOrder parameter -
  // src/services/contacts.ts), which isn't known until the deal itself has been fetched above, so
  // this can't join the Promise.all block those fetches share.
  const contactsSection =
    session.status === "active"
      ? await getDealContactsSection(supabase, session.actor, id, deal.stage.sortOrder)
      : { canAddContact: false, contacts: [], showSingleThreadingWarning: false, availableContacts: [] };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 rounded-token border border-line bg-raised p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-ink">{deal.name}</h1>
            <span className="rounded-token bg-surface px-2 py-0.5 text-xs font-medium text-muted">{deal.reference}</span>
            <span className="rounded-token bg-accent px-2 py-0.5 text-xs font-medium text-surface">{deal.stage.name}</span>
            {/* M4.4 (docs/07-build-backlog.md): "the next-action strip and the 'No next step' state
                on the deal header." */}
            <NextActionStrip
              dealId={deal.id}
              timezone={timezone}
              actorId={currentActorId ?? undefined}
              canAddTask={addTaskContext.canAddTask}
              assignableUsers={addTaskContext.assignableUsers}
              nextAction={deal.nextAction}
            />
            {/* M3.7 (docs/07-build-backlog.md): "Last-engaged chip on the deal header." */}
            <span className={`text-xs font-medium ${STALENESS_CLASS[stalenessBand(deal.daysSinceLastEngagement)]}`}>
              {formatLastEngaged(deal.daysSinceLastEngagement)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canLog ? (
              <LogActivityModal
                dealId={deal.id}
                timezone={timezone}
                actorId={currentActorId ?? undefined}
                canAddTask={addTaskContext.canAddTask}
                assignableUsers={addTaskContext.assignableUsers}
                contacts={contactsSection.contacts}
              />
            ) : null}
            {addTaskContext.canAddTask && currentActorId ? (
              <AddTaskModal dealId={deal.id} timezone={timezone} actorId={currentActorId} assignableUsers={addTaskContext.assignableUsers} />
            ) : null}
            {editView?.canEdit ? (
              <Link
                href={`/deals/${deal.id}/edit`}
                prefetch={false}
                className="rounded-token border border-line px-3 py-1.5 text-sm font-medium text-ink outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent"
              >
                Edit deal
              </Link>
            ) : null}
            {closeAvailability.canMarkWon ? (
              // editView is always non-null here: canMarkWon can only be true when the session is
              // active and this deal exists (getCloseDealAvailability's own not-found/status guard),
              // and getDealForEditView returns null only when the deal itself doesn't exist - the
              // "NGN" fallback is unreachable, kept only so this isn't a silent non-null assertion.
              <MarkWonModal dealId={deal.id} timezone={timezone} currencyCode={editView?.currencyCode ?? "NGN"} reasons={winReasons} />
            ) : null}
            {closeAvailability.canMarkLost ? <MarkLostModal dealId={deal.id} timezone={timezone} reasons={lossReasons} /> : null}
            {contactsSection.canAddContact ? (
              <AddContactModal dealId={deal.id} accountId={deal.account.id} availableContacts={contactsSection.availableContacts} />
            ) : null}
            {changeOwnerContext.canChangeOwner ? (
              <ChangeOwnerModal dealId={deal.id} timezone={timezone} assignableOwners={changeOwnerContext.assignableOwners} />
            ) : null}
          </div>
        </div>
        <p className="text-sm text-muted">{deal.account.name}</p>
      </header>

      {/* Deliberately no open-tasks list here - docs/06-ui-spec.md's full Deal detail spec includes
          an inline "Open tasks" list with per-row inline complete, which depends on M4.5 (the same
          milestone that builds My Work's own inline-complete interaction this list would otherwise
          duplicate ahead of time). Log Activity (M3.4), Add Task (M4.3), the next-action strip
          (M4.4), Edit Deal (M1.7), Mark Won/Lost (M5.3), the last-engaged chip (M3.7),
          Stakeholders/Add Contact (M5.6), contact attribution (M5.7) and Change Owner (M5.9) are
          what now exist; Advance Stage and Escalate are still missing (M2.2's board drag already
          moves stage; Escalate is M5+). Mark Won/Lost/Add Contact/Change Owner render as plain
          buttons, not "under a menu" the way docs/06-ui-spec.md's own line names it - Escalate
          doesn't exist yet either, and this codebase has no dropdown-menu primitive; building one
          for a handful of buttons ahead of Escalate actually needing it would be premature
          abstraction (CLAUDE.md #6). The engagement timeline below (M3.5/M3.6) supersedes M2.4's
          narrower stage-history-only panel, merging it with the activities this modal writes and,
          since M5.7, the contacts attributed to them. Otherwise this is the same read-only skeleton
          docs/07-build-backlog.md M1.6 asked for: header, financial summary, details, account. */}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
          <h2 className="text-sm font-semibold text-ink">Financial summary</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Proposal value</dt>
            <dd className="text-ink">{deal.proposalValue ? formatMoney(deal.proposalValue) : "—"}</dd>
            <dt className="text-muted">Negotiated value</dt>
            <dd className="text-ink">{deal.negotiatedValue ? formatMoney(deal.negotiatedValue) : "—"}</dd>
            <dt className="text-muted">Probability</dt>
            <dd className="text-ink">{deal.probability}%</dd>
            <dt className="text-muted">Weighted forecast</dt>
            <dd className="text-ink">{deal.weightedValue ? formatMoney(deal.weightedValue) : "—"}</dd>
            <dt className="text-muted">Forecast category</dt>
            <dd className="capitalize text-ink">{deal.forecastCategory.replace("_", " ")}</dd>
          </dl>
        </section>

        <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
          <h2 className="text-sm font-semibold text-ink">Details</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Owner</dt>
            <dd className="text-ink">{deal.ownerName ?? "Unowned"}</dd>
            <dt className="text-muted">Co-owners</dt>
            <dd className="text-ink">{deal.coOwnerNames.length ? deal.coOwnerNames.join(", ") : "—"}</dd>
            <dt className="text-muted">Author</dt>
            <dd className="text-ink">{deal.authorName}</dd>
            <dt className="text-muted">Practice line</dt>
            <dd className="text-ink">{deal.practiceLineName}</dd>
            <dt className="text-muted">Client type</dt>
            <dd className="capitalize text-ink">{deal.clientType}</dd>
            <dt className="text-muted">Status</dt>
            <dd className="capitalize text-ink">{deal.status.replace("_", " ")}</dd>
            <dt className="text-muted">Stage type</dt>
            <dd className="text-ink">{STAGE_TYPE_LABEL[deal.stage.stageType] ?? deal.stage.stageType}</dd>
            <dt className="text-muted">Expected close</dt>
            <dd className="text-ink">{deal.expectedCloseDate ?? "—"}</dd>
            <dt className="text-muted">Actual close</dt>
            <dd className="text-ink">{deal.actualCloseDate ?? "—"}</dd>
          </dl>
          {deal.brief ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted">Brief</p>
              <p className="text-sm text-ink">{deal.brief}</p>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6 md:col-span-2">
          <h2 className="text-sm font-semibold text-ink">Account</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
            <dt className="text-muted">Name</dt>
            <dd className="text-ink">{deal.account.name}</dd>
            <dt className="text-muted">Industry</dt>
            <dd className="text-ink">{deal.account.industry ?? "—"}</dd>
            <dt className="text-muted">Region</dt>
            <dd className="text-ink">{deal.account.region ?? "—"}</dd>
          </dl>
        </section>
      </div>

      {/* M5.6 (docs/07-build-backlog.md): "Contact management on the deal with decision-role
          badges; single-threading warning past Discovery." Add-only for now (docs/DECISIONS.md's
          D-14) - contact cards are read-only display, no edit/remove action, matching
          migration 0018's own insert-only deal_contacts schema. lastEngagedAt now has a real write
          path (M5.7's migration 0019: attributing a contact to a client-facing activity updates it
          transactionally) - it still renders "Never engaged" for any contact never attributed to
          one, the same "null is not zero, never engaged is a real distinct state" reasoning
          formatLastEngaged's own comment already gives at the deal level. showSingleThreadingWarning
          uses isPastFirstOpenStage's own ⚠ unconfirmed default for what "past Discovery" means
          (src/domain/deal.ts's own comment, docs/DECISIONS.md's D-13) - confirm or replace with the
          product owner before relying on it. */}
      <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
        <h2 className="text-sm font-semibold text-ink">Stakeholders</h2>

        {contactsSection.showSingleThreadingWarning ? (
          <p role="alert" className="rounded-token border border-risk bg-risk/10 px-3 py-2 text-sm text-risk">
            Single-threaded: fewer than two contacts are engaged on this deal.
          </p>
        ) : null}

        {contactsSection.contacts.length === 0 ? (
          <p className="text-sm text-muted">No contacts linked yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {contactsSection.contacts.map((contact) => (
              <li
                key={contact.contactId}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0"
              >
                <div>
                  <p className="text-ink">
                    {contact.firstName} {contact.lastName ?? ""}
                    {contact.isPrimary ? (
                      <span className="ml-2 rounded-token bg-accent px-1.5 py-0.5 text-xs font-medium text-surface">Primary</span>
                    ) : null}
                    <span className="ml-2 rounded-token bg-raised px-1.5 py-0.5 text-xs font-medium text-muted">
                      {DECISION_ROLE_LABELS[contact.decisionRole]}
                    </span>
                  </p>
                  <p className="text-xs text-muted">{contact.jobTitle ?? "—"}</p>
                </div>
                <p className="text-xs text-muted">{contact.lastEngagedAt ? formatDateInTimezone(contact.lastEngagedAt, timezone) : "Never engaged"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* M3.5/M3.6 (docs/07-build-backlog.md): "Engagement timeline component merging activities
          and stage events, newest first, with type and author filters and a designed empty state
          ... edited marker with revision history ... retracted entries appear struck through with
          the reason, never removed." M5.7 adds the "attributed contacts" field docs/06-ui-spec.md's
          full description names - the only remaining gap against that spec is "Type icon", which
          renders as a text label since no icon system exists in this codebase yet. */}
      <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Engagement timeline</h2>
          <TimelineFilters dealId={deal.id} values={rawParams} authors={timeline.availableAuthors} />
        </div>

        {timeline.entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="font-medium text-ink">No engagement logged yet</p>
            <p className="text-sm text-muted">Log the first conversation.</p>
            {canLog ? (
              <div className="mt-2">
                <LogActivityModal
                  dealId={deal.id}
                  timezone={timezone}
                  actorId={currentActorId ?? undefined}
                  canAddTask={addTaskContext.canAddTask}
                  assignableUsers={addTaskContext.assignableUsers}
                  contacts={contactsSection.contacts}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {timeline.entries.map((entry) =>
              entry.kind === "stage_change" ? (
                <li
                  key={`stage-${entry.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0"
                >
                  <div>
                    <p className="text-ink">
                      <span className="mr-2 rounded-token bg-raised px-1.5 py-0.5 text-xs font-medium text-muted">Stage change</span>
                      {entry.fromStageName ? `${entry.fromStageName} → ${entry.toStageName}` : entry.toStageName}
                      {entry.isRegression ? (
                        <span className="ml-2 rounded-token bg-risk px-1.5 py-0.5 text-xs text-surface">Regression</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">
                      {entry.actorName ?? "System"} · {formatDateInTimezone(entry.occurredAt, timezone)}
                      {entry.isReconstructed ? " · reconstructed" : ""}
                    </p>
                  </div>
                  <p className="text-xs text-muted">
                    {entry.durationInPreviousSeconds === null
                      ? "—"
                      : `${formatDurationSeconds(entry.durationInPreviousSeconds)} in previous stage`}
                  </p>
                </li>
              ) : (
                <li
                  key={`activity-${entry.id}`}
                  className="flex flex-col gap-1 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0"
                >
                  <p className={`text-ink ${entry.retractedAt ? "line-through" : ""}`}>
                    <span className="mr-2 rounded-token bg-accent px-1.5 py-0.5 text-xs font-medium text-surface">
                      {ACTIVITY_TYPE_LABELS[entry.type]}
                    </span>
                    {entry.summary}
                    {entry.revisions.length > 0 ? (
                      <span className="ml-2 rounded-token bg-raised px-1.5 py-0.5 text-xs font-medium text-muted">edited</span>
                    ) : null}
                  </p>
                  <p className={`text-xs text-muted ${entry.retractedAt ? "line-through" : ""}`}>
                    {entry.authorName ?? "Unknown"} · {formatPlainDate(entry.activityDate)}
                    {entry.outcome ? ` · ${entry.outcome}` : ""}
                    {entry.outcomeDisposition ? ` (${entry.outcomeDisposition.replace("_", " ")})` : ""}
                  </p>

                  {/* M5.7 (docs/07-build-backlog.md): "Activity attribution to contacts" - the
                      timeline's own "attributed contacts" field (docs/06-ui-spec.md). */}
                  {entry.attributedContacts.length > 0 ? (
                    <p className="text-xs text-muted">
                      With: {entry.attributedContacts.map((c) => `${c.firstName} ${c.lastName ?? ""}`.trim()).join(", ")}
                    </p>
                  ) : null}

                  {entry.retractedAt ? (
                    <p className="text-xs text-lost">
                      Retracted by {entry.retractedByName ?? "Unknown"}
                      {entry.retractionReason ? `: ${entry.retractionReason}` : ""}
                    </p>
                  ) : null}

                  {entry.revisions.length > 0 ? (
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer select-none">Revision history</summary>
                      <ul className="mt-1 flex flex-col gap-1 pl-3">
                        {entry.revisions.map((rev) => (
                          <li key={rev.id}>
                            {rev.fieldName}: “{rev.previousValue ?? "—"}” → “{rev.newValue ?? "—"}” · {rev.changedByName ?? "Unknown"} ·{" "}
                            {formatDateInTimezone(rev.changedAt, timezone)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  {entry.attachments.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-3">
                      {entry.attachments.map((doc) => (
                        <AttachmentLink key={doc.id} documentId={doc.id} fileName={doc.fileName} />
                      ))}
                    </div>
                  ) : null}

                  {!entry.retractedAt ? (
                    <div className="flex items-center gap-3">
                      {currentActorId === entry.authorId && new Date() < new Date(entry.editLockedAt) ? (
                        <EditActivityModal
                          activity={{
                            id: entry.id,
                            type: entry.type,
                            activityDate: entry.activityDate,
                            summary: entry.summary,
                            outcome: entry.outcome,
                            outcomeDisposition: entry.outcomeDisposition,
                          }}
                        />
                      ) : null}
                      {canRetract ? <RetractActivityModal activityId={entry.id} /> : null}
                    </div>
                  ) : null}
                </li>
              ),
            )}
          </ol>
        )}
      </section>
    </div>
  );
}
