import type { SupabaseClient } from "@supabase/supabase-js";
import { daysBetweenInTimezone, daysSincePlainDate, dateInTimezone, subtractDaysFromPlainDate } from "@/lib/dates";
import { getLatestStageEventOccurredAtByDeal } from "@/data/stageEvents";
import { parseMoneyMinor, type Money } from "@/domain/money";
import type { TaskPriority } from "@/domain/task";
import {
  dealValue,
  formatDealReference,
  resolveProbability,
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

// docs/06-ui-spec.md's Pipeline screen names an "advanced filter set" that also includes "has no
// next step" and "stage regression". "Has no next step" is no longer deferred: M4.7 implements it
// below as noNextStep, now that M4.4's next_action_task_id derivation exists to honestly back it.
// "Stage regression" remains out of scope here - a filter on stage_events.is_regression, which
// exists since M2.1 but has no UI surface yet, a separate gap from this one. "Days since last
// engagement" was the first of these three to stop being deferred, back in M3.7.
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
  // "At least this many days since last engagement, or never engaged" (docs/06-ui-spec.md's
  // advanced filter set) - never-engaged deals are the most stale a deal can be, so they always
  // match a minimum-days filter, the same "null means never, not zero, but IS at least as stale as
  // any number" reasoning docs/04-metric-definitions.md's staleness bands definition already uses.
  minDaysSinceEngagement?: number;
  // M4.7 (docs/07-build-backlog.md): "'No next step' filter... listing active deals lacking an open
  // task." This is the exact complement of docs/04-metric-definitions.md's "Next-action coverage"
  // metric ("Active deals with next_action_task_id is not null, over all active deals") - so, to
  // stay true to that formula rather than inventing a looser one, setting this flag filters to
  // status = 'active' AND next_action_task_id is null, not merely "next_action_task_id is null" on
  // its own (a won/lost deal has no open task either, but that's an expected end state, not a
  // gap needing attention). This matches migration 0005's own deals_no_next_action partial index
  // (`where next_action_task_id is null and status = 'active'`) exactly, keeping the query
  // index-backed. Combining this with an explicit, conflicting `status` filter (e.g. "won") is a
  // contradiction that correctly yields zero rows rather than silently picking one side.
  noNextStep?: boolean;
  // M3.7: the first sort control in the app (docs/06-ui-spec.md: "a last-engaged column and sort in
  // the table"). Scoped to this one column deliberately - there is no existing sort infrastructure
  // to extend, and no other column has been asked for yet; omitted, the table keeps its original
  // default order (expected_close_date ascending) unchanged.
  sortBy?: "lastEngagedAt";
  sortDir?: "asc" | "desc";
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
  daysInCurrentStage: number;
  lastEngagedAt: string | null;
  daysSinceLastEngagement: number | null;
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
  created_at: string;
  last_engaged_at: string | null;
  accounts: { name: string } | null;
  practice_lines: { name: string } | null;
  pipeline_stages: { id: string; name: string; sort_order: number; probability_threshold: number; stage_type: StageType } | null;
  owner: { full_name: string } | null;
}

// M2.3/M3.7 (docs/07-build-backlog.md). `timezone` and `now` are the viewer's resolved timezone
// (src/services/actor.ts) and the current instant - CLAUDE.md #8: rendered in the user's timezone,
// never computed as a raw UTC day count (see src/lib/dates.ts's own comment for why that's wrong).
// `daysInCurrentStage` (M2.3) is a TIMESTAMPTZ-vs-instant calculation (daysBetweenInTimezone);
// `daysSinceLastEngagement` (M3.7) is a plain-DATE-vs-plain-DATE calculation
// (daysSincePlainDate) - deliberately different helpers for the two, per src/lib/dates.ts's own
// reasoning about why a DATE column must never be routed through timezone-resolving Intl/Date
// machinery built for TIMESTAMPTZ columns.
//
// RLS's deals_select policy (migration 0005) already scopes rows to the caller's tenant and
// practice entitlement (or tenant-wide for executive/tenant_admin) - every filter here narrows
// within whatever that policy already allows, it never widens it.
export async function listDeals(
  supabase: SupabaseClient,
  filters: DealListFilters,
  timezone: string,
  now: Date = new Date(),
): Promise<DealListRow[]> {
  const today = dateInTimezone(now.toISOString(), timezone);

  let query = supabase
    .from("deals")
    .select(
      "id, reference, name, client_type, status, forecast_category, expected_close_date, " +
        "proposal_value_minor::text, negotiated_value_minor::text, currency_code, probability_override, created_at, " +
        "last_engaged_at, accounts(name), practice_lines(name), " +
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
  if (filters.minDaysSinceEngagement !== undefined) {
    const cutoff = subtractDaysFromPlainDate(today, filters.minDaysSinceEngagement);
    query = query.or(`last_engaged_at.lte.${cutoff},last_engaged_at.is.null`);
  }
  if (filters.noNextStep) query = query.eq("status", "active").is("next_action_task_id", null);

  // Default order is unchanged from M1.4 when no sort is requested. M3.7's "last-engaged... sort"
  // (docs/06-ui-spec.md) is the only sortable column so far - ascending means most-stale-first
  // (never-engaged deals sort first, alongside the oldest real dates: both are "as stale as
  // possible"), descending means most-recently-engaged-first (never-engaged sort last).
  if (filters.sortBy === "lastEngagedAt") {
    const ascending = filters.sortDir !== "desc";
    query = query.order("last_engaged_at", { ascending, nullsFirst: ascending });
  } else {
    query = query.order("expected_close_date", { ascending: true, nullsFirst: false });
  }

  const { data, error } = await query;
  if (error) throw new Error(`listDeals failed: ${error.message}`);

  const rows = data as unknown as DealListRowRaw[];
  const latestStageEventByDeal = await getLatestStageEventOccurredAtByDeal(
    supabase,
    rows.map((row) => row.id),
  );
  const nowIso = now.toISOString();

  return rows.map((row) => {
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
    // Falls back to the deal's own created_at when it has never had a stage_events row (a deal
    // that was created and has never been moved - createDeal, unlike changeStage, deliberately
    // writes no stage_events row, since creation itself isn't a transition per
    // docs/01-domain-model.md's list of transition paths).
    const sinceIso = latestStageEventByDeal.get(row.id) ?? row.created_at;

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
      daysInCurrentStage: daysBetweenInTimezone(sinceIso, nowIso, timezone),
      lastEngagedAt: row.last_engaged_at,
      daysSinceLastEngagement: row.last_engaged_at === null ? null : daysSincePlainDate(row.last_engaged_at, today),
    };
  });
}

// M4.7's dashboard tile (docs/07-build-backlog.md): "dashboard tile listing active deals lacking an
// open task." A plain count, not a fetch of every row - the tile shows a number and a link through
// to `/deals?noNextStep=1` for the actual list, so there is no need to pull every joined column
// listDeals does. Relies purely on deals_select RLS for tenant/practice scoping, the same way
// listDeals itself does (no explicit tenant_id filter) - a Director gets their own practice's
// count, an Executive or tenant_admin gets the tenant-wide count, matching whatever the Pipeline
// list itself would show them with the noNextStep filter applied.
export async function countDealsWithoutNextAction(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .is("next_action_task_id", null)
    .is("deleted_at", null);

  if (error) throw new Error(`countDealsWithoutNextAction failed: ${error.message}`);
  return count ?? 0;
}

export interface DealForAuthorization {
  id: string;
  tenantId: string;
  practiceLineId: string;
  stageId: string;
  ownerId: string | null;
  authorId: string;
  status: DealStatus;
  accountId: string;
  name: string;
}

// For any service's can() authorisation check against a deal - just enough of the deal to build
// the can() Resource (practiceLineId/ownerId/authorId), plus the current stage for the one caller
// (changeStage) that needs to compare it against a requested target. Originally named
// getDealForStageChange when changeStage (M1.5) was its only caller; generalised when logActivity
// (M3.2) turned out to need the exact same shape for its own can() check - a second caller with
// identical requirements is a real pattern, not a coincidence worth duplicating. Deliberately not
// reusing getDealWithStage: that function's shape is about money calculation, not authorisation,
// and mixing the two would make it unclear which fields a future caller can rely on. `status` was
// added for closeDeal (M5.2), which needs to reject a deal that's already won/lost before ever
// invoking close_deal - the other two callers simply ignore the field. `accountId` was added for
// linkContactToDeal (M5.5), which needs it for a clean pre-check that a contact belongs to the same
// account as the deal, before ever reaching migration 0018's own non-bypassable trigger backstop.
// `name` was added for changeDealOwner (M5.9), which needs it to label the deal in the handover
// summary's own timeline entries without a second round trip.
export async function getDealForAuthorization(supabase: SupabaseClient, dealId: string): Promise<DealForAuthorization | null> {
  const { data, error } = await supabase
    .from("deals")
    .select("id, tenant_id, practice_line_id, stage_id, owner_id, author_id, status, account_id, name")
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getDealForAuthorization failed: ${error.message}`);
  if (!data) return null;

  const row = data as {
    id: string;
    tenant_id: string;
    practice_line_id: string;
    stage_id: string;
    owner_id: string | null;
    author_id: string;
    status: DealStatus;
    account_id: string;
    name: string;
  };
  return {
    id: row.id,
    tenantId: row.tenant_id,
    practiceLineId: row.practice_line_id,
    stageId: row.stage_id,
    ownerId: row.owner_id,
    authorId: row.author_id,
    status: row.status,
    accountId: row.account_id,
    name: row.name,
  };
}

// The only place deals.stage_id is written from application code - called exclusively by
// src/services/deals.ts's changeStage (docs/03-architecture.md's single-path rule). Does not touch
// status/actual_close_date: those belong exclusively to closeDeal (M5.2, src/services/deals.ts), which is also why
// changeStage itself refuses a won/lost target stage before this is ever called - see
// isOpenStage's comment in src/domain/deal.ts. updated_at/updated_by are not set here - migration
// 0006's trigger sets both from auth.uid(), so a caller can't spoof who made the change.
export async function updateDealStage(supabase: SupabaseClient, dealId: string, toStageId: string): Promise<void> {
  const { error } = await supabase.from("deals").update({ stage_id: toStageId }).eq("id", dealId);

  if (error) throw new Error(`updateDealStage failed: ${error.message}`);
}

// The only place deals.owner_id is written from application code after creation - called
// exclusively by src/services/deals.ts's changeDealOwner (M5.9, docs/07-build-backlog.md:
// "Handover panel... shown on owner change"). Mirrors updateDealStage exactly - a plain
// single-column update through the caller's own RLS-scoped session. deal.change_owner's own
// permission check (denied for bde, unlike deal.update's own "own" scope) is what actually keeps
// this from being a bde self-service action - the same RLS-coarse/service-precise split every
// other compound write in this codebase already uses, since deals_update's own policy has no
// per-column concept of which field is being changed (tests/rls/deals_permission_matrix.spec.ts's
// own documented finding).
export async function updateDealOwner(supabase: SupabaseClient, dealId: string, newOwnerId: string): Promise<void> {
  const { error } = await supabase.from("deals").update({ owner_id: newOwnerId }).eq("id", dealId);

  if (error) throw new Error(`updateDealOwner failed: ${error.message}`);
}

// M1.6 exit criteria (docs/07-build-backlog.md): "Deal detail read-only skeleton: header, financial
// summary, details, account." Narrower than docs/06-ui-spec.md's full Deal detail spec in two ways
// that remain: stakeholders and open tasks both depend on entities that don't exist yet (M4+/M5+).
// The engagement timeline (M3.5) and last-engaged chip (M3.7) have since been added - this shape now
// carries `lastEngagedAt`/`daysSinceLastEngagement` for that chip, the same derived-field reasoning
// listDeals' own M3.7 fields already establish.
export interface DealDetail {
  id: string;
  reference: string;
  name: string;
  status: DealStatus;
  clientType: ClientType;
  brief: string | null;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  forecastCategory: ForecastCategory;
  probability: number;
  value: Money | null;
  weightedValue: Money | null;
  proposalValue: Money | null;
  negotiatedValue: Money | null;
  stage: { id: string; name: string; stageType: StageType; sortOrder: number };
  account: { id: string; name: string; industry: string | null; region: string | null };
  practiceLineName: string;
  ownerName: string | null;
  authorName: string;
  coOwnerNames: string[];
  createdAt: string;
  updatedAt: string;
  lastEngagedAt: string | null;
  daysSinceLastEngagement: number | null;
  nextAction: { taskId: string; title: string; dueDate: string; priority: TaskPriority } | null;
}

interface DealDetailRow {
  id: string;
  reference: string;
  name: string;
  status: DealStatus;
  client_type: ClientType;
  brief: string | null;
  expected_close_date: string | null;
  actual_close_date: string | null;
  forecast_category: ForecastCategory;
  proposal_value_minor: string | null;
  negotiated_value_minor: string | null;
  currency_code: string;
  probability_override: number | null;
  created_at: string;
  updated_at: string;
  last_engaged_at: string | null;
  accounts: { id: string; name: string; industry: string | null; region: string | null } | null;
  practice_lines: { name: string } | null;
  pipeline_stages: { id: string; name: string; stage_type: StageType; probability_threshold: number; sort_order: number } | null;
  owner: { full_name: string } | null;
  author: { full_name: string } | null;
  deal_co_owners: Array<{ user: { full_name: string } | null }>;
  next_action: { id: string; title: string; due_date: string; priority: TaskPriority } | null;
}

// Reads through the CALLER's own RLS-scoped session, same as listDeals - migration 0005's
// deals_select policy is the authorisation boundary, not a separate can() check here. Returns null
// both when the deal genuinely doesn't exist and when it exists but RLS excludes it from this
// caller's view; deliberately not distinguished, the same not-confirming-existence-to-an-
// unauthorised-caller shape src/services/deals.ts's changeStage already established for
// "not_found" - the caller (the deal detail page) renders one honest "not found" state either way.
// `timezone`/`now` (M3.7) are the viewer's resolved timezone and the current instant, the same
// listDeals reasoning: daysSinceLastEngagement is a plain-DATE calculation, never routed through
// timezone-resolving Intl/Date machinery.
export async function getDealDetail(
  supabase: SupabaseClient,
  dealId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<DealDetail | null> {
  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, reference, name, status, client_type, brief, expected_close_date, actual_close_date, " +
        "forecast_category, proposal_value_minor::text, negotiated_value_minor::text, currency_code, " +
        "probability_override, created_at, updated_at, last_engaged_at, " +
        "accounts(id, name, industry, region), practice_lines(name), " +
        "pipeline_stages(id, name, stage_type, probability_threshold, sort_order), " +
        "owner:users!owner_id(full_name), author:users!author_id(full_name), " +
        "deal_co_owners(user:users!user_id(full_name)), " +
        "next_action:tasks!next_action_task_id(id, title, due_date, priority)",
    )
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getDealDetail failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as DealDetailRow;
  if (!row.pipeline_stages) {
    throw new Error(`deal ${dealId} has no resolvable stage (stage_id is not-null, but the join returned nothing)`);
  }
  if (!row.accounts) {
    throw new Error(`deal ${dealId} has no resolvable account (account_id is not-null, but the join returned nothing)`);
  }
  if (!row.practice_lines) {
    throw new Error(`deal ${dealId} has no resolvable practice line (practice_line_id is not-null, but the join returned nothing)`);
  }
  if (!row.author) {
    throw new Error(`deal ${dealId} has no resolvable author (author_id is not-null, but the join returned nothing)`);
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
    status: row.status,
    clientType: row.client_type,
    brief: row.brief,
    expectedCloseDate: row.expected_close_date,
    actualCloseDate: row.actual_close_date,
    forecastCategory: row.forecast_category,
    probability: resolveProbability(dealForCalc, stageForCalc),
    value: dealValue(dealForCalc),
    weightedValue: weightedValue(dealForCalc, stageForCalc),
    proposalValue:
      dealForCalc.proposalValueMinor === null ? null : { amountMinor: dealForCalc.proposalValueMinor, currency: row.currency_code },
    negotiatedValue:
      dealForCalc.negotiatedValueMinor === null ? null : { amountMinor: dealForCalc.negotiatedValueMinor, currency: row.currency_code },
    stage: {
      id: row.pipeline_stages.id,
      name: row.pipeline_stages.name,
      stageType: row.pipeline_stages.stage_type,
      sortOrder: row.pipeline_stages.sort_order,
    },
    account: {
      id: row.accounts.id,
      name: row.accounts.name,
      industry: row.accounts.industry,
      region: row.accounts.region,
    },
    practiceLineName: row.practice_lines.name,
    ownerName: row.owner?.full_name ?? null,
    authorName: row.author.full_name,
    coOwnerNames: row.deal_co_owners.map((co) => co.user?.full_name).filter((name): name is string => Boolean(name)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEngagedAt: row.last_engaged_at,
    daysSinceLastEngagement:
      row.last_engaged_at === null ? null : daysSincePlainDate(row.last_engaged_at, dateInTimezone(now.toISOString(), timezone)),
    // M4.4 (docs/07-build-backlog.md): "the next-action strip and the 'No next step' state on the
    // deal header." next_action_task_id/next_action_due_date (migration 0005) are now kept correct
    // by migration 0013's refresh_deal_next_action() trigger - null genuinely means "no open task",
    // not "hasn't been computed yet" (CLAUDE.md #7). The embed re-derives title/priority from the
    // task row itself rather than duplicating them onto deals - next_action_due_date is left unused
    // here in favour of the fresher `due_date` this same join already provides, though both are
    // always in sync by construction.
    nextAction: row.next_action ? { taskId: row.next_action.id, title: row.next_action.title, dueDate: row.next_action.due_date, priority: row.next_action.priority } : null,
  };
}

// M1.7 exit criteria (docs/07-build-backlog.md): "Edit deal, with audit entries on every field
// change." Deliberately scoped to the fields plain deal.update covers - name, clientType,
// expectedCloseDate, proposalValueMinor, negotiatedValueMinor, brief. Three other deal fields are
// each gated by their OWN distinct permission action, not deal.update, and are out of scope here:
// owner (deal.change_owner - a bde structurally cannot do this, unlike every field below),
// co-owners (deal.add_co_owner) and forecast_category (deal.override_forecast_category, which the
// schema itself ties to an override_reason column with no specified business rule anywhere in
// docs/ for when a reason is required - an open question, not silently assumed). stage_id is
// changeStage's (M1.5) exclusively, and account_id/practice_line_id/status have no edit action
// defined in docs/02-permission-matrix.md at all.
export interface DealForEdit {
  id: string;
  tenantId: string;
  practiceLineId: string;
  ownerId: string | null;
  authorId: string;
  status: DealStatus;
  name: string;
  clientType: ClientType;
  expectedCloseDate: string | null;
  proposalValueMinor: bigint | null;
  negotiatedValueMinor: bigint | null;
  currencyCode: string;
  brief: string | null;
}

interface DealForEditRow {
  id: string;
  tenant_id: string;
  practice_line_id: string;
  owner_id: string | null;
  author_id: string;
  status: DealStatus;
  name: string;
  client_type: ClientType;
  expected_close_date: string | null;
  proposal_value_minor: string | null;
  negotiated_value_minor: string | null;
  currency_code: string;
  brief: string | null;
}

// For the edit form's authorisation check and current-value prefill - just enough of the deal,
// same shape reasoning as getDealForStageChange (not reusing getDealDetail's display-oriented
// shape, which resolves names via joins this doesn't need and omits raw ids this does).
export async function getDealForEdit(supabase: SupabaseClient, dealId: string): Promise<DealForEdit | null> {
  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, tenant_id, practice_line_id, owner_id, author_id, status, name, client_type, " +
        "expected_close_date, proposal_value_minor::text, negotiated_value_minor::text, currency_code, brief",
    )
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getDealForEdit failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as DealForEditRow;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    practiceLineId: row.practice_line_id,
    ownerId: row.owner_id,
    authorId: row.author_id,
    status: row.status,
    name: row.name,
    clientType: row.client_type,
    expectedCloseDate: row.expected_close_date,
    proposalValueMinor: parseMoneyMinor(row.proposal_value_minor),
    negotiatedValueMinor: parseMoneyMinor(row.negotiated_value_minor),
    currencyCode: row.currency_code,
    brief: row.brief,
  };
}

export interface DealEditFields {
  name: string;
  clientType: ClientType;
  expectedCloseDate: string;
  proposalValueMinor: bigint | null;
  negotiatedValueMinor: bigint | null;
  brief: string | null;
}

// The only place these fields are written from application code - called exclusively by
// src/services/deals.ts's updateDeal. updated_at/updated_by are not set here, same reasoning as
// updateDealStage: migration 0006's trigger sets both from auth.uid().
export async function applyDealEdit(supabase: SupabaseClient, dealId: string, fields: DealEditFields): Promise<void> {
  const { error } = await supabase
    .from("deals")
    .update({
      name: fields.name,
      client_type: fields.clientType,
      expected_close_date: fields.expectedCloseDate,
      proposal_value_minor: fields.proposalValueMinor === null ? null : fields.proposalValueMinor.toString(),
      negotiated_value_minor: fields.negotiatedValueMinor === null ? null : fields.negotiatedValueMinor.toString(),
      brief: fields.brief,
    })
    .eq("id", dealId);

  if (error) throw new Error(`applyDealEdit failed: ${error.message}`);
}
