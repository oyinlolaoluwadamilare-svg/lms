import type { SupabaseClient } from "@supabase/supabase-js";

// For a practice-line picker on the create-deal form. Scoped by RLS (practice_lines_select:
// tenant-wide read - "any tenant member reads all practice lines in the tenant," per
// db/migrations/0003_rls_foundation.up.sql).
export async function listPracticeLines(supabase: SupabaseClient): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase
    .from("practice_lines")
    .select("id, name")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order");

  if (error) throw new Error(`listPracticeLines failed: ${error.message}`);
  return data as Array<{ id: string; name: string }>;
}
