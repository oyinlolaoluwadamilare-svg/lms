import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M3.1 exit criteria (docs/07-build-backlog.md): "activities, activity_revisions... migrations,
// with the future-date constraint, the generated is_client_facing column, and stage_id_at_time
// capture." This proves migration 0008's RLS shape (docs/02-permission-matrix.md's activity.* rows
// - practice for bde/team_lead/director, tenant-wide for executive/tenant_admin, "own" meaning the
// underlying DEAL's owner/co-owner/author for create, and the AUTHOR ONLY within a 24h window for
// update, uniformly across every role) and the two DB-level derived behaviours (stage_id_at_time
// capture, is_client_facing) plus the future-date and retraction-reason constraints. The exhaustive
// per-role-action matrix (mirroring tests/rls/deals_permission_matrix.spec.ts) is M3.3's job, not
// duplicated here - this is the M1.1-equivalent baseline for a brand new table.

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
  stageDiscovery: "",
  stageProposal: "",
  accountA: "",
  accountB: "",
  dealOwnedByBde1: "",
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
    "truncate activity_revisions, activities, deal_co_owners, deals, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-activities') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-activities') returning id");
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

  const stageDiscovery = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Discovery', 'DISCOVERY', 1, 10, 'open') returning id`,
    [ids.tenantA],
  );
  const stageProposal = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Proposal', 'PROPOSAL', 2, 40, 'open') returning id`,
    [ids.tenantA],
  );
  ids.stageDiscovery = stageDiscovery.rows[0].id;
  ids.stageProposal = stageProposal.rows[0].id;

  const stageB = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Discovery', 'DISCOVERY', 1, 10, 'open') returning id`,
    [ids.tenantB],
  );

  const accountA = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client A') returning id", [ids.tenantA]);
  const accountB = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client B') returning id", [ids.tenantB]);
  ids.accountA = accountA.rows[0].id;
  ids.accountB = accountB.rows[0].id;

  const dealA = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-ACT-A', 'Deal A', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantA, ids.accountA, ids.practiceA1, ids.stageDiscovery, ids.bdeA1],
  );
  ids.dealOwnedByBde1 = dealA.rows[0].id;

  const dealB = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-ACT-B', 'Deal B', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantB, ids.accountB, ids.practiceB1, stageB.rows[0].id, ids.otherTenantUser],
  );
  ids.dealOtherTenant = dealB.rows[0].id;
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

describe("migration 0008: derived/generated behaviour", () => {
  it("stage_id_at_time is captured from the deal's current stage at insert time, regardless of what the caller passes", async () => {
    const { rows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id, stage_id_at_time)
       values ($1, $2, 'call', current_date, 'Discovery call', $3, $4)
       returning stage_id_at_time`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1, ids.stageProposal], // deliberately wrong, to prove the trigger overrides it
    );
    expect(rows[0].stage_id_at_time).toBe(ids.stageDiscovery);
  });
});

describe("migration 0008: is_client_facing, per type", () => {
  const cases: Array<[string, boolean]> = [
    ["call", true],
    ["email", true],
    ["meeting", true],
    ["site_visit", true],
    ["proposal_walkthrough", true],
    ["follow_up", true],
    ["note", false],
    ["internal_review", false],
  ];

  for (const [type, expected] of cases) {
    it(`${type} -> is_client_facing = ${expected}`, async () => {
      const { rows } = await migrator.query(
        `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
         values ($1, $2, $3, current_date, 'Test summary', $4) returning is_client_facing`,
        [ids.tenantA, ids.dealOwnedByBde1, type, ids.bdeA1],
      );
      expect(rows[0].is_client_facing).toBe(expected);
    });
  }
});

describe("migration 0008: constraints", () => {
  it("rejects a future activity_date", async () => {
    await expect(
      migrator.query(
        `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
         values ($1, $2, 'note', current_date + 1, 'Tomorrow', $3)`,
        [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
      ),
    ).rejects.toThrow(/activity_date_not_future/);
  });

  it("rejects an empty summary", async () => {
    await expect(
      migrator.query(
        `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
         values ($1, $2, 'note', current_date, '   ', $3)`,
        [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
      ),
    ).rejects.toThrow();
  });

  it("rejects a retraction with no reason", async () => {
    const { rows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'note', current_date, 'To be retracted', $3) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    await expect(
      migrator.query("update activities set retracted_at = now(), retracted_by = $1 where id = $2", [ids.adminA, rows[0].id]),
    ).rejects.toThrow(/retraction_needs_reason/);
  });
});

describe("activities_select: practice/tenant scope, matching deals_select", () => {
  it("a bde in the deal's own practice can see its activities", async () => {
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select id from activities where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a bde in a different practice, same tenant, sees none of it", async () => {
    const client = await asUser(ids.otherPracticeUser);
    const { rows } = await client.query("select id from activities where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("executive sees it tenant-wide despite holding no practice grant (D-06)", async () => {
    const client = await asUser(ids.execA);
    const { rows } = await client.query("select id from activities where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a different tenant entirely sees none of it", async () => {
    const client = await asUser(ids.otherTenantUser);
    const { rows } = await client.query("select id from activities where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows).toHaveLength(0);
  });
});

describe("activities_insert: activity.create's scope (docs/02-permission-matrix.md)", () => {
  it("the deal's owning bde can log an activity on it", async () => {
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(
      client,
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'call', current_date, 'Owner logging', $3)`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    await client.end();
    expect(inserted).toBe(true);
  });

  it("a same-practice bde who neither owns, co-owns nor authored the deal cannot log an activity on it - the named regression guard, at the RLS level", async () => {
    const client = await asUser(ids.bdeA2);
    const inserted = await tryInsert(
      client,
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'call', current_date, 'Colleague logging', $3)`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA2],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("team_lead and director can log an activity on a colleague's deal within their own practice", async () => {
    for (const userId of [ids.teamLeadA, ids.directorA]) {
      const client = await asUser(userId);
      const inserted = await tryInsert(
        client,
        `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
         values ($1, $2, 'call', current_date, 'Leader logging', $3)`,
        [ids.tenantA, ids.dealOwnedByBde1, userId],
      );
      await client.end();
      expect(inserted).toBe(true);
    }
  });

  it("tenant_admin can log an activity on any deal in the tenant", async () => {
    const client = await asUser(ids.adminA);
    const inserted = await tryInsert(
      client,
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'call', current_date, 'Admin logging', $3)`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.adminA],
    );
    await client.end();
    expect(inserted).toBe(true);
  });

  it("executive can never log an activity - read-only, enforced in RLS", async () => {
    const client = await asUser(ids.execA);
    const inserted = await tryInsert(
      client,
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'call', current_date, 'Exec logging', $3)`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.execA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });
});

describe("activities_update: 'own, within 24h' - uniformly the author only, every role", () => {
  it("the author can edit their own activity within the 24h window", async () => {
    const { rows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'note', current_date, 'Original summary', $3) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA1);
    const result = await client.query("update activities set summary = 'Edited summary' where id = $1", [rows[0].id]);
    await client.end();
    expect(result.rowCount).toBe(1);
  });

  it("the deal's owner cannot edit an activity authored by someone else on their own deal", async () => {
    const { rows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'note', current_date, 'Authored by admin', $3) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.adminA],
    );
    const client = await asUser(ids.bdeA1); // owns the deal, but did not author this activity
    const result = await client.query("update activities set summary = 'Hijacked' where id = $1", [rows[0].id]);
    await client.end();
    expect(result.rowCount).toBe(0);

    await migrator.query("update activities set summary = 'Authored by admin' where id = $1", [rows[0].id]); // revert, just in case
  });

  it("even tenant_admin cannot edit another user's activity - 'own' has no tenant-wide override here", async () => {
    const { rows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'note', current_date, 'Authored by bde', $3) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.adminA);
    const result = await client.query("update activities set summary = 'Admin override' where id = $1", [rows[0].id]);
    await client.end();
    expect(result.rowCount).toBe(0);
  });

  it("the author cannot edit their own activity once the 24h window has closed", async () => {
    const { rows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id, edit_locked_at)
       values ($1, $2, 'note', current_date, 'Already locked', $3, now() - interval '1 hour') returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA1);
    const result = await client.query("update activities set summary = 'Too late' where id = $1", [rows[0].id]);
    await client.end();
    expect(result.rowCount).toBe(0);
  });
});

describe("activity_revisions: immutable, service-role-only, scoped like its parent activity", () => {
  it("has no insert policy for authenticated - even the activity's own author cannot write a revision directly", async () => {
    const { rows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'note', current_date, 'For a revision test', $3) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(
      client,
      "insert into activity_revisions (activity_id, field_name, previous_value, new_value, changed_by) values ($1, 'summary', 'old', 'new', $2)",
      [rows[0].id, ids.bdeA1],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("select scope matches the parent activity's practice/tenant boundary - no RLS recursion between the two tables", async () => {
    const { rows: activityRows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'note', current_date, 'Revision-scope test', $3) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const { rows: revisionRows } = await migrator.query(
      "insert into activity_revisions (activity_id, field_name, previous_value, new_value, changed_by) values ($1, 'summary', 'old', 'new', $2) returning id",
      [activityRows[0].id, ids.bdeA1],
    );

    const own = await asUser(ids.bdeA1);
    const ownRows = await own.query("select id from activity_revisions where id = $1", [revisionRows[0].id]);
    await own.end();
    expect(ownRows.rows).toHaveLength(1);

    const other = await asUser(ids.otherPracticeUser);
    const otherRows = await other.query("select id from activity_revisions where id = $1", [revisionRows[0].id]);
    await other.end();
    expect(otherRows.rows).toHaveLength(0);
  });

  it("blocks update and delete for every writer, including the migrator connection", async () => {
    const { rows: activityRows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'note', current_date, 'Immutability test', $3) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const { rows: revisionRows } = await migrator.query(
      "insert into activity_revisions (activity_id, field_name, previous_value, new_value, changed_by) values ($1, 'summary', 'old', 'new', $2) returning id",
      [activityRows[0].id, ids.bdeA1],
    );

    await expect(
      migrator.query("update activity_revisions set new_value = 'tampered' where id = $1", [revisionRows[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(migrator.query("delete from activity_revisions where id = $1", [revisionRows[0].id])).rejects.toThrow(/append-only/);
  });
});
