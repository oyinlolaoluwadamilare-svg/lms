import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import { listAccounts } from "@/data/accounts";
import { listDealCoOwnerIds } from "@/data/dealCoOwners";
import {
  DealReferenceConflictError,
  getDealDetail as getDealDetailRow,
  getDealForStageChange,
  insertDeal,
  listDeals,
  nextDealReference,
  updateDealStage,
  type DealDetail,
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
import { writeAudit } from "@/services/audit";
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
export async function listPipelineDeals(supabase: SupabaseClient, filters: DealListFilters): Promise<DealListRow[]> {
  return listDeals(supabase, filters);
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
//    exclusive job of closeDeal (docs/07-build-backlog.md M5.2, not built yet), which requires an
//    outcome reason this function has no way to collect or enforce - see isOpenStage's comment in
//    src/domain/deal.ts. Rejecting here, not merely declining to render a drop target in the UI, is
//    what makes this a real control and not presentation-only (CLAUDE.md #1).
//
// Known gap, same one src/services/audit.ts's own comment already flags for every compound write in
// this Supabase-client architecture: the deal update and the audit write below are two separate
// calls, not one transaction. If the audit write throws, the stage has already changed, un-audited.
// M2.1's stage_events table (and the Postgres-function-backed atomic writer that comment calls for)
// is the real fix; not built yet.
export async function changeStage(
  supabase: SupabaseClient,
  actor: Actor,
  dealId: string,
  toStageId: string,
): Promise<ChangeStageResult> {
  const deal = await getDealForStageChange(supabase, dealId);
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

// Passthrough so app/(app)/deals/[id]/page.tsx doesn't import src/data directly. No separate can()
// check here, same reasoning as listPipelineDeals: migration 0005's deals_select RLS policy is
// this read's authorisation boundary, and getDealDetail already reads through the caller's own
// session, not a service-role client.
export async function getDealDetail(supabase: SupabaseClient, dealId: string): Promise<DealDetail | null> {
  return getDealDetailRow(supabase, dealId);
}
