import { getSessionActor } from "@/services/actor";
import { getLossReasonReport, type LossReasonBreakdown } from "@/services/reports";
import { createClient } from "@/lib/supabase/server";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { checkRouteAccess } from "../_access";

// M5.4 (docs/07-build-backlog.md): "Loss-reason report by practice, value band and competitor."
// The first real content this screen has ever shown - checkRouteAccess lets every role onto
// /analytics at all (src/domain/navigation.ts's NAV_BY_ROLE names it for everyone), but that is
// only the coarse "can this role type this URL" gate (CLAUDE.md #1); getLossReasonReport's own
// denied result is the precise one; a BDE reaches this page but sees DeniedState below, not the
// report - a hidden nav link was never the only control here either way.
//
// docs/06-ui-spec.md's cross-cutting Analytics rule ("every panel carries: period label, comparison
// basis, sample size, and a footnote on exclusions") is honoured literally even though this is the
// only panel that exists yet: period is "All time" (M5.4's own backlog line names no period filter,
// unlike M4.7's very explicit "no next step" filter spec - adding one nobody asked for would be
// scope creep this session's own conventions elsewhere avoid), comparison basis is stated as
// none (a single snapshot, not a period-over-period figure), sample size is the total loss count,
// and the exclusions footnote names soft-deleted and demo rows plainly rather than leaving them
// unstated.
function Breakdown({ title, rows }: { title: string; rows: LossReasonBreakdown[] }) {
  return (
    <section className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No losses recorded.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-line first:border-t-0">
                <td className="py-1.5 pr-4 text-ink">{row.label}</td>
                <td className="py-1.5 text-right font-medium text-ink">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function AnalyticsPage() {
  const { allowed } = await checkRouteAccess("/analytics");
  if (!allowed) return <DeniedState message="Analytics is not available for your role." />;

  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") return <DeniedState message="Analytics is not available for your role." />;

  const result = await getLossReasonReport(supabase, session.actor);
  if (!result.ok) {
    return <DeniedState message="The loss-reason report is available to Team Lead, Director, Executive and Tenant Admin roles." />;
  }

  const { report } = result;

  if (report.totalLosses === 0) {
    return (
      <EmptyState
        title="No losses recorded yet"
        description="Once a deal is marked lost, this report breaks it down by reason, practice, value band and competitor."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1 rounded-token border border-line bg-raised p-6">
        <h1 className="text-xl font-semibold text-ink">Loss reasons</h1>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted">Period</dt>
          <dd className="text-ink">All time</dd>
          <dt className="text-muted">Comparison basis</dt>
          <dd className="text-ink">None — single snapshot</dd>
          <dt className="text-muted">Sample size</dt>
          <dd className="text-ink">{report.totalLosses} losses</dd>
          <dt className="text-muted">Exclusions</dt>
          <dd className="text-ink">Soft-deleted and demo deals</dd>
        </dl>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Breakdown title="By reason" rows={report.byReason} />
        <Breakdown title="By practice" rows={report.byPractice} />
        <Breakdown title="By value band" rows={report.byValueBand} />
        <Breakdown title="By competitor" rows={report.byCompetitor} />
      </div>
    </div>
  );
}
