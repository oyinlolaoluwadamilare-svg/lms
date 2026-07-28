import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getSessionActor, type ActorResult } from "@/services/actor";

// React's per-request cache() so the layout and the page it wraps each calling this only costs one
// real session/role/tenant fetch, not two - both need it independently (invariant #1: server-side
// authorisation on every path, never relying on a parent having already checked).
export const getCachedActor = cache(async (): Promise<ActorResult> => {
  const supabase = await createClient();
  return getSessionActor(supabase);
});
