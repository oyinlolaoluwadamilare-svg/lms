import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Server-only, and only for the small set of writes that must not be forgeable by an
// RLS-permitted client - currently just audit_entries (db/schema.sql: "written by the service
// role only, never mutated"). Bypasses RLS entirely, so every caller of this client is trusted
// code, never a per-request value derived from user input. Never import this into anything a
// client component could reach; never reference SUPABASE_SERVICE_ROLE_KEY with a NEXT_PUBLIC_
// prefix (CLAUDE.md #1, docs/03-architecture.md Security).
export function createServiceClient() {
  return createSupabaseClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
