import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMoneyMinor } from "@/domain/money";
import { formatDealReference, type DealForCalculation, type StageForCalculation } from "@/domain/deal";

interface DealWithStageRow {
  id: string;
  proposal_value_minor: string | null;
  negotiated_value_minor: string | null;
  currency_code: string;
  probability_override: number | null;
  pipeline_stages: { id: string; probability_threshold: number } | null;
}

export interface DealWithStage {
  deal: { id: string } & DealForCalculation;
  stage: { id: string } & StageForCalculation;
}

// Money columns are always selected with an explicit ::text cast (see src/domain/money.ts) - never
// select proposal_value_minor/negotiated_value_minor bare, or large values silently lose precision
// in transit (verified directly against this project's real REST endpoint, not assumed).
export async function getDealWithStage(supabase: SupabaseClient, dealId: string): Promise<DealWithStage | null> {
  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, proposal_value_minor::text, negotiated_value_minor::text, currency_code, probability_override, pipeline_stages(id, probability_threshold)",
    )
    .eq("id", dealId)
    .maybeSingle();

  if (error) throw new Error(`getDealWithStage failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as DealWithStageRow;
  if (!row.pipeline_stages) {
    throw new Error(`deal ${dealId} has no resolvable stage (stage_id is not-null, but the join returned nothing)`);
  }

  return {
    deal: {
      id: row.id,
      proposalValueMinor: parseMoneyMinor(row.proposal_value_minor),
      negotiatedValueMinor: parseMoneyMinor(row.negotiated_value_minor),
      currencyCode: row.currency_code,
      probabilityOverride: row.probability_override,
    },
    stage: {
      id: row.pipeline_stages.id,
      probabilityThreshold: row.pipeline_stages.probability_threshold,
    },
  };
}

// Counts every deal ever created for the tenant, including soft-deleted ones - a reference must
// never be reused once issued, even after the deal it named is deleted (CLAUDE.md #3, and
// references are meant to be permanent human-facing identifiers).
export async function countDealsForTenant(supabase: SupabaseClient, tenantId: string): Promise<number> {
  const { count, error } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`countDealsForTenant failed: ${error.message}`);
  return count ?? 0;
}

// Not race-free under concurrent creates on its own - two simultaneous calls can both compute the
// same next number. Safe only because migration 0005's unique (tenant_id, reference) constraint
// catches the collision at insert time; the caller (the create-deal service, M1.3) must retry with
// a fresh call to this function on a unique-violation, not assume the value returned here is
// guaranteed available by the time it inserts.
export async function nextDealReference(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const count = await countDealsForTenant(supabase, tenantId);
  return formatDealReference(count + 1);
}

export interface NewDealInput {
  tenantId: string;
  reference: string;
  name: string;
  accountId: string;
  practiceLineId: string;
  stageId: string;
  clientType: "new" | "existing";
  ownerId: string;
  authorId: string;
  expectedCloseDate: string; // YYYY-MM-DD
  proposalValueMinor: bigint | null;
  currencyCode: string;
  brief: string | null;
}

export interface InsertedDeal {
  id: string;
  reference: string;
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

// Thrown specifically on a (tenant_id, reference) collision (migration 0005) so the caller (the
// create-deal service) can distinguish "the reference I picked was taken in the meantime - try the
// next one" from every other insert failure, which should just fail loudly.
export class DealReferenceConflictError extends Error {
  constructor(reference: string) {
    super(`reference "${reference}" already exists for this tenant`);
    this.name = "DealReferenceConflictError";
  }
}

// author_id and created_by are always input.authorId - there is no field here a caller could set
// to author someone else's deal as them; the service (src/services/deals.ts) is the only place
// that decides what authorId is, and it always uses the acting user's own id, never a value from
// the request body. That is what makes "the Unknown Author state must be unrepresentable"
// (docs/07-build-backlog.md M1.3) actually true, rather than merely validated.
export async function insertDeal(supabase: SupabaseClient, input: NewDealInput): Promise<InsertedDeal> {
  const { data, error } = await supabase
    .from("deals")
    .insert({
      tenant_id: input.tenantId,
      reference: input.reference,
      name: input.name,
      account_id: input.accountId,
      practice_line_id: input.practiceLineId,
      stage_id: input.stageId,
      client_type: input.clientType,
      owner_id: input.ownerId,
      author_id: input.authorId,
      created_by: input.authorId,
      status: "active",
      expected_close_date: input.expectedCloseDate,
      proposal_value_minor: input.proposalValueMinor === null ? null : input.proposalValueMinor.toString(),
      currency_code: input.currencyCode,
      brief: input.brief,
    })
    .select("id, reference")
    .single();

  if (error) {
    if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
      throw new DealReferenceConflictError(input.reference);
    }
    throw new Error(`insertDeal failed: ${error.message}`);
  }

  return data as InsertedDeal;
}
