import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/auth/permissions";
import { listLossOutcomesForReport } from "@/data/dealOutcomes";
import { listPracticeLines } from "@/data/practiceLines";
import { VALUE_BAND_LABELS, valueBand } from "@/domain/deal";

export interface LossReasonBreakdown {
  label: string;
  count: number;
}

export interface LossReasonReport {
  totalLosses: number;
  byReason: LossReasonBreakdown[];
  byPractice: LossReasonBreakdown[];
  byValueBand: LossReasonBreakdown[];
  byCompetitor: LossReasonBreakdown[];
}

export type GetLossReasonReportResult = { ok: true; report: LossReasonReport } | { ok: false; code: "denied" };

const NOT_SPECIFIED_COMPETITOR = "Not specified";

function countBy<T>(items: T[], labelOf: (item: T) => string): LossReasonBreakdown[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = labelOf(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

// M5.4 (docs/07-build-backlog.md): "Loss-reason report by practice, value band and competitor."
// Scope is derived directly from role grants, the same way src/services/tasks.ts's getTeamOverview
// already does for its own multi-member breakdown - not via can() against a single Resource, since
// there is no one deal this check is about; the report spans by definition. A Team Lead/Director
// sees only their own practice(s); Executive/Tenant Admin see the tenant. A BDE has no grant of
// either kind and is denied - matching docs/02-permission-matrix.md's analytics.view_practice row
// (BDE: denied; Team Lead/Director: practice; Executive/Tenant Admin: tenant), which needed no
// changes for this milestone since it was already correctly scoped from earlier scaffolding.
//
// byValueBand deliberately lists every band, including ones with zero losses - docs/04-metric-
// definitions.md's own "no minimum-sample suppression" note for this report: a fixed, small,
// ordered taxonomy (five bands) is exactly the case where "zero in this band" is itself real,
// useful information, unlike byReason/byPractice/byCompetitor, which are open-ended sets where
// listing every possible value that never occurred would just be noise.
export async function getLossReasonReport(supabase: SupabaseClient, actor: Actor): Promise<GetLossReasonReportResult> {
  const isTenantWide = actor.roleGrants.some((grant) => grant.role === "executive" || grant.role === "tenant_admin");
  const ownPracticeLineIds = actor.roleGrants
    .filter((grant) => (grant.role === "team_lead" || grant.role === "director") && grant.practiceLineId)
    .map((grant) => grant.practiceLineId as string);

  if (!isTenantWide && ownPracticeLineIds.length === 0) {
    return { ok: false, code: "denied" };
  }

  const practiceLineIds = isTenantWide ? null : ownPracticeLineIds;
  const [rows, practiceLines] = await Promise.all([listLossOutcomesForReport(supabase, practiceLineIds), listPracticeLines(supabase)]);
  const practiceLineNameById = new Map(practiceLines.map((p) => [p.id, p.name]));

  const byReason = countBy(rows, (row) => row.reasonLabel);
  const byPractice = countBy(rows, (row) => practiceLineNameById.get(row.practiceLineId) ?? "Unknown practice");
  const byCompetitor = countBy(rows, (row) => row.competitorName ?? NOT_SPECIFIED_COMPETITOR);

  const valueBandCounts = new Map<string, number>();
  for (const label of Object.values(VALUE_BAND_LABELS)) valueBandCounts.set(label, 0);
  for (const row of rows) {
    const label = VALUE_BAND_LABELS[valueBand(row.negotiatedValueMinor ?? row.proposalValueMinor)];
    valueBandCounts.set(label, (valueBandCounts.get(label) ?? 0) + 1);
  }
  const byValueBand = Object.values(VALUE_BAND_LABELS).map((label) => ({ label, count: valueBandCounts.get(label) ?? 0 }));

  return {
    ok: true,
    report: { totalLosses: rows.length, byReason, byPractice, byValueBand, byCompetitor },
  };
}
