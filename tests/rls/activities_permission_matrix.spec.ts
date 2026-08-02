import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M3.3 exit criteria (docs/07-build-backlog.md): "⚑ RLS policy for activity insert, with the named
// test 'a user holding only the bde role can create an activity on a deal they own'. This is the
// predecessor's exact defect; it must be impossible to regress." tests/rls/activities.spec.ts
// (M3.1) already proved this scenario and a foundational baseline (RLS scoping, the derived/
// generated columns, the constraints); this file is the exhaustive per-role x per-resource-shape
// matrix, mirroring tests/rls/deals_permission_matrix.spec.ts's structure exactly - the same
// M1.1-to-M1.8 relationship applied to activities. tests/permissions/matrix.spec.ts's own
// "bde can create an activity on a deal they own" is this file's application-layer counterpart.
//
// The one shape worth calling out explicitly: activities_select mirrors deals_select (practice-wide
// READ for every scoped role, tenant-wide for executive/tenant_admin), but activities_insert
// mirrors deals_UPDATE, not deals_select - a bde may read every activity in their practice but may
// only CREATE one on a deal they own/co-own/authored, exactly the D-02 read/write asymmetry
// deals_permission_matrix.spec.ts already documents for deals themselves.

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
  otherTenantUser: "",
  stageA: "",
  stageB: "",
  accountA1: "",
  accountA2: "",
  accountB1: "",
  dealOwn: "",
  dealOtherPractice: "",
  dealOtherTenant: "",
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
    "truncate activities, deal_co_owners, deals, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant A', 'tenant-a-activities-matrix') returning id",
  );
  const tenantB = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant B', 'tenant-b-activities-matrix') returning id",
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
  ids.otherPracticeUser = await makeUser(ids.tenantA, "other-practice@example.com");
  ids.otherTenantUser = await makeUser(ids.tenantB, "other-tenant@example.com");

  await grant(ids.tenantA, ids.adminA, "tenant_admin", null);
  await grant(ids.tenantA, ids.execA, "executive", null);
  await grant(ids.tenantA, ids.directorA, "director", ids.practiceA1);
  await grant(ids.tenantA, ids.teamLeadA, "team_lead", ids.practiceA1);
  await grant(ids.tenantA, ids.bdeA1, "bde", ids.practiceA1);
  await grant(ids.tenantA, ids.bdeA2, "bde", ids.practiceA1);
  await grant(ids.tenantA, ids.otherPracticeUser, "bde", ids.practiceA2);
  await grant(ids.tenantB, ids.otherTenantUser, "bde", ids.practiceB1);

  const stageA = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Discovery', 'DISCOVERY', 1, 10, 'open') returning id`,
    [ids.tenantA],
  );
  const stageB = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Discovery', 'DISCOVERY', 1, 10, 'open') returning id`,
    [ids.tenantB],
  );
  ids.stageA = stageA.rows[0].id;
  ids.stageB = stageB.rows[0].id;

  const accountA1 = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client A1') returning id", [ids.tenantA]);
  const accountA2 = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client A2') returning id", [ids.tenantA]);
  const accountB1 = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client B1') returning id", [ids.tenantB]);
  ids.accountA1 = accountA1.rows[0].id;
  ids.accountA2 = accountA2.rows[0].id;
  ids.accountB1 = accountB1.rows[0].id;

  const dealOwn = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-OWN', 'Own Deal', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantA, ids.accountA1, ids.practiceA1, ids.stageA, ids.bdeA1],
  );
  ids.dealOwn = dealOwn.rows[0].id;

  const dealOtherPractice = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-OTHERPRACTICE', 'Other Practice Deal', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantA, ids.accountA2, ids.practiceA2, ids.stageA, ids.otherPracticeUser],
  );
  ids.dealOtherPractice = dealOtherPractice.rows[0].id;

  const dealOtherTenant = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-OTHERTENANT', 'Other Tenant Deal', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantB, ids.accountB1, ids.practiceB1, ids.stageB, ids.otherTenantUser],
  );
  ids.dealOtherTenant = dealOtherTenant.rows[0].id;

  // One seeded activity per deal, authored by that deal's owner - the fixture activities_select
  // exercises against.
  await migrator.query(
    `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
     values ($1, $2, 'call', current_date, 'Seed activity', $3)`,
    [ids.tenantA, ids.dealOwn, ids.bdeA1],
  );
  await migrator.query(
    `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
     values ($1, $2, 'call', current_date, 'Seed activity', $3)`,
    [ids.tenantA, ids.dealOtherPractice, ids.otherPracticeUser],
  );
  await migrator.query(
    `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
     values ($1, $2, 'call', current_date, 'Seed activity', $3)`,
    [ids.tenantB, ids.dealOtherTenant, ids.otherTenantUser],
  );
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

async function tryInsert(client: pg.Client, sql: string, params: unknown[]): Promise<boolean> {
  try {
    const result = await client.query(sql, params);
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    if (err instanceof Error && /row-level security/.test(err.message)) return false;
    throw err;
  }
}

// Six identities x three deals covers every scope boundary docs/02-permission-matrix.md draws for
// activities: bdeA1 (owner of dealOwn), bdeA2 (same-practice colleague, owns nothing), teamLeadA/
// directorA (practice-wide within practiceA1), execA (tenant-wide read, never write), adminA
// (tenant-wide, everything).
const IDENTITIES = [
  { label: "bdeA1 (owner)", id: () => ids.bdeA1 },
  { label: "bdeA2 (colleague)", id: () => ids.bdeA2 },
  { label: "teamLeadA", id: () => ids.teamLeadA },
  { label: "directorA", id: () => ids.directorA },
  { label: "execA", id: () => ids.execA },
  { label: "adminA", id: () => ids.adminA },
] as const;

describe("activities_select: exhaustive per role x deal - mirrors deals_select exactly", () => {
  const expected: Record<(typeof IDENTITIES)[number]["label"], [own: boolean, otherPractice: boolean, otherTenant: boolean]> = {
    "bdeA1 (owner)": [true, false, false],
    "bdeA2 (colleague)": [true, false, false], // D-02: practice-wide READ, not owner-only
    teamLeadA: [true, false, false],
    directorA: [true, false, false],
    execA: [true, true, false], // D-06: tenant-wide read, full narratives
    adminA: [true, true, false],
  };

  for (const identity of IDENTITIES) {
    const [own, otherPractice] = expected[identity.label];

    it(`${identity.label}: own=${own} otherPractice=${otherPractice} otherTenant=false`, async () => {
      const client = await asUser(identity.id());
      const ownRows = await client.query("select id from activities where deal_id = $1", [ids.dealOwn]);
      const otherPracticeRows = await client.query("select id from activities where deal_id = $1", [ids.dealOtherPractice]);
      const otherTenantRows = await client.query("select id from activities where deal_id = $1", [ids.dealOtherTenant]);
      await client.end();

      expect(ownRows.rows).toHaveLength(own ? 1 : 0);
      expect(otherPracticeRows.rows).toHaveLength(otherPractice ? 1 : 0);
      expect(otherTenantRows.rows).toHaveLength(0);
    });
  }
});

describe("activities_insert: exhaustive per role x deal - mirrors deals_UPDATE's own/practice/tenant shape, not deals_select's", () => {
  // activity.create (docs/02-permission-matrix.md): own (bde), practice (team_lead, director),
  // tenant (tenant_admin), denied (executive - can_write() excludes them outright). Unlike
  // activities_select above, bdeA2 (a colleague, not the owner) is DENIED here - this is the read/
  // write asymmetry, proven for activities the same way deals_permission_matrix.spec.ts already
  // proved it for deals.
  const expected: Record<(typeof IDENTITIES)[number]["label"], [own: boolean, otherPractice: boolean, otherTenant: boolean]> = {
    "bdeA1 (owner)": [true, false, false],
    "bdeA2 (colleague)": [false, false, false], // can READ it (above), cannot WRITE it
    teamLeadA: [true, false, false],
    directorA: [true, false, false],
    execA: [false, false, false], // can_write() excludes executive entirely
    adminA: [true, true, false],
  };

  let summaryCounter = 0;

  for (const identity of IDENTITIES) {
    const [own, otherPractice] = expected[identity.label];

    it(`${identity.label}: own=${own} otherPractice=${otherPractice} otherTenant=false`, async () => {
      const client = await asUser(identity.id());
      const actorId = identity.id();

      summaryCounter += 1;
      const ownAttempt = await tryInsert(
        client,
        `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
         values ($1, $2, 'call', current_date, $3, $4)`,
        [ids.tenantA, ids.dealOwn, `Insert attempt own ${summaryCounter}`, actorId],
      );

      summaryCounter += 1;
      const otherAttempt = await tryInsert(
        client,
        `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
         values ($1, $2, 'call', current_date, $3, $4)`,
        [ids.tenantA, ids.dealOtherPractice, `Insert attempt other ${summaryCounter}`, actorId],
      );
      await client.end();

      expect(ownAttempt).toBe(own);
      expect(otherAttempt).toBe(otherPractice);

      // Clean up via the migrator whatever actually got inserted, so later tests' counts aren't
      // polluted (activities_select above already ran and captured its own snapshot).
      await migrator.query("delete from activities where summary like 'Insert attempt%'");
    });
  }

  it("no tenantA identity can insert with a foreign tenant_id, regardless of role", async () => {
    for (const identity of [IDENTITIES[0], IDENTITIES[5]]) {
      // bdeA1, adminA - representative, not all six: cross-tenant isolation itself is already
      // exhaustively covered by tests/rls/cross_tenant_isolation.spec.ts; this just confirms
      // activities specifically isn't an exception, for both a practice-scoped and a
      // tenant-wide-scoped role.
      const client = await asUser(identity.id());
      const inserted = await tryInsert(
        client,
        `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
         values ($1, $2, 'call', current_date, 'Foreign tenant attempt', $3)`,
        [ids.tenantB, ids.dealOtherTenant, identity.id()],
      );
      await client.end();
      expect(inserted, `${identity.label} inserting with tenant_id = tenant B`).toBe(false);
      if (inserted) await migrator.query("delete from activities where summary = 'Foreign tenant attempt'");
    }
  });
});

// The exact named regression test docs/07-build-backlog.md calls for, verbatim, at the RLS level -
// tests/permissions/matrix.spec.ts already proves it at the application layer (can()); this proves
// the database itself cannot be tricked into the predecessor's defect even if a caller bypassed
// can() entirely.
describe("the named regression guard (docs/07-build-backlog.md M3.3)", () => {
  it("a user holding only the bde role can create an activity on a deal they own", async () => {
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(
      client,
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'call', current_date, 'Named regression guard', $3)`,
      [ids.tenantA, ids.dealOwn, ids.bdeA1],
    );
    await client.end();
    expect(inserted).toBe(true);
    await migrator.query("delete from activities where summary = 'Named regression guard'");
  });
});
