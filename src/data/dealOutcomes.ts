import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMoneyMinor, type Money } from "@/domain/money";

export interface LossOutcomeRow {
  practiceLineId: string;
  negotiatedValueMinor: bigint | null;
  proposalValueMinor: bigint | null;
  competitorName: string | null;
  reasonLabel: string;
}

interface RawLossOutcomeRow {
  practice_line_id: string;
  negotiated_value_minor: string | null;
  proposal_value_minor: string | null;
  // Confirmed directly against this project's real REST endpoint (deal_outcomes.deal_id is both
  // deal_outcomes' own primary key and a foreign key to deals(id), which is what lets PostgREST
  // detect the relationship as one-to-one and return a single object here, not an array) - every
  // deals.status = 'lost' row has exactly one deal_outcomes row by construction (migration 0017's
  // close_deal always writes both in the same transaction; "Transitioning to won or lost requires a
  // deal_outcomes row" per docs/01-domain-model.md), so this is never null for the rows this
  // function filters to.
  deal_outcomes: { competitor_name: string | null; outcome_reasons: { label: string } } | null;
}

// For M5.4's loss-reason report (docs/07-build-backlog.md) - queries FROM deals (not deal_outcomes),
// the same convention src/data/deals.ts's listDeals already uses for filtering on the base table's
// own columns (status, is_demo, deleted_at, practice_line_id) rather than filtering an embedded
// relationship, which PostgREST does not support cleanly. `practiceLineIds: null` means tenant-wide
// (Executive/Tenant Admin); a non-null array scopes to exactly those practices (Team Lead/Director's
// own) - the caller (src/services/reports.ts) derives which case applies, this function only applies
// the filter it's given. RLS's deals_select policy still independently scopes every row to the
// caller's own tenant regardless (CLAUDE.md #1) - this filter is an additional, service-decided
// narrowing on top of that, not a substitute for it.
export async function listLossOutcomesForReport(supabase: SupabaseClient, practiceLineIds: string[] | null): Promise<LossOutcomeRow[]> {
  let query = supabase
    .from("deals")
    .select("practice_line_id, negotiated_value_minor::text, proposal_value_minor::text, deal_outcomes(competitor_name, outcome_reasons(label))")
    .eq("status", "lost")
    .eq("is_demo", false)
    .is("deleted_at", null);

  if (practiceLineIds !== null) {
    query = query.in("practice_line_id", practiceLineIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listLossOutcomesForReport failed: ${error.message}`);

  return (data as unknown as RawLossOutcomeRow[]).map((row) => {
    if (!row.deal_outcomes) {
      throw new Error(`lost deal in practice ${row.practice_line_id} has no resolvable deal_outcomes row - invariant violated`);
    }
    return {
      practiceLineId: row.practice_line_id,
      negotiatedValueMinor: parseMoneyMinor(row.negotiated_value_minor),
      proposalValueMinor: parseMoneyMinor(row.proposal_value_minor),
      competitorName: row.deal_outcomes.competitor_name,
      reasonLabel: row.deal_outcomes.outcome_reasons.label,
    };
  });
}

interface RawWonOutcomeRow {
  negotiated_value_minor: string | null;
  proposal_value_minor: string | null;
  currency_code: string;
  deal_outcomes: { final_value_minor: string | null; currency_code: string | null } | null;
}

// D-15 (docs/DECISIONS.md): "won revenue" (Account 360, M5.8) prefers the value actually recorded
// at close (`final_value_minor`, M5.2's closeDeal) over the deal's own last value, falling back to
// it when no final value was recorded (optional, M5.3). Queries FROM deals, the same convention
// listLossOutcomesForReport already uses - filtering on the base table's own columns rather than an
// embedded relationship. Every deals.status = 'won' row has exactly one deal_outcomes row by
// construction (the same invariant listLossOutcomesForReport's own comment documents for 'lost'),
// so `deal_outcomes` is never null here in practice; still handled as an if-guard rather than a
// non-null assertion, the same defensive-but-honest shape this codebase uses throughout.
//
// Returns `null` (not 0) for a won deal with no recorded value anywhere (no final value, no
// negotiated/proposal value either) - the same "null is not zero" reasoning `dealValue`'s own
// comment gives: a deal nobody ever valued is a different fact from a deal valued at zero, and
// `sumMoneyByCurrency` already skips nulls, so this never silently deflates "won revenue" by
// pretending an unvalued deal contributed nothing measurable rather than nothing recorded.
export async function listWonOutcomesForAccount(supabase: SupabaseClient, accountId: string): Promise<Array<Money | null>> {
  const { data, error } = await supabase
    .from("deals")
    .select("negotiated_value_minor::text, proposal_value_minor::text, currency_code, deal_outcomes(final_value_minor::text, currency_code)")
    .eq("account_id", accountId)
    .eq("status", "won")
    .eq("is_demo", false)
    .is("deleted_at", null);

  if (error) throw new Error(`listWonOutcomesForAccount failed: ${error.message}`);

  return (data as unknown as RawWonOutcomeRow[]).map((row) => {
    const finalValueMinor = row.deal_outcomes ? parseMoneyMinor(row.deal_outcomes.final_value_minor) : null;
    if (finalValueMinor !== null) {
      return { amountMinor: finalValueMinor, currency: row.deal_outcomes!.currency_code! };
    }
    const dealValueMinor = parseMoneyMinor(row.negotiated_value_minor) ?? parseMoneyMinor(row.proposal_value_minor);
    return dealValueMinor === null ? null : { amountMinor: dealValueMinor, currency: row.currency_code };
  });
}
