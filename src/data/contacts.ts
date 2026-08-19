import type { SupabaseClient } from "@supabase/supabase-js";

export interface Contact {
  id: string;
  accountId: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  isActive: boolean;
  lastEngagedAt: string | null;
}

interface ContactRow {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  is_active: boolean;
  last_engaged_at: string | null;
}

const CONTACT_COLUMNS = "id, account_id, first_name, last_name, job_title, email, phone, linkedin_url, is_active, last_engaged_at";

function toDomain(row: ContactRow): Contact {
  return {
    id: row.id,
    accountId: row.account_id,
    firstName: row.first_name,
    lastName: row.last_name,
    jobTitle: row.job_title,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    isActive: row.is_active,
    // Has a real write path since M5.7 (migration 0019's refresh_contact_engagement(), fired by
    // attributing a contact to a client-facing activity) - null still means "never engaged," not
    // "not implemented yet," for any contact that has never been attributed to one.
    lastEngagedAt: row.last_engaged_at,
  };
}

export interface NewContactInput {
  tenantId: string;
  accountId: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  createdBy: string;
}

// M5.5 (docs/07-build-backlog.md): "`contacts`, `deal_contacts` migrations." createdBy/updatedBy are
// never caller-supplied beyond this one insert-time value - the same "always the acting user, no
// parameter for a different one" shape createDeal's own authorId already established, though
// migration 0006's own trigger is what actually keeps updated_by honest on every later update.
export async function insertContact(supabase: SupabaseClient, input: NewContactInput): Promise<Contact> {
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      tenant_id: input.tenantId,
      account_id: input.accountId,
      first_name: input.firstName,
      last_name: input.lastName,
      job_title: input.jobTitle,
      email: input.email,
      phone: input.phone,
      linkedin_url: input.linkedinUrl,
      created_by: input.createdBy,
    })
    .select(CONTACT_COLUMNS)
    .single();

  if (error) throw new Error(`insertContact failed: ${error.message}`);
  return toDomain(data as ContactRow);
}

// For the Add Contact modal's "pick an existing contact" list (M5.6) - every active contact at the
// deal's own account, not just the ones already linked to this particular deal (the caller,
// getDealContactsSection, filters those out in application code once it has both lists, rather than
// this function needing to know about deal_contacts at all).
export async function listActiveContactsForAccount(supabase: SupabaseClient, accountId: string): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("account_id", accountId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("first_name");

  if (error) throw new Error(`listActiveContactsForAccount failed: ${error.message}`);
  return (data as ContactRow[]).map(toDomain);
}

export interface ContactForAuthorization {
  id: string;
  tenantId: string;
  accountId: string;
}

// For linkContactToDeal's own can()-adjacent checks (src/services/contacts.ts) - just enough to
// confirm the contact exists, which tenant it belongs to, and which account it belongs to (needed
// to derive the account's entitled practice lines, the same way getDealForAuthorization exists for
// deals' own equivalent check).
export async function getContactForAuthorization(supabase: SupabaseClient, contactId: string): Promise<ContactForAuthorization | null> {
  const { data, error } = await supabase.from("contacts").select("id, tenant_id, account_id").eq("id", contactId).is("deleted_at", null).maybeSingle();

  if (error) throw new Error(`getContactForAuthorization failed: ${error.message}`);
  if (!data) return null;

  const row = data as { id: string; tenant_id: string; account_id: string };
  return { id: row.id, tenantId: row.tenant_id, accountId: row.account_id };
}
