import Link from "next/link";
import { can } from "@/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { viewToggleHref, type PipelineSearchParams } from "@/lib/pipelineViewLinks";
import { getPipelineFilterOptions, listPipelineDeals, type DealListFilters } from "@/services/deals";
import { DeniedState } from "@/ui/states/DeniedState";
import { EmptyState } from "@/ui/states/EmptyState";
import { getCachedActor } from "../_actor";
import { checkRouteAccess } from "../_access";
import { PipelineBoard } from "./PipelineBoard";
import { PipelineFilters } from "./PipelineFilters";
import { PipelineTable } from "./PipelineTable";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_TYPES = new Set(["new", "existing"]);
const FORECAST_CATEGORIES = new Set(["pipeline", "best_case", "commit", "closed"]);
const STATUSES = new Set(["active", "won", "lost", "on_hold"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function uuidOrUndefined(value: string | undefined): string | undefined {
  return value && UUID_RE.test(value) ? value : undefined;
}

function enumOrUndefined<T extends string>(value: string | undefined, allowed: Set<string>): T | undefined {
  return value && allowed.has(value) ? (value as T) : undefined;
}

function dateOrUndefined(value: string | undefined): string | undefined {
  return value && DATE_RE.test(value) ? value : undefined;
}

type SearchParams = PipelineSearchParams;

export default async function DealsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { allowed } = await checkRouteAccess("/deals");
  if (!allowed) return <DeniedState message="Pipeline is not available for your role." />;

  const params = await searchParams;
  const filters: DealListFilters = {
    stageId: uuidOrUndefined(params.stage),
    ownerId: uuidOrUndefined(params.owner),
    practiceLineId: uuidOrUndefined(params.practiceLine),
    accountId: uuidOrUndefined(params.account),
    clientType: enumOrUndefined(params.clientType, CLIENT_TYPES),
    forecastCategory: enumOrUndefined(params.forecastCategory, FORECAST_CATEGORIES),
    status: enumOrUndefined(params.status, STATUSES),
    expectedCloseFrom: dateOrUndefined(params.closeFrom),
    expectedCloseTo: dateOrUndefined(params.closeTo),
  };

  const supabase = await createClient();
  const result = await getCachedActor();
  const canCreate = result.status === "active" && can(result.actor, "deal.create");

  const [filterOptions, deals] = await Promise.all([
    getPipelineFilterOptions(supabase),
    listPipelineDeals(supabase, filters),
  ]);

  const hasAnyFilter = Object.values(filters).some((v) => v !== undefined);
  const view = params.view === "board" ? "board" : "table";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Pipeline</h1>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-token border border-line text-sm">
            {/* prefetch={false} throughout this page: every destination is dynamic and
                RLS-gated (filtered results, a fresh form, a different view of the same data) -
                see src/ui/nav/Nav.tsx's comment for the full reasoning. */}
            <Link
              href={viewToggleHref(params, "table")}
              prefetch={false}
              aria-current={view === "table" ? "page" : undefined}
              className={`px-3 py-1.5 ${view === "table" ? "bg-accent text-surface" : "bg-surface text-ink"}`}
            >
              Table
            </Link>
            <Link
              href={viewToggleHref(params, "board")}
              prefetch={false}
              aria-current={view === "board" ? "page" : undefined}
              className={`px-3 py-1.5 ${view === "board" ? "bg-accent text-surface" : "bg-surface text-ink"}`}
            >
              Board
            </Link>
          </div>
          {canCreate ? (
            <Link
              href="/deals/new"
              prefetch={false}
              className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              New deal
            </Link>
          ) : null}
        </div>
      </div>

      <PipelineFilters
        accounts={filterOptions.accounts.map((a) => ({ id: a.id, label: a.name }))}
        practiceLines={filterOptions.practiceLines.map((p) => ({ id: p.id, label: p.name }))}
        stages={filterOptions.stages.map((s) => ({ id: s.id, label: s.name }))}
        owners={filterOptions.owners.map((o) => ({ id: o.id, label: `${o.fullName} (${o.email})` }))}
        values={{
          stage: params.stage,
          owner: params.owner,
          practiceLine: params.practiceLine,
          account: params.account,
          clientType: params.clientType,
          forecastCategory: params.forecastCategory,
          status: params.status,
          closeFrom: params.closeFrom,
          closeTo: params.closeTo,
        }}
        view={view === "board" ? "board" : undefined}
      />

      {deals.length === 0 ? (
        <EmptyState
          title={hasAnyFilter ? "No deals match these filters" : "No deals to show yet"}
          description={
            hasAnyFilter
              ? "Try clearing a filter to widen the results."
              : "Deals created for your practice will appear here."
          }
          action={canCreate && !hasAnyFilter ? { label: "New deal", href: "/deals/new" } : undefined}
        />
      ) : view === "board" ? (
        <PipelineBoard deals={deals} stages={filterOptions.stages} />
      ) : (
        <PipelineTable deals={deals} />
      )}
    </div>
  );
}
