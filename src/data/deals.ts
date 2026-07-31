import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMoneyMinor, type Money } from "@/domain/money";
import {
  dealValue,
  formatDealReference,
  weightedValue,
  type ClientType,
  type DealForCalculation,
  type DealStatus,
  type ForecastCategory,
  type StageForCalculation,
  type StageType,
} from "@/domain/deal";

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
  clientType: ClientType;
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

// docs/06-ui-spec.md's Pipeline screen names an "advanced filter set" that also includes "days
// since last engagement", "has no next step" and "stage regression" - each backed by an entity or
// column this repository cannot honestly serve yet. `last_engaged_at`/`next_action_due_date` exist
// on the deals table already (migration 0005) but nothing populates them until an activity/task
// entity exists to derive them from (M2+ per docs/07-build-backlog.md); "stage regression" depends
// on M2.1's not-yet-built stage_events table and its regression-derived column. Filtering or
// sorting on a column that is null for every row today would look like a real feature while
// silently doing nothing - so this is scoped to the filters the current schema can actually answer,
// per CLAUDE.md's "do not start a milestone whose predecessor is incomplete" and "say when
// something is a bad idea" rather than building against data that doesn't exist yet.
export interface DealListFilters {
  stageId?: string;
  ownerId?: string;
  practiceLineId?: string;
  accountId?: string;
  clientType?: ClientType;
  forecastCategory?: ForecastCategory;
  status?: DealStatus;
  expectedCloseFrom?: string; // YYYY-MM-DD, inclusive
  expectedCloseTo?: string; // YYYY-MM-DD, inclusive
}

export interface DealListRow {
  id: string;
  reference: string;
  name: string;
  accountName: string;
  practiceLineName: string;
  stage: { id: string; name: string; sortOrder: number; stageType: StageType };
  ownerName: string | null;
  clientType: ClientType;
  status: DealStatus;
  forecastCategory: ForecastCategory;
  expectedCloseDate: string | null;
  value: Money | null;
  weightedValue: Money | null;
}

interface DealListRowRaw {
  id: string;
  reference: string;
  name: string;
  client_type: ClientType;
  status: DealStatus;
  forecast_category: ForecastCategory;
  expected_close_date: string | null;
  proposal_value_minor: string | null;
  negotiated_value_minor: string | null;
  currency_code: string;
  probability_override: number | null;
  accounts: { name: string } | null;
  practice_lines: { name: string } | null;
  pipeline_stages: { id: string; name: string; sort_order: number; probability_threshold: number; stage_type: StageType } | null;
  owner: { full_name: string } | null;
}

// RLS's deals_select policy (migration 0005) already scopes rows to the caller's tenant and
// practice entitlement (or tenant-wide for executive/tenant_admin) - every filter here narrows
// within whatever that policy already allows, it never widens it.
export async function listDeals(supabase: SupabaseClient, filters: DealListFilters = {}): Promise<DealListRow[]> {
  let query = supabase
    .from("deals")
    .select(
      "id, reference, name, client_type, status, forecast_category, expected_close_date, " +
        "proposal_value_minor::text, negotiated_value_minor::text, currency_code, probability_override, " +
        "accounts(name), practice_lines(name), " +
        "pipeline_stages(id, name, sort_order, probability_threshold, stage_type), " +
        "owner:users!owner_id(full_name)",
    )
    .is("deleted_at", null);

  if (filters.stageId) query = query.eq("stage_id", filters.stageId);
  if (filters.ownerId) query = query.eq("owner_id", filters.ownerId);
  if (filters.practiceLineId) query = query.eq("practice_line_id", filters.practiceLineId);
  if (filters.accountId) query = query.eq("account_id", filters.accountId);
  if (filters.clientType) query = query.eq("client_type", filters.clientType);
  if (filters.forecastCategory) query = query.eq("forecast_category", filters.forecastCategory);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.expectedCloseFrom) query = query.gte("expected_close_date", filters.expectedCloseFrom);
  if (filters.expectedCloseTo) query = query.lte("expected_close_date", filters.expectedCloseTo);

  const { data, error } = await query.order("expected_close_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listDeals failed: ${error.message}`);

  return (data as unknown as DealListRowRaw[]).map((row) => {
    if (!row.pipeline_stages) {
      throw new Error(`deal ${row.id} has no resolvable stage (stage_id is not-null, but the join returned nothing)`);
    }
    if (!row.accounts) {
      throw new Error(`deal ${row.id} has no resolvable account (account_id is not-null, but the join returned nothing)`);
    }
    if (!row.practice_lines) {
      throw new Error(`deal ${row.id} has no resolvable practice line (practice_line_id is not-null, but the join returned nothing)`);
    }

    const dealForCalc: DealForCalculation = {
      proposalValueMinor: parseMoneyMinor(row.proposal_value_minor),
      negotiatedValueMinor: parseMoneyMinor(row.negotiated_value_minor),
      currencyCode: row.currency_code,
      probabilityOverride: row.probability_override,
    };
    const stageForCalc: StageForCalculation = { probabilityThreshold: row.pipeline_stages.probability_threshold };

    return {
      id: row.id,
      reference: row.reference,
      name: row.name,
      accountName: row.accounts.name,
      practiceLineName: row.practice_lines.name,
      stage: {
        id: row.pipeline_stages.id,
        name: row.pipeline_stages.name,
        sortOrder: row.pipeline_stages.sort_order,
        stageType: row.pipeline_stages.stage_type,
      },
      ownerName: row.owner?.full_name ?? null,
      clientType: row.client_type,
      status: row.status,
      forecastCategory: row.forecast_category,
      expectedCloseDate: row.expected_close_date,
      value: dealValue(dealForCalc),
      weightedValue: weightedValue(dealForCalc, stageForCalc),
    };
  });
}

export interface DealForStageChange {
  id: string;
  tenantId: string;
  practiceLineId: string;
  stageId: string;
  ownerId: string | null;
  authorId: string;
}

// For changeStage's authorisation check (src/services/deals.ts) - just enough of the deal to build
// the can() Resource (practiceLineId/ownerId/authorId) and to compare the current stage against the
// requested one. Deliberately not reusing getDealWithStage: that function's shape is about money
// calculation, not authorisation, and mixing the two would make it unclear which fields a future
// caller can rely on.
export async function getDealForStageChange(supabase: SupabaseClient, dealId: string): Promise<DealForStageChange | null> {
  const { data, error } = await supabase
    .from("deals")
    .select("id, tenant_id, practice_line_id, stage_id, owner_id, author_id")
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getDealForStageChange failed: ${error.message}`);
  if (!data) return null;

  const row = data as { id: string; tenant_id: string; practice_line_id: string; stage_id: string; owner_id: string | null; author_id: string };
  return {
    id: row.id,
    tenantId: row.tenant_id,
    practiceLineId: row.practice_line_id,
    stageId: row.stage_id,
    ownerId: row.owner_id,
    authorId: row.author_id,
  };
}

// The only place deals.stage_id is written from application code - called exclusively by
// src/services/deals.ts's changeStage (docs/03-architecture.md's single-path rule). Does not touch
// status/actual_close_date: those belong to the not-yet-built closeDeal (M5.2), which is also why
// changeStage itself refuses a won/lost target stage before this is ever called - see
// isOpenStage's comment in src/domain/deal.ts. updated_at/updated_by are not set here - migration
// 0006's trigger sets both from auth.uid(), so a caller can't spoof who made the change.
export async function updateDealStage(supabase: SupabaseClient, dealId: string, toStageId: string): Promise<void> {
  const { error } = await supabase.from("deals").update({ stage_id: toStageId }).eq("id", dealId);

  if (error) throw new Error(`updateDealStage failed: ${error.message}`);
}
