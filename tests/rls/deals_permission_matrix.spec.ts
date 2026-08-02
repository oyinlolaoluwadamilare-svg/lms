import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M1.8 exit criteria (docs/07-build-backlog.md): "⚑ Permission and RLS tests for every deal
// action, allow and deny, per role." tests/rls/deals_foundation.spec.ts (M1.1) already proved a
// baseline - cross-tenant isolation and D-02's practice-wide-read/own-write shape - and explicitly
// deferred the full exhaustive matrix here. tests/permissions/deal-matrix.spec.ts is this file's
// counterpart at the application layer (every deal.* action's can() scope, per role).
//
// The one thing RLS genuinely cannot do, which this file demonstrates rather than glosses over:
// migration 0005's deals_update policy is ONE policy shared by every specific write action in
// docs/02-permission-matrix.md (change_stage, change_owner, mark_won, override_forecast_category,
// ...) - it has no concept of "which columns changed," only "may this identity write to this row
// at all." So a bde who owns a deal passes deals_update for ANY column, including owner_id, even
// though docs/02-permission-matrix.md says bde's deal.change_owner is "-" (denied, always). RLS is
// the coarse, row-level backstop (tenant/practice/ownership boundary); the fine-grained
// per-action distinction that scope table draws exists ONLY in src/auth/permissions.ts's can(),
// which is why src/services/deals.ts's changeStage/updateDeal call can() themselves rather than
// relying on RLS's deals_update policy alone (CLAUDE.md #1: RLS is a second, independent control,
// not the only one) - see the "RLS alone" test below for the concrete demonstration.

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
    "truncate deal_co_owners, deals, account_practice_owners, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant A', 'tenant-a-deals-matrix') returning id",
  );
  const tenantB = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant B', 'tenant-b-deals-matrix') returning id",
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
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

// Six identities x three deals covers every scope boundary docs/02-permission-matrix.md draws for
// deals: bdeA1 (owner of dealOwn), bdeA2 (same-practice colleague, owns nothing), teamLeadA/
// directorA (practice-wide within practiceA1), execA (tenant-wide read, never write), adminA
// (tenant-wide, everything). dealOtherPractice/dealOtherTenant are never owned by any of these six.
const IDENTITIES = [
  { label: "bdeA1 (owner)", id: () => ids.bdeA1 },
  { label: "bdeA2 (colleague)", id: () => ids.bdeA2 },
  { label: "teamLeadA", id: () => ids.teamLeadA },
  { label: "directorA", id: () => ids.directorA },
  { label: "execA", id: () => ids.execA },
  { label: "adminA", id: () => ids.adminA },
] as const;

describe("deals_select: exhaustive per role x deal", () => {
  // has_role('tenant_admin')/has_role('executive') => tenant-wide; everyone else needs
  // practice_line_id in entitled_practices().
  const expected: Record<(typeof IDENTITIES)[number]["label"], [own: boolean, otherPractice: boolean, otherTenant: boolean]> = {
    "bdeA1 (owner)": [true, false, false],
    "bdeA2 (colleague)": [true, false, false], // D-02: practice-wide READ, not owner-only
    teamLeadA: [true, false, false],
    directorA: [true, false, false],
    execA: [true, true, false], // tenant-wide read
    adminA: [true, true, false],
  };

  for (const identity of IDENTITIES) {
    const [own, otherPractice] = expected[identity.label];

    it(`${identity.label}: own=${own} otherPractice=${otherPractice} otherTenant=false`, async () => {
      const client = await asUser(identity.id());
      const dealOwnRows = await client.query("select id from deals where id = $1", [ids.dealOwn]);
      const otherPracticeRows = await client.query("select id from deals where id = $1", [ids.dealOtherPractice]);
      const otherTenantRows = await client.query("select id from deals where id = $1", [ids.dealOtherTenant]);
      await client.end();

      expect(dealOwnRows.rows).toHaveLength(own ? 1 : 0);
      expect(otherPracticeRows.rows).toHaveLength(otherPractice ? 1 : 0);
      expect(otherTenantRows.rows).toHaveLength(0);
    });
  }
});

describe("deals_update: exhaustive per role x deal", () => {
  // can_write() excludes executive outright. Of the rest: tenant_admin is tenant-wide;
  // director/team_lead are practice-wide; bde is owner_id/author_id/co-owner only - NOT
  // practice-wide, unlike deals_select above. This is the real D-02 asymmetry: bde reads their
  // whole practice but writes only their own.
  const expected: Record<(typeof IDENTITIES)[number]["label"], [own: boolean, otherPractice: boolean, otherTenant: boolean]> = {
    "bdeA1 (owner)": [true, false, false],
    "bdeA2 (colleague)": [false, false, false], // can SEE it (above), cannot WRITE it
    teamLeadA: [true, false, false],
    directorA: [true, false, false],
    execA: [false, false, false], // can_write() excludes executive entirely
    adminA: [true, true, false],
  };

  for (const identity of IDENTITIES) {
    const [own, otherPractice] = expected[identity.label];

    it(`${identity.label}: own=${own} otherPractice=${otherPractice} otherTenant=false`, async () => {
      const client = await asUser(identity.id());
      const ownResult = await client.query("update deals set brief = 'touched' where id = $1", [ids.dealOwn]);
      const otherPracticeResult = await client.query("update deals set brief = 'touched' where id = $1", [ids.dealOtherPractice]);
      const otherTenantResult = await client.query("update deals set brief = 'touched' where id = $1", [ids.dealOtherTenant]);
      await client.end();

      expect(ownResult.rowCount).toBe(own ? 1 : 0);
      expect(otherPracticeResult.rowCount).toBe(otherPractice ? 1 : 0);
      expect(otherTenantResult.rowCount).toBe(0);

      // Revert via the migrator (bypasses RLS) so later tests in this file see a clean 'brief'.
      await migrator.query("update deals set brief = null where id in ($1, $2, $3)", [
        ids.dealOwn,
        ids.dealOtherPractice,
        ids.dealOtherTenant,
      ]);
    });
  }
});

// Unlike deals_update/deals_select's USING clause (which just filters rows out, silently, since
// tests above only ever see rowCount 0), an INSERT's WITH CHECK clause makes Postgres actively
// reject the whole statement - "new row violates row-level security policy" is a thrown error, not
// a quiet no-op. This helper distinguishes that specific rejection from a real bug (any other
// error still propagates and fails the test loudly).
async function tryInsert(client: pg.Client, sql: string, params: unknown[]): Promise<boolean> {
  try {
    const result = await client.query(sql, params);
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    if (err instanceof Error && /row-level security/.test(err.message)) return false;
    throw err;
  }
}

describe("deals_insert: exhaustive per role x target practice", () => {
  // executive is excluded by can_write() itself; tenant_admin may insert into ANY practice in
  // their own tenant; director/team_lead/bde only into a practice they hold an entitled grant in.
  const expected: Record<(typeof IDENTITIES)[number]["label"], [ownPractice: boolean, otherPractice: boolean]> = {
    "bdeA1 (owner)": [true, false],
    "bdeA2 (colleague)": [true, false],
    teamLeadA: [true, false],
    directorA: [true, false],
    execA: [false, false],
    adminA: [true, true],
  };

  let referenceCounter = 0;

  for (const identity of IDENTITIES) {
    const [ownPractice, otherPractice] = expected[identity.label];

    it(`${identity.label}: ownPractice=${ownPractice} otherPractice=${otherPractice}`, async () => {
      const client = await asUser(identity.id());
      const actorId = identity.id();

      referenceCounter += 1;
      const ownAttempt = await tryInsert(
        client,
        `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
           owner_id, author_id, status, expected_close_date)
         values ($1, $2, 'Insert Attempt', $3, $4, $5, 'new', $6, $6, 'active', current_date + 30)`,
        [ids.tenantA, `D-INS-OWN-${referenceCounter}`, ids.accountA1, ids.practiceA1, ids.stageA, actorId],
      );

      referenceCounter += 1;
      const otherAttempt = await tryInsert(
        client,
        `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
           owner_id, author_id, status, expected_close_date)
         values ($1, $2, 'Insert Attempt', $3, $4, $5, 'new', $6, $6, 'active', current_date + 30)`,
        [ids.tenantA, `D-INS-OTHER-${referenceCounter}`, ids.accountA2, ids.practiceA2, ids.stageA, actorId],
      );
      await client.end();

      expect(ownAttempt).toBe(ownPractice);
      expect(otherAttempt).toBe(otherPractice);

      // Clean up via the migrator whatever actually got inserted.
      await migrator.query("delete from deals where tenant_id = $1 and reference like 'D-INS-%'", [ids.tenantA]);
    });
  }

  it("no tenantA identity can insert with a foreign tenant_id, regardless of role", async () => {
    for (const identity of [IDENTITIES[0], IDENTITIES[5]]) {
      // bdeA1, adminA - representative, not all six: cross-tenant isolation itself is already
      // exhaustively covered by tests/rls/cross_tenant_isolation.spec.ts; this just confirms the
      // deals table specifically isn't an exception, for both a practice-scoped and a
      // tenant-wide-scoped role.
      const client = await asUser(identity.id());
      const inserted = await tryInsert(
        client,
        `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
           owner_id, author_id, status, expected_close_date)
         values ($1, 'D-INS-FOREIGN-TENANT', 'Insert Attempt', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)`,
        [ids.tenantB, ids.accountB1, ids.practiceB1, ids.stageB, identity.id()],
      );
      await client.end();
      expect(inserted, `${identity.label} inserting with tenant_id = tenant B`).toBe(false);
    }
  });
});

describe("what RLS alone cannot enforce - the fine-grained action distinction is can()'s job, not RLS's", () => {
  it("a bde CAN reassign owner_id on their own deal via a raw update - deals_update has no per-column concept of deal.change_owner", async () => {
    const client = await asUser(ids.bdeA1);
    const result = await client.query("update deals set owner_id = $1 where id = $2", [ids.bdeA2, ids.dealOwn]);
    await client.end();

    // The database permits this: bdeA1 owns dealOwn, and deals_update's bde branch is
    // "owner_id = auth.uid() or author_id = auth.uid() or is_deal_co_owner(id)" - it has no
    // column-level restriction at all. docs/02-permission-matrix.md says bde's deal.change_owner
    // is "-" (always denied) - that rule exists only in src/auth/permissions.ts's can(), which
    // src/services/deals.ts never bypasses for exactly this reason. If this assertion ever starts
    // failing, it means someone tightened deals_update to be column-aware - worth knowing, but it
    // would not make the application-layer check in updateDeal (which still forbids owner changes
    // entirely, docs/01-domain-model.md: "no such field in EditDealInput") any less necessary.
    expect(result.rowCount).toBe(1);

    const { rows } = await migrator.query("select owner_id from deals where id = $1", [ids.dealOwn]);
    expect(rows[0].owner_id).toBe(ids.bdeA2);

    // Revert via the migrator so later tests see the original owner.
    await migrator.query("update deals set owner_id = $1 where id = $2", [ids.bdeA1, ids.dealOwn]);
  });
});
