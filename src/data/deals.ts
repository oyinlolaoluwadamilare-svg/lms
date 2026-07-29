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
