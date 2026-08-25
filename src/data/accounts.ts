import type { SupabaseClient } from "@supabase/supabase-js";

// For an account picker on the create-deal form. Scoped entirely by RLS (accounts_select:
// practice-entitled accounts for bde/team_lead/director, tenant-wide for executive/tenant_admin) -
// no extra filtering needed here, the caller's own session already restricts the rows returned.
export async function listAccounts(supabase: SupabaseClient): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from("accounts").select("id, name").is("deleted_at", null).order("name");

  if (error) throw new Error(`listAccounts failed: ${error.message}`);
  return data as Array<{ id: string; name: string }>;
}

// For src/services/contacts.ts's own practice-entitlement check (M5.5) - an account can be owned by
// MORE than one practice line (account_practice_owners is a many-to-many, migration 0005's own
// "practice lines that sell into the same client" reasoning), so contact.create/contact.update's
// "practice" scope can't be expressed as a single practiceLineId on can()'s Resource the way a
// deal's own single practice_line_id can. This returns every practice line entitled to the account;
// the caller checks membership against its own role grants directly, the same way
// account_has_entitled_practice() computes the equivalent set at the RLS layer.
export async function listPracticeLineIdsForAccount(supabase: SupabaseClient, accountId: string): Promise<string[]> {
  const { data, error } = await supabase.from("account_practice_owners").select("practice_line_id").eq("account_id", accountId);

  if (error) throw new Error(`listPracticeLineIdsForAccount failed: ${error.message}`);
  return (data as Array<{ practice_line_id: string }>).map((row) => row.practice_line_id);
}

export interface AccountForAuthorization {
  id: string;
  tenantId: string;
}

// For reassignAccountPracticeOwner's own can() check (src/services/accounts.ts, M5.9) - just enough
// to build the Resource's tenantId, the same "one getter, several callers with an identical need"
// reasoning src/data/deals.ts's getDealForAuthorization and src/data/contacts.ts's
// getContactForAuthorization already establish. Reads through the CALLER's own RLS-scoped session
// (accounts_select) - null means either the account doesn't exist or this actor can't see it,
// deliberately not distinguished, the same not-confirming-existence shape every other not_found
// case in this codebase already uses.
export async function getAccountForAuthorization(supabase: SupabaseClient, accountId: string): Promise<AccountForAuthorization | null> {
  const { data, error } = await supabase.from("accounts").select("id, tenant_id").eq("id", accountId).is("deleted_at", null).maybeSingle();

  if (error) throw new Error(`getAccountForAuthorization failed: ${error.message}`);
  if (!data) return null;

  const row = data as { id: string; tenant_id: string };
  return { id: row.id, tenantId: row.tenant_id };
}

// The only place account_practice_owners.owner_id is written from application code - called
// exclusively by src/services/accounts.ts's reassignAccountPracticeOwner (M5.9). Mirrors
// src/data/deals.ts's updateDealOwner exactly - a plain single-column update through the caller's
// own RLS-scoped session, migration 0005's own account_practice_owners_update policy comment
// ("reassignment is an update to owner_id, not a delete+insert") already anticipates exactly this.
export async function updateAccountPracticeOwner(
  supabase: SupabaseClient,
  accountId: string,
  practiceLineId: string,
  newOwnerId: string,
): Promise<void> {
  const { error } = await supabase
    .from("account_practice_owners")
    .update({ owner_id: newOwnerId })
    .eq("account_id", accountId)
    .eq("practice_line_id", practiceLineId);

  if (error) throw new Error(`updateAccountPracticeOwner failed: ${error.message}`);
}

export interface AccountListItem {
  id: string;
  name: string;
  industry: string | null;
  region: string | null;
}

// For the Accounts list page (M5.8) - the entry point into Account 360, since nothing else in this
// codebase links to /accounts/[id] yet. Deliberately minimal (name, industry, region) rather than
// the richer per-practice-line owner detail Account 360 itself shows - a directory list's job is
// letting a viewer find and open the right account, not duplicate the 360 view's own content.
// Scoped entirely by RLS (accounts_select), the same reasoning listAccounts' own comment gives.
export async function listAccountsForDirectory(supabase: SupabaseClient): Promise<AccountListItem[]> {
  const { data, error } = await supabase.from("accounts").select("id, name, industry, region").is("deleted_at", null).order("name");

  if (error) throw new Error(`listAccountsForDirectory failed: ${error.message}`);
  return data as AccountListItem[];
}

export interface AccountDetail {
  id: string;
  name: string;
  industry: string | null;
  region: string | null;
  parentAccountName: string | null;
}

interface AccountDetailRow {
  id: string;
  name: string;
  industry: string | null;
  region: string | null;
  parent_account: { name: string } | null;
}

// For Account 360's header (M5.8: "Header with account, industry, region, parent group, owner").
// Reads through the CALLER's own RLS-scoped session - accounts_select (migration 0005) already
// scopes this to the caller's tenant/practice entitlement (or tenant-wide for executive/
// tenant_admin), the same authorisation boundary getDealDetail already relies on for its own
// account embed. Returns null both when the account genuinely doesn't exist and when RLS excludes
// it from this caller's view - deliberately not distinguished, the same not-confirming-existence
// shape every other not_found case in this codebase already uses. `parentAccountName` is a
// self-join (`parent_account_id` references `accounts(id)`) - null for an account with no parent,
// which is the common case (no code path sets parent_account_id yet).
export async function getAccountDetail(supabase: SupabaseClient, accountId: string): Promise<AccountDetail | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, industry, region, parent_account:accounts!parent_account_id(name)")
    .eq("id", accountId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getAccountDetail failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as AccountDetailRow;
  return { id: row.id, name: row.name, industry: row.industry, region: row.region, parentAccountName: row.parent_account?.name ?? null };
}

export interface AccountPracticeOwner {
  practiceLineId: string;
  practiceLineName: string;
  ownerId: string;
  ownerName: string;
}

interface AccountPracticeOwnerRow {
  practice_line_id: string;
  owner_id: string;
  practice_lines: { name: string } | null;
  owner: { full_name: string } | null;
}

// For Account 360's header (M5.8): D-03's own invariant is "exactly one owner per practice-line
// relationship on an account," so this can return more than one row for the same account -
// docs/01-domain-model.md:67's own example ("a client sold to by two practice lines has two rows,
// potentially two different owners"). Reads through the CALLER's own RLS-scoped session -
// account_practice_owners_select (migration 0005) already scopes rows to the caller's own practice
// entitlement (or tenant-wide for executive/tenant_admin), so a bde only ever sees the practice-line
// relationships they're actually entitled to, never every relationship the account happens to have.
export async function listPracticeLineOwnersForAccount(supabase: SupabaseClient, accountId: string): Promise<AccountPracticeOwner[]> {
  const { data, error } = await supabase
    .from("account_practice_owners")
    .select("practice_line_id, owner_id, practice_lines(name), owner:users!owner_id(full_name)")
    .eq("account_id", accountId);

  if (error) throw new Error(`listPracticeLineOwnersForAccount failed: ${error.message}`);

  return (data as unknown as AccountPracticeOwnerRow[]).map((row) => {
    if (!row.practice_lines || !row.owner) {
      throw new Error(`account_practice_owners row for account ${accountId} has no resolvable practice line or owner - invariant violated`);
    }
    return { practiceLineId: row.practice_line_id, practiceLineName: row.practice_lines.name, ownerId: row.owner_id, ownerName: row.owner.full_name };
  });
}
