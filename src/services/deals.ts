import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import { listAccounts } from "@/data/accounts";
import { listDealCoOwnerIds } from "@/data/dealCoOwners";
import { getUserByAuthId, listAssignableUsersForPractice, type AssignableUser } from "@/data/users";
// Re-exported so app/(app) only needs to import from this module - app may not import src/data
// directly (eslint.config.mjs boundaries), including for types.
export type { AssignableUser };
import { getHandoverSummary, type HandoverSummary } from "@/services/handover";
import {
  applyDealEdit,
  countDealsWithoutNextAction,
  DealReferenceConflictError,
  getDealDetail as getDealDetailRow,
  getDealForEdit,
  getDealForAuthorization,
  insertDeal,
  listDeals,
  nextDealReference,
  updateDealOwner,
  updateDealStage,
  type DealDetail,
  type DealEditFields,
  type DealListFilters,
  type DealListRow,
  type InsertedDeal,
} from "@/data/deals";
// Re-exported so app/(app)/deals only needs to import from this module - app may not import
// src/data directly (eslint.config.mjs boundaries), including for types.
export type { DealDetail, DealListFilters, DealListRow };
import { listPracticeLines } from "@/data/practiceLines";
import { getStageById, listAllStages, listOpenStages, type PipelineStageOption } from "@/data/pipelineStages";
// Re-exported for the same reason as DealListFilters/DealListRow above.
export type { PipelineStageOption };
import { listActiveUsersInTenant } from "@/data/users";
import { getOutcomeReasonById, type OutcomeType } from "@/data/outcomeReasons";
import { writeAudit } from "@/services/audit";
import { writeStageEvent } from "@/services/stageEvents";
import type { AppUser } from "@/domain/user";
import { isOpenStage, type ClientType } from "@/domain/deal";

export interface CreateDealInput {
  name: string;
  accountId: string;
  practiceLineId: string;
  stageId: string;
  clientType: ClientType;
  ownerId: string;
  expectedCloseDate: string; // YYYY-MM-DD
  proposalValueMinor: bigint | null;
  currencyCode: string;
  brief: string | null;
}

export type CreateDealResult =
  | { ok: true; deal: InsertedDeal }
  | { ok: false; code: "denied" | "reference_conflict" };

const MAX_REFERENCE_ATTEMPTS = 5;

// The single path for creating a deal (docs/03-architecture.md's single-path philosophy). Two
// things this function - not the caller - decides unconditionally:
//
// 1. authorId is always actor.id. There is no parameter for a different author anywhere in this
//    function or in src/data/deals.ts's NewDealInput - that is what makes "the Unknown Author
//    state must be unrepresentable" (docs/07-build-backlog.md M1.3) actually true structurally,
//    rather than merely checked at validation time.
// 2. can() is checked here even though RLS's deals_insert policy (migration 0005) enforces the
//    same practice/tenant scope independently. CLAUDE.md #1: RLS is a second, independent control,
//    not the only one - checking here first turns a denial into a clean result this function
//    returns, rather than an RLS error bubbling up from the database.
export async function createDeal(
  supabase: SupabaseClient,
  actor: Actor,
  input: CreateDealInput,
): Promise<CreateDealResult> {
  if (!can(actor, "deal.create", { tenantId: actor.tenantId, practiceLineId: input.practiceLineId })) {
    return { ok: false, code: "denied" };
  }

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
    const reference = await nextDealReference(supabase, actor.tenantId);

    try {
      const deal = await insertDeal(supabase, {
        tenantId: actor.tenantId,
        reference,
        name: input.name,
        accountId: input.accountId,
        practiceLineId: input.practiceLineId,
        stageId: input.stageId,
        clientType: input.clientType,
        ownerId: input.ownerId,
        authorId: actor.id,
        expectedCloseDate: input.expectedCloseDate,
        proposalValueMinor: input.proposalValueMinor,
        currencyCode: input.currencyCode,
        brief: input.brief,
      });

      // CLAUDE.md #6: every state change writes an audit row, no exceptions. Disclosed gap: this
      // is not a single atomic transaction with the insert above - PostgREST has no client-side
      // multi-statement transaction, and audit_entries can only ever be written via the
      // service_role client (db/schema.sql), never the caller's own RLS-scoped session. If this
      // throws, the deal row above already exists, un-audited. That is a known limitation of the
      // current Supabase-client architecture (see src/services/audit.ts's own notes), surfaced
      // here as a thrown error - not silently swallowed - rather than a true rollback, which
      // deals' RLS (no delete policy, by design - CLAUDE.md #3) does not make possible anyway.
      await writeAudit({
        tenantId: actor.tenantId,
        actorId: actor.id,
        entityType: "deal",
        entityId: deal.id,
        action: "deal.create",
        after: { reference: deal.reference, name: input.name, ownerId: input.ownerId },
      });

      return { ok: true, deal };
    } catch (err) {
      if (err instanceof DealReferenceConflictError) continue;
      throw err;
    }
  }

  return { ok: false, code: "reference_conflict" };
}

export interface CreateDealFormOptions {
  accounts: Array<{ id: string; name: string }>;
  practiceLines: Array<{ id: string; name: string }>;
  stages: PipelineStageOption[];
  owners: Array<Pick<AppUser, "id" | "fullName" | "email">>;
}

// Bundles the picker data the create-deal form needs (each individually RLS-scoped to the
// caller's session) so app/(app)/deals/new/page.tsx doesn't import src/data directly - app may
// only reach data through services (eslint.config.mjs boundaries).
export async function getCreateDealFormOptions(supabase: SupabaseClient): Promise<CreateDealFormOptions> {
  const [accounts, practiceLines, stages, owners] = await Promise.all([
    listAccounts(supabase),
    listPracticeLines(supabase),
    listOpenStages(supabase),
    listActiveUsersInTenant(supabase),
  ]);

  return { accounts, practiceLines, stages, owners };
}

export interface PipelineFilterOptions {
  accounts: Array<{ id: string; name: string }>;
  practiceLines: Array<{ id: string; name: string }>;
  stages: PipelineStageOption[];
  owners: Array<Pick<AppUser, "id" | "fullName" | "email">>;
}

// Bundles the pipeline table's filter dropdown data - unlike getCreateDealFormOptions, stages here
// cover every stage type (won/lost included), since the table must be able to show and filter by a
// deal's actual current stage, not only the stages a deal could be created into.
export async function getPipelineFilterOptions(supabase: SupabaseClient): Promise<PipelineFilterOptions> {
  const [accounts, practiceLines, stages, owners] = await Promise.all([
    listAccounts(supabase),
    listPracticeLines(supabase),
    listAllStages(supabase),
    listActiveUsersInTenant(supabase),
  ]);

  return { accounts, practiceLines, stages, owners };
}

// Passthrough so app/(app)/deals/page.tsx doesn't import src/data directly (app may only reach
// data through services). No extra business logic belongs here: RLS's deals_select policy already
// is the authorisation boundary for reads (CLAUDE.md #1's "server-side authorisation always" is
// satisfied by the database itself for this action, the same way every other list/detail read in
// this app is - there is no separate can() check for deal.view the way deal.create has one, since
// unlike a write there is no "resource that doesn't exist yet" to check against).
export async function listPipelineDeals(
  supabase: SupabaseClient,
  filters: DealListFilters,
  timezone: string,
): Promise<DealListRow[]> {
  return listDeals(supabase, filters, timezone);
}

// M4.7's dashboard tile passthrough - same reasoning as listPipelineDeals above: RLS is the whole
// authorisation boundary for this read, so there is nothing for a service-layer can() check to add.
export async function countActiveDealsWithoutNextAction(supabase: SupabaseClient): Promise<number> {
  return countDealsWithoutNextAction(supabase);
}

export type ChangeStageResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "denied" | "same_stage" | "target_is_closing_stage" };

// The single path for moving a deal's stage (docs/03-architecture.md's single-path rule: "the only
// way a deal's stage changes... No caller updates deals.stage_id directly, ever"). Called by the
// board drag today; the edit form (M1.7), bulk actions and the API must route through this too when
// they exist, per that same rule.
//
// Two things this function decides unconditionally, the same way createDeal pins authorId:
// 1. can() is checked here even though RLS's deals_update policy (migration 0005) enforces the same
//    scope independently (CLAUDE.md #1 - a second, independent control, not the only one).
// 2. The target stage must be an "open" stage_type. Moving a deal into a won/lost stage is the
//    exclusive job of closeDeal (docs/07-build-backlog.md M5.2, below in this file), which requires an
//    outcome reason this function has no way to collect or enforce - see isOpenStage's comment in
//    src/domain/deal.ts. Rejecting here, not merely declining to render a drop target in the UI, is
//    what makes this a real control and not presentation-only (CLAUDE.md #1).
//
// Known gap, same one src/services/audit.ts's own comment already flags for every compound write in
// this Supabase-client architecture: the deal update, the stage_events write and the audit write
// below are three separate calls, not one transaction. If either write below throws, the stage has
// already changed, incompletely recorded. The Postgres-function-backed atomic writer that comment
// calls for is the real fix; not built yet.
//
// M2.1/M2.2 (docs/07-build-backlog.md): this is the one and only place a stage_events row is
// written, per docs/01-domain-model.md's "there must be exactly one code path that moves a stage."
// M2.2 also names five other transition paths this same function must serve - edit form, API, bulk
// action, mark-won, mark-lost - so every stage change writes exactly one event: none of those five
// exist in this codebase yet (the edit form, M1.7, deliberately excludes stage; there is no API or
// bulk-action surface; mark-won/mark-lost belong to closeDeal, M5.2, below in this file). Board drag (this
// function) is the only real transition path today, and the only one actually exercised by
// tests/integration/pipeline-list.spec.ts's stage_events assertions - each future path is required
// to route through this same changeStage, not to reimplement any part of it.
export async function changeStage(
  supabase: SupabaseClient,
  actor: Actor,
  dealId: string,
  toStageId: string,
): Promise<ChangeStageResult> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal) return { ok: false, code: "not_found" };

  const coOwnerIds = await listDealCoOwnerIds(supabase, dealId);
  const resource = {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  };
  if (!can(actor, "deal.change_stage", resource)) {
    return { ok: false, code: "denied" };
  }

  if (toStageId === deal.stageId) {
    return { ok: false, code: "same_stage" };
  }

  const toStage = await getStageById(supabase, toStageId);
  if (!toStage || toStage.tenantId !== actor.tenantId) {
    return { ok: false, code: "not_found" };
  }
  if (!isOpenStage(toStage.stageType)) {
    return { ok: false, code: "target_is_closing_stage" };
  }

  await updateDealStage(supabase, dealId, toStageId);

  await writeStageEvent({
    tenantId: actor.tenantId,
    dealId,
    fromStageId: deal.stageId,
    toStageId,
    actorId: actor.id,
  });

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "deal",
    entityId: dealId,
    action: "deal.change_stage",
    before: { stageId: deal.stageId },
    after: { stageId: toStageId },
  });

  return { ok: true };
}

export interface ChangeOwnerContext {
  canChangeOwner: boolean;
  assignableOwners: AssignableUser[];
}

// For the deal detail page to decide whether to show the "Change Owner" trigger, and if so, what
// to populate its scope-filtered owner picker with - one round trip, the same bundled-boolean-plus-
// picker-data shape getAddTaskContext already establishes (src/services/tasks.ts). The current
// owner is excluded from the picker - reassigning a deal to its own current owner isn't a
// reassignment, the same "same_owner" case changeDealOwner itself rejects below.
export async function getChangeOwnerContext(supabase: SupabaseClient, actor: Actor, dealId: string): Promise<ChangeOwnerContext> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal) return { canChangeOwner: false, assignableOwners: [] };

  const canChangeOwner = can(actor, "deal.change_owner", { tenantId: deal.tenantId, practiceLineId: deal.practiceLineId });
  if (!canChangeOwner) return { canChangeOwner: false, assignableOwners: [] };

  const eligibleOwners = await listAssignableUsersForPractice(supabase, deal.tenantId, deal.practiceLineId);
  return { canChangeOwner: true, assignableOwners: eligibleOwners.filter((u) => u.id !== deal.ownerId) };
}

export type ChangeDealOwnerResult =
  | { ok: true; handover: HandoverSummary }
  | { ok: false; code: "not_found" | "denied" | "same_owner" | "invalid_owner" };

// The single path for changing a deal's owner (docs/07-build-backlog.md M5.9: "Handover panel...
// shown on owner change"). No "own" token in deal.change_owner's own scope (docs/02-permission-
// matrix.md: -/practice/practice/-/tenant) - a bde cannot reassign a deal's owner even if it's
// their own deal, the same reasoning updateDeal's own comment already gives for treating owner as
// structurally out of plain deal.update's reach. The resource passed to can() is therefore just
// {tenantId, practiceLineId}, not the own/authorId/coOwnerIds shape changeStage/logActivity build -
// there is no "own" case here to match against.
//
// Mirrors assignTask's exact validation shape (src/services/tasks.ts): same_owner before the
// real-user check (a bogus id could never be "the same owner" OR "a different one" - it isn't
// anyone), then a data-integrity check (real, same-tenant user) before the business-scope
// re-check (actually eligible in this deal's own practice) - a cross-tenant or nonexistent id is a
// different kind of wrong than a real user in the wrong practice, and the result codes say so.
//
// On success, returns the M5.9 handover summary for this one deal directly - the caller (the
// Change Owner modal) needs it immediately to show "what's being handed off," not as a second
// round trip. Known gap, same tier every compound write in this Supabase-client architecture
// already accepts: the owner update and the audit write are two separate calls, not one
// transaction.
export async function changeDealOwner(supabase: SupabaseClient, actor: Actor, dealId: string, newOwnerId: string): Promise<ChangeDealOwnerResult> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal) return { ok: false, code: "not_found" };

  if (!can(actor, "deal.change_owner", { tenantId: deal.tenantId, practiceLineId: deal.practiceLineId })) {
    return { ok: false, code: "denied" };
  }

  if (newOwnerId === deal.ownerId) return { ok: false, code: "same_owner" };

  const newOwner = await getUserByAuthId(supabase, newOwnerId);
  if (!newOwner || newOwner.tenantId !== deal.tenantId) {
    return { ok: false, code: "invalid_owner" };
  }

  const eligibleOwners = await listAssignableUsersForPractice(supabase, deal.tenantId, deal.practiceLineId);
  if (!eligibleOwners.some((user) => user.id === newOwnerId)) {
    return { ok: false, code: "invalid_owner" };
  }

  const previousOwnerId = deal.ownerId;
  await updateDealOwner(supabase, dealId, newOwnerId);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "deal",
    entityId: dealId,
    action: "deal.change_owner",
    before: { ownerId: previousOwnerId },
    after: { ownerId: newOwnerId },
  });

  const handover = await getHandoverSummary(supabase, [dealId], new Map([[dealId, deal.name]]));
  return { ok: true, handover };
}

export interface CloseDealInput {
  result: OutcomeType;
  reasonId: string;
  reasonDetail: string | null;
  competitorName: string | null;
  finalValueMinor: bigint | null;
  currencyCode: string | null;
  actualCloseDate: string; // YYYY-MM-DD
}

export type CloseDealResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "not_found"
        | "denied"
        | "already_closed"
        | "reason_not_found"
        | "reason_type_mismatch"
        | "loss_requires_detail"
        | "competitor_name_required";
    };

// M5.2 (docs/07-build-backlog.md): "`closeDeal` service: atomic outcome, stage event, status,
// open-task cancellation, audit. Closing is impossible without a reason; loss requires detail;
// lost-to-competitor requires a name." The exclusive way a deal ever reaches won/lost - changeStage
// above refuses a won/lost target stage precisely so this is the only door in (isOpenStage's
// comment in src/domain/deal.ts).
//
// Unlike changeStage/createDeal, this is not several sequential Supabase-client calls with a
// disclosed non-atomicity gap: migration 0017's close_deal is a single `security definer` Postgres
// function, invoked here through one .rpc() call, wrapping the deal update, the stage_events
// insert, the deal_outcomes insert, open-task cancellation and the audit_entries insert in one real
// transaction - the first genuinely atomic compound write in this codebase (see that migration's
// own header comment for the reasoning). There is no separate writeStageEvent/writeAudit call here;
// the RPC is both.
//
// Every check below duplicates one the RPC itself also performs (reason tenant/type match, loss
// detail, competitor name) - the same "TS can() is the real gate, the privileged write repeats it
// as a non-bypassable backstop" split this codebase already uses for writeStageEvent/writeAudit/
// sweep_overdue_tasks. Checking here first turns what would otherwise be a raw Postgres exception
// into a clean CloseDealResult code the UI (M5.3, not built yet) can render.
export async function closeDeal(
  supabase: SupabaseClient,
  actor: Actor,
  dealId: string,
  input: CloseDealInput,
): Promise<CloseDealResult> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal) return { ok: false, code: "not_found" };

  if (deal.status === "won" || deal.status === "lost") {
    return { ok: false, code: "already_closed" };
  }

  const coOwnerIds = await listDealCoOwnerIds(supabase, dealId);
  const resource = {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  };
  if (!can(actor, input.result === "win" ? "deal.mark_won" : "deal.mark_lost", resource)) {
    return { ok: false, code: "denied" };
  }

  const reason = await getOutcomeReasonById(supabase, input.reasonId);
  if (!reason) return { ok: false, code: "reason_not_found" };
  if (reason.type !== input.result) return { ok: false, code: "reason_type_mismatch" };
  if (input.result === "loss" && (input.reasonDetail ?? "").trim().length === 0) {
    return { ok: false, code: "loss_requires_detail" };
  }
  if (reason.requiresCompetitorName && (input.competitorName ?? "").trim().length === 0) {
    return { ok: false, code: "competitor_name_required" };
  }

  // bigint params travel as strings over PostgREST, same as every other minor-units column write in
  // this codebase (src/data/deals.ts's applyDealEdit does the same .toString() before an insert).
  const { error } = await supabase.rpc("close_deal", {
    p_deal_id: dealId,
    p_result: input.result,
    p_reason_id: input.reasonId,
    p_reason_detail: input.reasonDetail,
    p_competitor_name: input.competitorName,
    p_final_value_minor: input.finalValueMinor === null ? null : input.finalValueMinor.toString(),
    p_currency_code: input.currencyCode,
    p_actual_close_date: input.actualCloseDate,
  });
  if (error) throw new Error(`closeDeal failed: ${error.message}`);

  return { ok: true };
}

export interface CloseDealAvailability {
  canMarkWon: boolean;
  canMarkLost: boolean;
}

// For the deal detail page (M5.3) to decide whether to render the Mark Won/Mark Lost buttons at
// all - the same canLogActivity/canRetractActivity shape src/services/activities.ts already
// established (compute once per deal, boolean-gated visibility, false rather than an error for a
// deal that doesn't exist or isn't visible to this actor). Mirrors closeDeal's own "already_closed"
// guard - a won/lost deal offers neither button, since closeDeal would reject both anyway - but
// deliberately does NOT restrict this to status === "active" only: an on_hold deal is not yet
// closed either, and closeDeal's own pre-check (deal.status === "won" || "lost") already treats
// on_hold the same as active, so the buttons' visibility must match what the service underneath
// actually allows, not a narrower guess.
export async function getCloseDealAvailability(supabase: SupabaseClient, actor: Actor, dealId: string): Promise<CloseDealAvailability> {
  const deal = await getDealForAuthorization(supabase, dealId);
  if (!deal || deal.status === "won" || deal.status === "lost") {
    return { canMarkWon: false, canMarkLost: false };
  }

  const coOwnerIds = await listDealCoOwnerIds(supabase, dealId);
  const resource = {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  };
  return {
    canMarkWon: can(actor, "deal.mark_won", resource),
    canMarkLost: can(actor, "deal.mark_lost", resource),
  };
}

// Passthrough so app/(app)/deals/[id]/page.tsx doesn't import src/data directly. No separate can()
// check here, same reasoning as listPipelineDeals: migration 0005's deals_select RLS policy is
// this read's authorisation boundary, and getDealDetail already reads through the caller's own
// session, not a service-role client.
export async function getDealDetail(supabase: SupabaseClient, dealId: string, timezone: string): Promise<DealDetail | null> {
  return getDealDetailRow(supabase, dealId, timezone);
}

export interface EditDealInput {
  name: string;
  clientType: ClientType;
  expectedCloseDate: string; // YYYY-MM-DD
  proposalValueMinor: bigint | null;
  negotiatedValueMinor: bigint | null;
  brief: string | null;
}

export type UpdateDealResult = { ok: true } | { ok: false; code: "not_found" | "denied" };

// The single path for editing a deal's plain-update fields (docs/07-build-backlog.md M1.7).
// Deliberately scoped to what deal.update covers - see the comment on src/data/deals.ts's
// DealForEdit for the three fields (owner, co-owners, forecast_category) this does NOT touch,
// each gated by its own distinct permission action.
//
// "Audit entries on every field change" (M1.7's exit criteria) is implemented as a single audit
// row per edit whose before/after only contain the fields that actually changed, not the whole
// row - every field that changes is captured, none is exempted, but a field nobody touched isn't
// noise in the diff. If nothing actually changed (a no-op submit), no audit row is written at all:
// CLAUDE.md #6 requires an entry for every state change, and a submit that changes nothing is not
// one - a "you edited X" row where nothing moved would be exactly the misleading audit trail
// invariant #4 (append-only, meaningful history) exists to prevent.
export async function updateDeal(
  supabase: SupabaseClient,
  actor: Actor,
  dealId: string,
  input: EditDealInput,
): Promise<UpdateDealResult> {
  const deal = await getDealForEdit(supabase, dealId);
  if (!deal) return { ok: false, code: "not_found" };

  const coOwnerIds = await listDealCoOwnerIds(supabase, dealId);
  const resource = {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  };
  if (!can(actor, "deal.update", resource)) {
    return { ok: false, code: "denied" };
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const noteChange = (field: string, beforeValue: unknown, afterValue: unknown) => {
    if (beforeValue === afterValue) return;
    before[field] = beforeValue;
    after[field] = afterValue;
  };

  noteChange("name", deal.name, input.name);
  noteChange("clientType", deal.clientType, input.clientType);
  noteChange("expectedCloseDate", deal.expectedCloseDate, input.expectedCloseDate);
  noteChange("proposalValueMinor", deal.proposalValueMinor?.toString() ?? null, input.proposalValueMinor?.toString() ?? null);
  noteChange("negotiatedValueMinor", deal.negotiatedValueMinor?.toString() ?? null, input.negotiatedValueMinor?.toString() ?? null);
  noteChange("brief", deal.brief, input.brief);

  if (Object.keys(after).length === 0) {
    return { ok: true };
  }

  const fields: DealEditFields = {
    name: input.name,
    clientType: input.clientType,
    expectedCloseDate: input.expectedCloseDate,
    proposalValueMinor: input.proposalValueMinor,
    negotiatedValueMinor: input.negotiatedValueMinor,
    brief: input.brief,
  };
  await applyDealEdit(supabase, dealId, fields);

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "deal",
    entityId: dealId,
    action: "deal.update",
    before,
    after,
  });

  return { ok: true };
}

export interface DealEditView {
  id: string;
  name: string;
  clientType: ClientType;
  expectedCloseDate: string | null;
  proposalValueMinor: bigint | null;
  negotiatedValueMinor: bigint | null;
  currencyCode: string;
  brief: string | null;
  canEdit: boolean;
}

// Bundles the edit form's current-value prefill with the can() check, so the page renders a
// Denied state instead of the form when the answer is no - a hidden edit link elsewhere is
// presentation only (CLAUDE.md #1), this is the real, resource-scoped control.
export async function getDealForEditView(supabase: SupabaseClient, actor: Actor, dealId: string): Promise<DealEditView | null> {
  const deal = await getDealForEdit(supabase, dealId);
  if (!deal) return null;

  const coOwnerIds = await listDealCoOwnerIds(supabase, dealId);
  const canEdit = can(actor, "deal.update", {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  });

  return {
    id: deal.id,
    name: deal.name,
    clientType: deal.clientType,
    expectedCloseDate: deal.expectedCloseDate,
    proposalValueMinor: deal.proposalValueMinor,
    negotiatedValueMinor: deal.negotiatedValueMinor,
    currencyCode: deal.currencyCode,
    brief: deal.brief,
    canEdit,
  };
}
