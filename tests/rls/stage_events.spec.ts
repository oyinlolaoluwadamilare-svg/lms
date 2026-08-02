import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M2.1 exit criteria (docs/07-build-backlog.md): "stage_events table, immutability triggers, and
// the regression-derived column." This file proves the DB-level guarantees migration 0007 adds:
// the before-insert trigger's duration_in_previous_seconds/is_regression computation, immutability
// (forbid_mutation, reused from audit_entries) and the select-only RLS shape (no insert/update/
// delete policy for `authenticated` at all - service_role only, same as audit_entries).
//
// stage_events_select's scope shape (tenant-wide for tenant_admin/executive, practice-entitled
// otherwise) is copied verbatim from deals_select via the same deal_tenant_id()/
// deal_practice_line_id() helper functions - tests/rls/deals_permission_matrix.spec.ts already
// exhaustively proves that shape against all six identities for deals itself, so this file checks
// a representative subset (own-practice allow, other-practice deny, other-tenant deny) rather than
// re-running the full matrix for what is structurally the same policy.
//
// tests/integration/pipeline-list.spec.ts's changeStage tests cover the one real application path
// that writes a stage_events row today (M2.2) - this file covers the trigger's own arithmetic
// directly, independent of changeStage, since a future second transition path must get the same
// guarantees without re-deriving them.

let migrator: pg.Client;

const ids = {
  tenantA: "",
  tenantB: "",
  practiceA1: "",
  practiceA2: "",
  practiceB1: "",
  bdeA1: "",
  otherPracticeUser: "",
  otherTenantUser: "",
  execA: "",
  stageDiscovery: "", // sort_order 1
  stageProposal: "", // sort_order 2
  stageNegotiation: "", // sort_order 3
  stageB: "",
  accountA: "",
  accountB: "",
  dealA: "",
  dealB: "",
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
    "truncate stage_events, deal_co_owners, deals, account_practice_owners, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-stage-events') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-stage-events') returning id");
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

  ids.bdeA1 = await makeUser(ids.tenantA, "bde-a1@example.com");
  ids.otherPracticeUser = await makeUser(ids.tenantA, "other-practice@example.com");
  ids.otherTenantUser = await makeUser(ids.tenantB, "other-tenant@example.com");
  ids.execA = await makeUser(ids.tenantA, "exec-a@example.com");

  await grant(ids.tenantA, ids.bdeA1, "bde", ids.practiceA1);
  await grant(ids.tenantA, ids.otherPracticeUser, "bde", ids.practiceA2);
  await grant(ids.tenantB, ids.otherTenantUser, "bde", ids.practiceB1);
  await grant(ids.tenantA, ids.execA, "executive", null);

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
  const stageNegotiation = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Negotiation', 'NEGOTIATION', 3, 70, 'open') returning id`,
    [ids.tenantA],
  );
  const stageB = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Discovery', 'DISCOVERY', 1, 10, 'open') returning id`,
    [ids.tenantB],
  );
  ids.stageDiscovery = stageDiscovery.rows[0].id;
  ids.stageProposal = stageProposal.rows[0].id;
  ids.stageNegotiation = stageNegotiation.rows[0].id;
  ids.stageB = stageB.rows[0].id;

  const accountA = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client A') returning id", [ids.tenantA]);
  const accountB = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client B') returning id", [ids.tenantB]);
  ids.accountA = accountA.rows[0].id;
  ids.accountB = accountB.rows[0].id;

  const dealA = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date, created_at)
     values ($1, 'D-STAGE-EVENTS-A', 'Deal A', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30, now() - interval '2 days')
     returning id`,
    [ids.tenantA, ids.accountA, ids.practiceA1, ids.stageDiscovery, ids.bdeA1],
  );
  ids.dealA = dealA.rows[0].id;

  const dealB = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-STAGE-EVENTS-B', 'Deal B', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantB, ids.accountB, ids.practiceB1, ids.stageB, ids.otherTenantUser],
  );
  ids.dealB = dealB.rows[0].id;
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

describe("migration 0007: stage_events before-insert trigger", () => {
  it("falls back to the deal's created_at when this is the deal's first recorded transition", async () => {
    const { rows } = await migrator.query(
      `insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id)
       values ($1, $2, $3, $4, $5)
       returning duration_in_previous_seconds, is_regression`,
      [ids.tenantA, ids.dealA, ids.stageDiscovery, ids.stageProposal, ids.bdeA1],
    );

    // Deal A was created ~2 days (172800s) before this insert - allow generous slack for test runtime.
    expect(Number(rows[0].duration_in_previous_seconds)).toBeGreaterThan(170_000);
    expect(Number(rows[0].duration_in_previous_seconds)).toBeLessThan(175_000);
    expect(rows[0].is_regression).toBe(false); // Discovery(1) -> Proposal(2): forward
  });

  it("computes duration from the previous stage_events row, not the deal's created_at, once one exists", async () => {
    const { rows } = await migrator.query(
      `insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id)
       values ($1, $2, $3, $4, $5)
       returning duration_in_previous_seconds, is_regression`,
      [ids.tenantA, ids.dealA, ids.stageProposal, ids.stageNegotiation, ids.bdeA1],
    );

    // The prior event (Discovery -> Proposal) was just inserted moments ago, not two days ago.
    expect(Number(rows[0].duration_in_previous_seconds)).toBeGreaterThanOrEqual(0);
    expect(Number(rows[0].duration_in_previous_seconds)).toBeLessThan(60);
    expect(rows[0].is_regression).toBe(false); // Proposal(2) -> Negotiation(3): forward
  });

  it("flags is_regression when the target stage sorts earlier than the source stage", async () => {
    const { rows } = await migrator.query(
      `insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id)
       values ($1, $2, $3, $4, $5)
       returning is_regression`,
      [ids.tenantA, ids.dealA, ids.stageNegotiation, ids.stageDiscovery, ids.bdeA1],
    );
    expect(rows[0].is_regression).toBe(true); // Negotiation(3) -> Discovery(1): backward
  });

  it("treats a null from_stage_id (no prior stage to regress from) as is_regression = false", async () => {
    const { rows } = await migrator.query(
      `insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id)
       values ($1, $2, null, $3, $4)
       returning is_regression`,
      [ids.tenantA, ids.dealA, ids.stageDiscovery, ids.bdeA1],
    );
    expect(rows[0].is_regression).toBe(false);
  });

  it("a reconstructed event's supplied duration is trusted, not overwritten by live computation", async () => {
    const { rows } = await migrator.query(
      `insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id, is_reconstructed, duration_in_previous_seconds)
       values ($1, $2, $3, $4, $5, true, 999999)
       returning duration_in_previous_seconds`,
      [ids.tenantA, ids.dealA, ids.stageDiscovery, ids.stageProposal, ids.bdeA1],
    );
    expect(Number(rows[0].duration_in_previous_seconds)).toBe(999999);
  });
});

describe("migration 0007: immutability", () => {
  it("blocks an update, even for the migrator (table-owner) connection - forbid_mutation applies to every writer", async () => {
    const { rows } = await migrator.query(
      `insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [ids.tenantA, ids.dealA, ids.stageDiscovery, ids.stageProposal, ids.bdeA1],
    );
    const eventId = rows[0].id;

    await expect(migrator.query("update stage_events set is_regression = true where id = $1", [eventId])).rejects.toThrow(/append-only/);
  });

  it("blocks a delete the same way", async () => {
    const { rows } = await migrator.query(
      `insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [ids.tenantA, ids.dealA, ids.stageDiscovery, ids.stageProposal, ids.bdeA1],
    );
    const eventId = rows[0].id;

    await expect(migrator.query("delete from stage_events where id = $1", [eventId])).rejects.toThrow(/append-only/);
  });
});

async function tryInsert(client: pg.Client, sql: string, params: unknown[]): Promise<boolean> {
  try {
    const result = await client.query(sql, params);
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    if (err instanceof Error && /row-level security|permission denied/.test(err.message)) return false;
    throw err;
  }
}

describe("stage_events_select: mirrors deals_select's practice/tenant scope", () => {
  it("a bde in the deal's own practice can see its stage_events", async () => {
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select id from stage_events where deal_id = $1", [ids.dealA]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a bde in a different practice, same tenant, sees none of it", async () => {
    const client = await asUser(ids.otherPracticeUser);
    const { rows } = await client.query("select id from stage_events where deal_id = $1", [ids.dealA]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("executive (tenant-wide read) can see it despite holding no practice grant", async () => {
    const client = await asUser(ids.execA);
    const { rows } = await client.query("select id from stage_events where deal_id = $1", [ids.dealA]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a user in a different tenant entirely sees none of it", async () => {
    const client = await asUser(ids.otherTenantUser);
    const { rows } = await client.query("select id from stage_events where deal_id = $1", [ids.dealA]);
    await client.end();
    expect(rows).toHaveLength(0);
  });
});

describe("stage_events has no write policy for `authenticated` - service_role only, same as audit_entries", () => {
  it("even the deal's own owner cannot insert a stage_events row directly", async () => {
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(
      client,
      `insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id)
       values ($1, $2, $3, $4, $5)`,
      [ids.tenantA, ids.dealA, ids.stageDiscovery, ids.stageProposal, ids.bdeA1],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("tenant_admin-equivalent role grants confer no exception - there is no insert policy at all", async () => {
    const client = await asUser(ids.execA);
    const inserted = await tryInsert(
      client,
      `insert into stage_events (tenant_id, deal_id, from_stage_id, to_stage_id, actor_id)
       values ($1, $2, $3, $4, $5)`,
      [ids.tenantA, ids.dealA, ids.stageDiscovery, ids.stageProposal, ids.execA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });
});
