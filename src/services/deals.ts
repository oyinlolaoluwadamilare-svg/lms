import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Actor } from "@/auth/permissions";
import { listAccounts } from "@/data/accounts";
import {
  DealReferenceConflictError,
  insertDeal,
  listDeals,
  nextDealReference,
  type DealListFilters,
  type DealListRow,
  type InsertedDeal,
} from "@/data/deals";
// Re-exported so app/(app)/deals only needs to import from this module - app may not import
// src/data directly (eslint.config.mjs boundaries), including for types.
export type { DealListFilters, DealListRow };
import { listPracticeLines } from "@/data/practiceLines";
import { listAllStages, listOpenStages, type PipelineStageOption } from "@/data/pipelineStages";
import { listActiveUsersInTenant } from "@/data/users";
import { writeAudit } from "@/services/audit";
import type { AppUser } from "@/domain/user";
import type { ClientType } from "@/domain/deal";

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
