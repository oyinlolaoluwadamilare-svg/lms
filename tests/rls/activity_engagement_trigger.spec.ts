import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migratorClient } from "./support";

// M3.2 exit criteria (docs/07-build-backlog.md): "logActivity service: the single creation path,
// deriving last_engaged_at, engagement_count and the audit row in one transaction." The "in one
// transaction" half is what migration 0009's trg_activity_refresh trigger actually delivers - not
// application code, which has no client-side multi-statement transaction available to it
// (src/services/audit.ts's own comment). This file proves the trigger's own arithmetic directly
// against local Postgres, independent of the (not-yet-existing at the time this was written)
// logActivity service - the same "prove the DB behaviour on its own" split M2.1's
// tests/rls/stage_events.spec.ts already established for duration_in_previous_seconds/is_regression.

let migrator: pg.Client;

const ids = {
  tenantA: "",
  practiceA1: "",
  bdeA1: "",
  stageDiscovery: "",
  accountA: "",
  dealA: "",
};

async function seed() {
  migrator = await migratorClient();
  await migrator.query(
    "truncate activities, deals, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-engagement-trigger') returning id");
  ids.tenantA = tenantA.rows[0].id;

  const practiceA1 = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantA],
  );
  ids.practiceA1 = practiceA1.rows[0].id;

  const bdeA1 = await migrator.query(
    `insert into users (id, tenant_id, full_name, email, status)
     values (uuid_generate_v4(), $1, 'Bde A1', 'bde-a1@example.com', 'active') returning id`,
    [ids.tenantA],
  );
  ids.bdeA1 = bdeA1.rows[0].id;
  await migrator.query("insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, 'bde', $3)", [
    ids.tenantA,
    ids.bdeA1,
    ids.practiceA1,
  ]);

  const stageDiscovery = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Discovery', 'DISCOVERY', 1, 10, 'open') returning id`,
    [ids.tenantA],
  );
  ids.stageDiscovery = stageDiscovery.rows[0].id;

  const accountA = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client A') returning id", [ids.tenantA]);
  ids.accountA = accountA.rows[0].id;

  const dealA = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-ENGAGE-A', 'Deal A', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantA, ids.accountA, ids.practiceA1, ids.stageDiscovery, ids.bdeA1],
  );
  ids.dealA = dealA.rows[0].id;
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

async function dealEngagement() {
  const { rows } = await migrator.query("select last_engaged_at, last_engaged_activity_id, engagement_count from deals where id = $1", [
    ids.dealA,
  ]);
  return rows[0];
}

describe("migration 0009: trg_activity_refresh", () => {
  it("starts at zero/null before any activity exists", async () => {
    const engagement = await dealEngagement();
    expect(engagement.last_engaged_at).toBeNull();
    expect(engagement.last_engaged_activity_id).toBeNull();
    expect(engagement.engagement_count).toBe(0);
  });

  it("a client-facing activity sets last_engaged_at, last_engaged_activity_id and engagement_count", async () => {
    const { rows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'call', current_date - 2, 'First call', $3) returning id, activity_date`,
      [ids.tenantA, ids.dealA, ids.bdeA1],
    );
    const engagement = await dealEngagement();
    expect(new Date(engagement.last_engaged_at).toISOString().slice(0, 10)).toBe(
      new Date(rows[0].activity_date).toISOString().slice(0, 10),
    );
    expect(engagement.last_engaged_activity_id).toBe(rows[0].id);
    expect(engagement.engagement_count).toBe(1);
  });

  it("an internal (non-client-facing) activity increments engagement_count but never advances last_engaged_at", async () => {
    const before = await dealEngagement();
    await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'note', current_date, 'Internal note', $3)`,
      [ids.tenantA, ids.dealA, ids.bdeA1],
    );
    const after = await dealEngagement();
    expect(after.engagement_count).toBe(before.engagement_count + 1);
    expect(new Date(after.last_engaged_at).getTime()).toBe(new Date(before.last_engaged_at).getTime());
    expect(after.last_engaged_activity_id).toBe(before.last_engaged_activity_id);
  });

  it("an OLDER client-facing activity does not move last_engaged_at backwards - it stays the maximum", async () => {
    const before = await dealEngagement();
    await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'email', current_date - 10, 'An older email', $3)`,
      [ids.tenantA, ids.dealA, ids.bdeA1],
    );
    const after = await dealEngagement();
    expect(new Date(after.last_engaged_at).getTime()).toBe(new Date(before.last_engaged_at).getTime());
    expect(after.last_engaged_activity_id).toBe(before.last_engaged_activity_id);
    expect(after.engagement_count).toBe(before.engagement_count + 1); // still counted
  });

  it("a NEWER client-facing activity does advance last_engaged_at to it", async () => {
    const { rows } = await migrator.query(
      `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
       values ($1, $2, 'meeting', current_date, 'Today''s meeting', $3) returning id, activity_date`,
      [ids.tenantA, ids.dealA, ids.bdeA1],
    );
    const after = await dealEngagement();
    expect(new Date(after.last_engaged_at).toISOString().slice(0, 10)).toBe(new Date(rows[0].activity_date).toISOString().slice(0, 10));
    expect(after.last_engaged_activity_id).toBe(rows[0].id);
  });

  it("retracting the most recent client-facing activity (via update, not delete) recomputes last_engaged_at to the next-most-recent one", async () => {
    const before = await dealEngagement();
    const countBefore = before.engagement_count;

    await migrator.query("update activities set retracted_at = now(), retracted_by = $1, retraction_reason = 'test' where id = $2", [
      ids.bdeA1,
      before.last_engaged_activity_id,
    ]);

    const after = await dealEngagement();
    // The retracted row is excluded from both the max-date calculation and the count.
    expect(after.last_engaged_activity_id).not.toBe(before.last_engaged_activity_id);
    expect(after.engagement_count).toBe(countBefore - 1);
    // The next-most-recent client-facing activity was the very first one inserted above.
    expect(new Date(after.last_engaged_at).toISOString().slice(0, 10)).not.toBe(
      new Date(before.last_engaged_at).toISOString().slice(0, 10),
    );
  });
});
