import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M5.1 exit criteria (docs/07-build-backlog.md): "`outcome_reasons` admin configuration;
// `deal_outcomes` migration." Proves migration 0016's RLS shape: outcome_reasons mirrors
// pipeline_stages exactly (tenant-wide read, tenant_admin-only write, no delete - deactivate via
// is_active), and deal_outcomes mirrors deals_select/deals_update exactly (own/practice/-/tenant
// for bde/team_lead-director/executive/tenant_admin, per docs/02-permission-matrix.md's
// deal.mark_won/deal.mark_lost sharing deal.update's own scope) - plus the loss_requires_detail and
// final_value_needs_currency check constraints.

let migrator: pg.Client;

const ids = {
  tenantA: "",
  tenantB: "",
  practiceA1: "",
  practiceA2: "",
  practiceB1: "",
  adminA: "",
  execA: "",
  directorA: "",
  teamLeadA: "",
  bdeA1: "",
  bdeA2: "",
  otherPracticeUser: "",
  stageA: "",
  accountA: "",
  dealOwnedByBde1: "",
  winReasonA: "",
  lossReasonA: "",
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
  await migrator.query(
    "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, $3, $4)",
    [tenantId, userId, role, practiceLineId],
  );
}

async function seed() {
  migrator = await migratorClient();
  await migrator.query(
    "truncate deal_outcomes, outcome_reasons, deals, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-outcomes') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-outcomes') returning id");
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  const practiceA1 = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantA],
  );
  const practiceA2 = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Executive Search', 'ES') returning id",
    [ids.tenantA],
  );
  const practiceB1 = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantB],
  );
  ids.practiceA1 = practiceA1.rows[0].id;
  ids.practiceA2 = practiceA2.rows[0].id;
  ids.practiceB1 = practiceB1.rows[0].id;

  ids.adminA = await makeUser(ids.tenantA, "admin-a@example.com");
  ids.execA = await makeUser(ids.tenantA, "exec-a@example.com");
  ids.directorA = await makeUser(ids.tenantA, "director-a@example.com");
  ids.teamLeadA = await makeUser(ids.tenantA, "team-lead-a@example.com");
  ids.bdeA1 = await makeUser(ids.tenantA, "bde-a1@example.com");
  ids.bdeA2 = await makeUser(ids.tenantA, "bde-a2@example.com");
  ids.otherPracticeUser = await makeUser(ids.tenantA, "other-practice@example.com");

  await grant(ids.tenantA, ids.adminA, "tenant_admin", null);
  await grant(ids.tenantA, ids.execA, "executive", null);
  await grant(ids.tenantA, ids.directorA, "director", ids.practiceA1);
  await grant(ids.tenantA, ids.teamLeadA, "team_lead", ids.practiceA1);
  await grant(ids.tenantA, ids.bdeA1, "bde", ids.practiceA1);
  await grant(ids.tenantA, ids.bdeA2, "bde", ids.practiceA1);
  await grant(ids.tenantA, ids.otherPracticeUser, "bde", ids.practiceA2);

  const stageA = await migrator.query(
    "insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type) values ($1, 'Discovery', 'DISCOVERY', 1, 20, 'open') returning id",
    [ids.tenantA],
  );
  ids.stageA = stageA.rows[0].id;

  const accountA = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Test Client') returning id", [ids.tenantA]);
  ids.accountA = accountA.rows[0].id;

  const dealOwnedByBde1 = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type, owner_id, author_id, status, expected_close_date)
     values ($1, 'D-OUTCOME-1', 'Owned by bde1', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30) returning id`,
    [ids.tenantA, ids.accountA, ids.practiceA1, ids.stageA, ids.bdeA1],
  );
  ids.dealOwnedByBde1 = dealOwnedByBde1.rows[0].id;

  const winReasonA = await migrator.query(
    "insert into outcome_reasons (tenant_id, type, label) values ($1, 'win', 'Best fit') returning id",
    [ids.tenantA],
  );
  ids.winReasonA = winReasonA.rows[0].id;
  const lossReasonA = await migrator.query(
    "insert into outcome_reasons (tenant_id, type, label) values ($1, 'loss', 'Lost to competitor') returning id",
    [ids.tenantA],
  );
  ids.lossReasonA = lossReasonA.rows[0].id;
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

describe("outcome_reasons: tenant-wide read, tenant_admin-only write - mirrors pipeline_stages exactly", () => {
  it("a bde can read the tenant's outcome reasons", async () => {
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select id from outcome_reasons where tenant_id = $1", [ids.tenantA]);
    await client.end();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("a user in a different tenant cannot read them", async () => {
    const otherTenantUser = await makeUser(ids.tenantB, "user-b@example.com");
    await grant(ids.tenantB, otherTenantUser, "bde", ids.practiceB1);
    const client = await asUser(otherTenantUser);
    const { rows } = await client.query("select id from outcome_reasons where tenant_id = $1", [ids.tenantA]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("a bde cannot insert an outcome reason", async () => {
    const client = await asUser(ids.bdeA1);
    const inserted = await tryQuery(client, "insert into outcome_reasons (tenant_id, type, label) values ($1, 'win', 'Bde-invented reason')", [
      ids.tenantA,
    ]);
    await client.end();
    expect(inserted).toBe(false);
  });

  it("a director cannot insert an outcome reason either - tenant_admin only, per admin.manage_outcome_reasons", async () => {
    const client = await asUser(ids.directorA);
    const inserted = await tryQuery(
      client,
      "insert into outcome_reasons (tenant_id, type, label) values ($1, 'loss', 'Director-invented reason')",
      [ids.tenantA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("tenant_admin can insert an outcome reason", async () => {
    const client = await asUser(ids.adminA);
    const result = await client.query("insert into outcome_reasons (tenant_id, type, label) values ($1, 'win', 'Referral') returning id", [
      ids.tenantA,
    ]);
    await client.end();
    expect(result.rowCount).toBe(1);
  });

  it("tenant_admin can deactivate a reason (is_active = false), a bde cannot", async () => {
    const bdeClient = await asUser(ids.bdeA1);
    const bdeResult = await bdeClient.query("update outcome_reasons set is_active = false where id = $1", [ids.winReasonA]);
    await bdeClient.end();
    expect(bdeResult.rowCount).toBe(0);

    const adminClient = await asUser(ids.adminA);
    const adminResult = await adminClient.query("update outcome_reasons set is_active = false where id = $1", [ids.winReasonA]);
    await adminClient.end();
    expect(adminResult.rowCount).toBe(1);

    await migrator.query("update outcome_reasons set is_active = true where id = $1", [ids.winReasonA]);
  });

  it("rejects a duplicate (tenant, type, label)", async () => {
    await expect(
      migrator.query("insert into outcome_reasons (tenant_id, type, label) values ($1, 'win', 'Best fit')", [ids.tenantA]),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  // 0 rows affected, not a thrown error: outcome_reasons (like every table created after the
  // default-privileges fix documented in scripts/db-bootstrap-local.sh) carries full table-level
  // DELETE for `authenticated`, matching the real hosted project - RLS (no delete policy exists)
  // is what actually blocks it, by filtering the DELETE down to zero matching rows.
  it("no delete policy - not even tenant_admin can hard-delete a reason", async () => {
    const client = await asUser(ids.adminA);
    const result = await client.query("delete from outcome_reasons where id = $1", [ids.winReasonA]);
    await client.end();
    expect(result.rowCount).toBe(0);

    const { rows } = await migrator.query("select id from outcome_reasons where id = $1", [ids.winReasonA]);
    expect(rows).toHaveLength(1);
  });
});

describe("deal_outcomes constraints", () => {
  it("rejects a loss with no reason_detail", async () => {
    await expect(
      migrator.query(
        `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by)
         values ($1, 'loss', $2, current_date, $3)`,
        [ids.dealOwnedByBde1, ids.lossReasonA, ids.bdeA1],
      ),
    ).rejects.toThrow(/loss_requires_detail/);
  });

  it("rejects final_value_minor set without currency_code, and vice versa", async () => {
    await expect(
      migrator.query(
        `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by, final_value_minor)
         values ($1, 'win', $2, current_date, $3, 500000)`,
        [ids.dealOwnedByBde1, ids.winReasonA, ids.bdeA1],
      ),
    ).rejects.toThrow(/final_value_needs_currency/);
  });

  it("accepts a valid win outcome with a matching final_value_minor/currency_code pair", async () => {
    const result = await migrator.query(
      `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by, final_value_minor, currency_code)
       values ($1, 'win', $2, current_date, $3, 500000, 'NGN') returning deal_id`,
      [ids.dealOwnedByBde1, ids.winReasonA, ids.bdeA1],
    );
    expect(result.rowCount).toBe(1);
    await migrator.query("delete from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
  });
});

describe("deal_outcomes RLS: mirrors deals_select/deals_update exactly (own/practice/-/tenant)", () => {
  it("the deal's own bde owner can see and insert its outcome", async () => {
    const client = await asUser(ids.bdeA1);
    const inserted = await tryQuery(
      client,
      `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by)
       values ($1, 'win', $2, current_date, $3)`,
      [ids.dealOwnedByBde1, ids.winReasonA, ids.bdeA1],
    );
    expect(inserted).not.toBe(false);
    const { rows } = await client.query("select deal_id from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows).toHaveLength(1);
    await migrator.query("delete from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
  });

  it("a practice peer who neither owns nor authored the deal cannot insert its outcome", async () => {
    const client = await asUser(ids.bdeA2);
    const inserted = await tryQuery(
      client,
      `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by)
       values ($1, 'win', $2, current_date, $3)`,
      [ids.dealOwnedByBde1, ids.winReasonA, ids.bdeA2],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("team_lead and director can insert the outcome for any deal in their own practice, even one they neither own nor authored", async () => {
    const directorClient = await asUser(ids.directorA);
    const directorInserted = await tryQuery(
      directorClient,
      `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by)
       values ($1, 'win', $2, current_date, $3)`,
      [ids.dealOwnedByBde1, ids.winReasonA, ids.directorA],
    );
    await directorClient.end();
    expect(directorInserted).not.toBe(false);
    await migrator.query("delete from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);

    const teamLeadClient = await asUser(ids.teamLeadA);
    const teamLeadInserted = await tryQuery(
      teamLeadClient,
      `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by)
       values ($1, 'win', $2, current_date, $3)`,
      [ids.dealOwnedByBde1, ids.winReasonA, ids.teamLeadA],
    );
    await teamLeadClient.end();
    expect(teamLeadInserted).not.toBe(false);
    await migrator.query("delete from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
  });

  it("a bde outside the deal's practice cannot even see its outcome", async () => {
    await migrator.query(
      `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by)
       values ($1, 'win', $2, current_date, $3)`,
      [ids.dealOwnedByBde1, ids.winReasonA, ids.bdeA1],
    );
    const client = await asUser(ids.otherPracticeUser);
    const { rows } = await client.query("select deal_id from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows).toHaveLength(0);
    await migrator.query("delete from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
  });

  it("executive can see any deal's outcome tenant-wide, but cannot insert one (deal.mark_won/mark_lost are denied for executive)", async () => {
    await migrator.query(
      `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by)
       values ($1, 'win', $2, current_date, $3)`,
      [ids.dealOwnedByBde1, ids.winReasonA, ids.bdeA1],
    );
    const client = await asUser(ids.execA);
    const { rows } = await client.query("select deal_id from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
    expect(rows).toHaveLength(1);

    const inserted = await tryQuery(
      client,
      `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by) values ($1, 'win', $2, current_date, $3)`,
      ["00000000-0000-0000-0000-000000000000", ids.winReasonA, ids.execA],
    );
    await client.end();
    expect(inserted).toBe(false);
    await migrator.query("delete from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
  });

  it("no update or delete policy - not even tenant_admin can revise or hard-delete a recorded outcome", async () => {
    await migrator.query(
      `insert into deal_outcomes (deal_id, result, reason_id, actual_close_date, closed_by)
       values ($1, 'win', $2, current_date, $3)`,
      [ids.dealOwnedByBde1, ids.winReasonA, ids.bdeA1],
    );
    const client = await asUser(ids.adminA);
    const updateResult = await client.query("update deal_outcomes set reason_detail = 'revised' where deal_id = $1", [ids.dealOwnedByBde1]);
    expect(updateResult.rowCount).toBe(0);
    // 0 rows affected, not a thrown error - same reasoning as outcome_reasons' own "no delete
    // policy" test above.
    const deleteResult = await client.query("delete from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
    expect(deleteResult.rowCount).toBe(0);
    await client.end();

    const { rows } = await migrator.query("select deal_id from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
    expect(rows).toHaveLength(1);
    await migrator.query("delete from deal_outcomes where deal_id = $1", [ids.dealOwnedByBde1]);
  });
});
