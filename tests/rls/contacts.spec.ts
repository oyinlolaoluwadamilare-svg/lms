import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M5.5 exit criteria (docs/07-build-backlog.md): "`contacts`, `deal_contacts` migrations;
// primary-contact invariant." Proves migration 0018's RLS shape: contacts mirrors accounts exactly
// (tenant-wide practice-entitled read/write, no delete - soft delete only via update);
// deal_contacts mirrors deal_co_owners exactly (own/practice/practice/-/tenant, insert+select only,
// per contact.link_to_deal in docs/02-permission-matrix.md) - plus the two trigger-enforced
// invariants: the first contact linked to a deal must be primary, and a linked contact must belong
// to the same account as the deal.

let migrator: pg.Client;

const ids = {
  tenantA: "",
  tenantB: "",
  practiceA: "",
  otherPracticeA: "",
  bdeA: "",
  otherPracticeUserA: "",
  accountA: "",
  otherAccountA: "",
  stageA: "",
  dealA: "",
  contactA1: "",
  contactA2: "",
  otherAccountContact: "",
};

async function makeUser(tenantId: string, email: string) {
  const { rows } = await migrator.query(
    `insert into users (id, tenant_id, full_name, email, status)
     values (uuid_generate_v4(), $1, $2, $3, 'active') returning id`,
    [tenantId, email, email],
  );
  return rows[0].id;
}

async function grant(tenantId: string, userId: string, role: string, practiceLineId: string | null) {
  await migrator.query("insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, $3, $4)", [
    tenantId,
    userId,
    role,
    practiceLineId,
  ]);
}

async function seed() {
  migrator = await migratorClient();
  await migrator.query(
    "truncate deal_contacts, contacts, deals, accounts, account_practice_owners, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-contacts') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-contacts') returning id");
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  const practiceA = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantA],
  );
  ids.practiceA = practiceA.rows[0].id;
  const otherPracticeA = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Executive Search', 'ES') returning id",
    [ids.tenantA],
  );
  ids.otherPracticeA = otherPracticeA.rows[0].id;

  ids.bdeA = await makeUser(ids.tenantA, "bde-contacts-a@example.com");
  ids.otherPracticeUserA = await makeUser(ids.tenantA, "other-practice-contacts-a@example.com");
  await grant(ids.tenantA, ids.bdeA, "bde", ids.practiceA);
  await grant(ids.tenantA, ids.otherPracticeUserA, "bde", ids.otherPracticeA);

  const accountA = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Contacts Test Account') returning id", [
    ids.tenantA,
  ]);
  ids.accountA = accountA.rows[0].id;
  const otherAccountA = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Other Account') returning id", [
    ids.tenantA,
  ]);
  ids.otherAccountA = otherAccountA.rows[0].id;

  await migrator.query("insert into account_practice_owners (account_id, practice_line_id, owner_id) values ($1, $2, $3)", [
    ids.accountA,
    ids.practiceA,
    ids.bdeA,
  ]);

  const stageA = await migrator.query(
    "insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type) values ($1, 'Discovery', 'DISCOVERY', 1, 20, 'open') returning id",
    [ids.tenantA],
  );
  ids.stageA = stageA.rows[0].id;

  const dealA = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type, owner_id, author_id, status, expected_close_date)
     values ($1, 'D-CONTACTS-1', 'Contacts test deal', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30) returning id`,
    [ids.tenantA, ids.accountA, ids.practiceA, ids.stageA, ids.bdeA],
  );
  ids.dealA = dealA.rows[0].id;

  const contactA1 = await migrator.query("insert into contacts (tenant_id, account_id, first_name) values ($1, $2, 'Alice') returning id", [
    ids.tenantA,
    ids.accountA,
  ]);
  ids.contactA1 = contactA1.rows[0].id;
  const contactA2 = await migrator.query("insert into contacts (tenant_id, account_id, first_name) values ($1, $2, 'Bob') returning id", [
    ids.tenantA,
    ids.accountA,
  ]);
  ids.contactA2 = contactA2.rows[0].id;
  const otherAccountContact = await migrator.query(
    "insert into contacts (tenant_id, account_id, first_name) values ($1, $2, 'Carol') returning id",
    [ids.tenantA, ids.otherAccountA],
  );
  ids.otherAccountContact = otherAccountContact.rows[0].id;
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

async function tryQuery(client: pg.Client, sql: string, params: unknown[]): Promise<pg.QueryResult | false> {
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (err instanceof Error && /row-level security/.test(err.message)) return false;
    throw err;
  }
}

describe("contacts RLS: mirrors accounts_select/accounts_update exactly", () => {
  it("a bde entitled to the account's practice can read and create contacts on it", async () => {
    const client = await asUser(ids.bdeA);
    const { rows } = await client.query("select id from contacts where account_id = $1", [ids.accountA]);
    expect(rows).toHaveLength(2);

    const inserted = await tryQuery(
      client,
      "insert into contacts (tenant_id, account_id, first_name) values ($1, $2, 'Dave')",
      [ids.tenantA, ids.accountA],
    );
    await client.end();
    expect(inserted).not.toBe(false);
    await migrator.query("delete from contacts where account_id = $1 and first_name = 'Dave'", [ids.accountA]);
  });

  it("a bde in a different practice, with no account_practice_owners entitlement, cannot see the account's contacts", async () => {
    const client = await asUser(ids.otherPracticeUserA);
    const { rows } = await client.query("select id from contacts where account_id = $1", [ids.accountA]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("a user in a different tenant cannot see them at all", async () => {
    const otherTenantUser = await makeUser(ids.tenantB, "user-b-contacts@example.com");
    await grant(ids.tenantB, otherTenantUser, "tenant_admin", null);
    const client = await asUser(otherTenantUser);
    const { rows } = await client.query("select id from contacts where account_id = $1", [ids.accountA]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("no delete policy - soft delete only, via update setting deleted_at", async () => {
    const client = await asUser(ids.bdeA);
    const result = await client.query("delete from contacts where id = $1", [ids.contactA1]);
    await client.end();
    expect(result.rowCount).toBe(0);

    const { rows } = await migrator.query("select id from contacts where id = $1", [ids.contactA1]);
    expect(rows).toHaveLength(1);
  });
});

describe("deal_contacts RLS: mirrors deal_co_owners_select/deal_co_owners_insert exactly", () => {
  it("the deal's own bde owner can link its first contact as primary", async () => {
    const client = await asUser(ids.bdeA);
    const inserted = await tryQuery(
      client,
      "insert into deal_contacts (deal_id, contact_id, is_primary, added_by) values ($1, $2, true, $3)",
      [ids.dealA, ids.contactA1, ids.bdeA],
    );
    expect(inserted).not.toBe(false);
    const { rows } = await client.query("select deal_id, contact_id, is_primary from deal_contacts where deal_id = $1", [ids.dealA]);
    await client.end();
    expect(rows).toEqual([{ deal_id: ids.dealA, contact_id: ids.contactA1, is_primary: true }]);
  });

  it("a bde outside the deal's practice cannot link a contact to it", async () => {
    const client = await asUser(ids.otherPracticeUserA);
    const inserted = await tryQuery(
      client,
      "insert into deal_contacts (deal_id, contact_id, is_primary, added_by) values ($1, $2, false, $3)",
      [ids.dealA, ids.contactA2, ids.otherPracticeUserA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("rejects linking a second contact as primary (one_primary_contact partial unique index)", async () => {
    await expect(
      migrator.query("insert into deal_contacts (deal_id, contact_id, is_primary, added_by) values ($1, $2, true, $3)", [
        ids.dealA,
        ids.contactA2,
        ids.bdeA,
      ]),
    ).rejects.toThrow(/one_primary_contact/);
  });

  it("accepts a second, non-primary contact", async () => {
    const result = await migrator.query(
      "insert into deal_contacts (deal_id, contact_id, is_primary, added_by) values ($1, $2, false, $3) returning deal_id",
      [ids.dealA, ids.contactA2, ids.bdeA],
    );
    expect(result.rowCount).toBe(1);
  });

  it("rejects linking a contact from a different account than the deal (trg_validate_deal_contact)", async () => {
    await expect(
      migrator.query("insert into deal_contacts (deal_id, contact_id, is_primary, added_by) values ($1, $2, false, $3)", [
        ids.dealA,
        ids.otherAccountContact,
        ids.bdeA,
      ]),
    ).rejects.toThrow(/belongs to a different account/);
  });

  it("no update or delete policy - not even the deal's owner can change decision_role or is_primary, or unlink a contact", async () => {
    const client = await asUser(ids.bdeA);
    const updateResult = await client.query("update deal_contacts set decision_role = 'champion' where deal_id = $1 and contact_id = $2", [
      ids.dealA,
      ids.contactA2,
    ]);
    expect(updateResult.rowCount).toBe(0);
    const deleteResult = await client.query("delete from deal_contacts where deal_id = $1 and contact_id = $2", [ids.dealA, ids.contactA2]);
    expect(deleteResult.rowCount).toBe(0);
    await client.end();

    const { rows } = await migrator.query("select decision_role from deal_contacts where deal_id = $1 and contact_id = $2", [
      ids.dealA,
      ids.contactA2,
    ]);
    expect(rows[0].decision_role).toBe("unknown");
  });
});

describe("trg_validate_deal_contact: the first contact linked to a deal must be primary", () => {
  it("rejects a deal's first contact if not marked primary", async () => {
    const freshDeal = await migrator.query(
      `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type, owner_id, author_id, status, expected_close_date)
       values ($1, 'D-CONTACTS-2', 'Second contacts test deal', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30) returning id`,
      [ids.tenantA, ids.accountA, ids.practiceA, ids.stageA, ids.bdeA],
    );
    const freshDealId = freshDeal.rows[0].id;

    await expect(
      migrator.query("insert into deal_contacts (deal_id, contact_id, is_primary, added_by) values ($1, $2, false, $3)", [
        freshDealId,
        ids.contactA1,
        ids.bdeA,
      ]),
    ).rejects.toThrow(/first contact linked to a deal must be marked primary/);

    const { rows } = await migrator.query("select count(*)::int as n from deal_contacts where deal_id = $1", [freshDealId]);
    expect(rows[0].n).toBe(0);
  });
});
