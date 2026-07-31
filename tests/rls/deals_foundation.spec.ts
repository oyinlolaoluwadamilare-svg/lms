import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M1.1 exit criteria (docs/07-build-backlog.md): "pipeline_stages, accounts, deals,
// deal_co_owners migrations with all constraints, including the active-deal-requires-owner-and-
// close-date check." This is a baseline RLS proof for the new tables (docs/05-test-strategy.md's
// rule: no table ships without one) - cross-tenant isolation, the constraint, and D-02's
// practice-wide-read/own-write shape on deals. The FULL exhaustive per-role-action matrix for
// deals is explicitly its own later milestone (M1.8, flagged ⚑) and is not duplicated here.

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
  stageA: "",
  accountA1: "",
  accountA2: "",
  dealOwnedByBde1: "",
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
    "truncate deal_co_owners, deals, account_practice_owners, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant A', 'tenant-a-deals-test') returning id",
  );
  const tenantB = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant B', 'tenant-b-deals-test') returning id",
  );
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

  await grant(ids.tenantA, ids.adminA, "tenant_admin", null);
  await grant(ids.tenantA, ids.execA, "executive", null);
  await grant(ids.tenantA, ids.directorA, "director", ids.practiceA1);
  await grant(ids.tenantA, ids.teamLeadA, "team_lead", ids.practiceA1);
  await grant(ids.tenantA, ids.bdeA1, "bde", ids.practiceA1);
  await grant(ids.tenantA, ids.bdeA2, "bde", ids.practiceA1);

  const stageA = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Discovery', 'DISCOVERY', 1, 10, 'open') returning id`,
    [ids.tenantA],
  );
  ids.stageA = stageA.rows[0].id;

  const accountA1 = await migrator.query(
    "insert into accounts (tenant_id, name) values ($1, 'Client One') returning id",
    [ids.tenantA],
  );
  ids.accountA1 = accountA1.rows[0].id;
  await migrator.query(
    "insert into account_practice_owners (account_id, practice_line_id, owner_id) values ($1, $2, $3)",
    [ids.accountA1, ids.practiceA1, ids.bdeA1],
  );

  // An account owned only via practice A2 - practice A1 identities should not see it.
  const accountA2 = await migrator.query(
    "insert into accounts (tenant_id, name) values ($1, 'Client Two') returning id",
    [ids.tenantA],
  );
  ids.accountA2 = accountA2.rows[0].id;
  await migrator.query(
    "insert into account_practice_owners (account_id, practice_line_id, owner_id) values ($1, $2, $3)",
    [ids.accountA2, ids.practiceA2, ids.bdeA1],
  );

  const deal = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-0001', 'Deal One', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantA, ids.accountA1, ids.practiceA1, ids.stageA, ids.bdeA1],
  );
  ids.dealOwnedByBde1 = deal.rows[0].id;
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

describe("active_deal_requires_owner_and_date", () => {
  it("rejects an active deal with no owner", async () => {
    await expect(
      migrator.query(
        `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
           author_id, status, expected_close_date)
         values ($1, 'D-NOOWNER', 'No Owner', $2, $3, $4, 'new', $5, 'active', current_date + 30)`,
        [ids.tenantA, ids.accountA1, ids.practiceA1, ids.stageA, ids.bdeA1],
      ),
    ).rejects.toThrow(/active_deal_requires_owner_and_date/);
  });

  it("rejects an active deal with no expected close date", async () => {
    await expect(
      migrator.query(
        `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
           owner_id, author_id, status)
         values ($1, 'D-NODATE', 'No Date', $2, $3, $4, 'new', $5, $5, 'active')`,
        [ids.tenantA, ids.accountA1, ids.practiceA1, ids.stageA, ids.bdeA1],
      ),
    ).rejects.toThrow(/active_deal_requires_owner_and_date/);
  });

  it("allows an on_hold deal with neither owner nor close date", async () => {
    const { rows } = await migrator.query(
      `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
         author_id, status)
       values ($1, 'D-ONHOLD', 'On Hold', $2, $3, $4, 'new', $5, 'on_hold')
       returning id`,
      [ids.tenantA, ids.accountA1, ids.practiceA1, ids.stageA, ids.bdeA1],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("cross-tenant isolation on the new tables", () => {
  it.each(["pipeline_stages", "accounts", "deals"] as const)("tenant A reads zero rows of tenant B's %s", async (table) => {
    const client = await asUser(ids.adminA);
    const { rows } = await client.query(`select * from ${table} where tenant_id = $1`, [ids.tenantB]);
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("deals: D-02 practice-wide read, own write", () => {
  it("a bde reads a practice-mate's deal, not just their own", async () => {
    const client = await asUser(ids.bdeA2);
    const { rows } = await client.query("select * from deals where id = $1", [ids.dealOwnedByBde1]);
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("a bde cannot update a practice-mate's deal they don't own, co-own or author", async () => {
    const client = await asUser(ids.bdeA2);
    const { rowCount } = await client.query("update deals set name = 'hijacked' where id = $1", [ids.dealOwnedByBde1]);
    expect(rowCount).toBe(0);
    await client.end();
  });

  it("the owning bde can update their own deal", async () => {
    const client = await asUser(ids.bdeA1);
    const { rowCount } = await client.query("update deals set brief = 'updated' where id = $1", [ids.dealOwnedByBde1]);
    expect(rowCount).toBe(1);
    await client.end();
  });

  it("team_lead can update a deal in their practice they don't own", async () => {
    const client = await asUser(ids.teamLeadA);
    const { rowCount } = await client.query("update deals set brief = 'lead updated' where id = $1", [
      ids.dealOwnedByBde1,
    ]);
    expect(rowCount).toBe(1);
    await client.end();
  });

  it("executive can select deals but cannot update one", async () => {
    const client = await asUser(ids.execA);
    const selectResult = await client.query("select * from deals where id = $1", [ids.dealOwnedByBde1]);
    expect(selectResult.rows).toHaveLength(1);
    const updateResult = await client.query("update deals set brief = 'exec updated' where id = $1", [
      ids.dealOwnedByBde1,
    ]);
    expect(updateResult.rowCount).toBe(0);
    await client.end();
  });
});

describe("migration 0006: updated_at/updated_by trigger", () => {
  it("a real update as a real user advances updated_at and stamps updated_by from auth.uid(), not the caller", async () => {
    const before = await migrator.query("select updated_at from deals where id = $1", [ids.dealOwnedByBde1]);

    const client = await asUser(ids.bdeA1);
    // Deliberately tries to claim someone else did this - proves the trigger's auth.uid() wins
    // over anything a caller's UPDATE statement supplies, the same protection author_id already
    // has against a caller naming a different author (migration 0005).
    await client.query("update deals set brief = 'trigger test', updated_by = $1 where id = $2", [ids.bdeA2, ids.dealOwnedByBde1]);
    await client.end();

    const after = await migrator.query("select updated_at, updated_by from deals where id = $1", [ids.dealOwnedByBde1]);
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(new Date(before.rows[0].updated_at).getTime());
    expect(after.rows[0].updated_by).toBe(ids.bdeA1);
    expect(after.rows[0].updated_by).not.toBe(ids.bdeA2);
  });

  it("a service-role-style write (no auth.uid() context) sets updated_by to null, not a stale value", async () => {
    await migrator.query("update deals set brief = 'migrator update' where id = $1", [ids.dealOwnedByBde1]);
    const { rows } = await migrator.query("select updated_by from deals where id = $1", [ids.dealOwnedByBde1]);
    expect(rows[0].updated_by).toBeNull();
  });
});

describe("deal_co_owners: mirrors deal.add_co_owner's scope", () => {
  it("the owning bde can add a co-owner to their own deal", async () => {
    const client = await asUser(ids.bdeA1);
    const { rowCount } = await client.query(
      "insert into deal_co_owners (deal_id, user_id) values ($1, $2)",
      [ids.dealOwnedByBde1, ids.bdeA2],
    );
    expect(rowCount).toBe(1);
    await client.end();
    // Cleanup via the migrator, not the authenticated client: `authenticated` deliberately has no
    // DELETE grant on any table (CLAUDE.md #3, scripts/db-grants-local.sh) - there being no way
    // for a regular user session to delete this row is correct, not a test inconvenience to work
    // around with a wider grant.
    await migrator.query("delete from deal_co_owners where deal_id = $1 and user_id = $2", [
      ids.dealOwnedByBde1,
      ids.bdeA2,
    ]);
  });

  it("a bde who doesn't own, co-own or author the deal cannot add a co-owner to it", async () => {
    const client = await asUser(ids.bdeA2);
    await expect(
      client.query("insert into deal_co_owners (deal_id, user_id) values ($1, $2)", [ids.dealOwnedByBde1, ids.bdeA2]),
    ).rejects.toThrow(/row-level security/);
    await client.end();
  });
});

describe("accounts: practice-scoped visibility via account_practice_owners", () => {
  it("a bde entitled to practice A1 sees an account owned there", async () => {
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select * from accounts where id = $1", [ids.accountA1]);
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("a bde entitled only to practice A1 does not see an account owned exclusively via practice A2", async () => {
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select * from accounts where id = $1", [ids.accountA2]);
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("tenant_admin sees both accounts regardless of practice", async () => {
    const client = await asUser(ids.adminA);
    const { rows } = await client.query("select id from accounts where tenant_id = $1 order by id", [ids.tenantA]);
    expect(rows).toHaveLength(2);
    await client.end();
  });
});

describe("pipeline_stages: tenant-wide read, tenant_admin-only write", () => {
  it("a bde can read stages in their tenant", async () => {
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select * from pipeline_stages where tenant_id = $1", [ids.tenantA]);
    expect(rows.length).toBeGreaterThan(0);
    await client.end();
  });

  it("a bde cannot insert a pipeline stage", async () => {
    const client = await asUser(ids.bdeA1);
    await expect(
      client.query(
        "insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold) values ($1, 'x', 'X', 99, 50)",
        [ids.tenantA],
      ),
    ).rejects.toThrow(/row-level security/);
    await client.end();
  });

  it("tenant_admin can insert a pipeline stage", async () => {
    const client = await asUser(ids.adminA);
    const { rowCount } = await client.query(
      "insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold) values ($1, 'Proposal', 'PROPOSAL', 2, 40)",
      [ids.tenantA],
    );
    expect(rowCount).toBe(1);
    await client.end();
  });
});
