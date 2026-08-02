import type { SupabaseClient } from "@supabase/supabase-js";
import { insertStageEvent } from "@/data/stageEvents";
import { createServiceClient } from "@/lib/supabase/service";
import type { StageEvent, StageEventInput } from "@/domain/stageEvent";

// The single path for writing a stage_events row (docs/01-domain-model.md: "written by the service
// layer on every transition path... There must be exactly one code path that moves a stage" -
// docs/07-build-backlog.md's M2.2 makes that path src/services/deals.ts's changeStage). Mirrors
// src/services/audit.ts's writeAudit exactly: a service_role client internally, since stage_events
// (migration 0007) has no insert policy at all for the `authenticated` role.
//
// Same disclosed gap writeAudit's own comment already flags for every compound write in this
// Supabase-client architecture: this insert, the deal update, and the audit entry are three
// separate calls, not one transaction. Not fixed here - the real fix (a single Postgres function
// invoked through one .rpc() call) is flagged there already and applies equally to this.
export async function writeStageEvent(
  input: StageEventInput,
  serviceClient: SupabaseClient = createServiceClient(),
): Promise<StageEvent> {
  return insertStageEvent(serviceClient, input);
}
