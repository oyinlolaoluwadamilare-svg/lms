import type { SupabaseClient } from "@supabase/supabase-js";

// The single path for attributing contacts to an activity (docs/03-architecture.md's single-path
// philosophy, the same one insertDealContact already establishes for its own join table) - no
// caller inserts into activity_contacts directly. One statement for every contact rather than one
// call per id: migration 0019's own trg_activity_contact_refresh fires once per inserted row
// regardless, and a single multi-row INSERT is one atomic statement covering every attribution at
// once, not N separately-failable ones. A no-op for an empty list - logActivity's own caller
// always has a (possibly empty) contactIds array, and there is nothing useful to insert for zero
// contacts.
export async function insertActivityContacts(supabase: SupabaseClient, activityId: string, contactIds: string[]): Promise<void> {
  if (contactIds.length === 0) return;

  const { error } = await supabase
    .from("activity_contacts")
    .insert(contactIds.map((contactId) => ({ activity_id: activityId, contact_id: contactId })));

  if (error) throw new Error(`insertActivityContacts failed: ${error.message}`);
}

export interface ActivityContactItem {
  contactId: string;
  firstName: string;
  lastName: string | null;
}

interface RawActivityContactRow {
  activity_id: string;
  contacts: { id: string; first_name: string; last_name: string | null };
}

// For the Engagement timeline (M5.7: docs/06-ui-spec.md's "attributed contacts" field) - batched
// across every activity on the deal in one round trip, the exact same shape
// listDocumentsForActivities/listActivityRevisionsForActivities already established for "one
// related-list fetch per timeline render, keyed by activity id" rather than N per-entry queries.
export async function listContactsForActivities(supabase: SupabaseClient, activityIds: string[]): Promise<Map<string, ActivityContactItem[]>> {
  if (activityIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("activity_contacts")
    .select("activity_id, contacts(id, first_name, last_name)")
    .in("activity_id", activityIds);

  if (error) throw new Error(`listContactsForActivities failed: ${error.message}`);

  const byActivity = new Map<string, ActivityContactItem[]>();
  for (const row of data as unknown as RawActivityContactRow[]) {
    const item: ActivityContactItem = { contactId: row.contacts.id, firstName: row.contacts.first_name, lastName: row.contacts.last_name };
    const existing = byActivity.get(row.activity_id);
    if (existing) existing.push(item);
    else byActivity.set(row.activity_id, [item]);
  }
  return byActivity;
}
