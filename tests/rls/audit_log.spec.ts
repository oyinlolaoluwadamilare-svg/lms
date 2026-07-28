import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M0.6 exit criteria (docs/07-build-backlog.md): "audit service: writeAudit() inside the caller's
// transaction, append-only enforcement triggers, and a test proving update and delete raise."
// This file proves the database-level half: no `authenticated` identity of any role can insert or
// mutate an audit_entries row (db/schema.sql: written by the service_role only), read access is
// limited to tenant_admin/executive/director within their own tenant
// (docs/02-permission-matrix.md: admin.view_audit_log), and - the case this milestone exists for -
// that update and delete raise for EVERY identity, including the migrator superuser role that owns
// the table and would otherwise bypass RLS entirely. A trigger, not a policy, is what makes that
// last guarantee real; this was also verified manually against a live local Postgres before this
// file existed (`alter table ... disable row level security` doesn't even apply here - the trigger
// fires regardless of RLS state).

let migrator: pg.Client;

const ids = {
  tenantA: "",
  tenantB: "",
  adminA: "",
  execA: "",
  directorA: "",
  teamLeadA: "",
  bdeA: "",
  practiceA: "",
};

async function makeUser(tenantId: string, email: string) {
  const { rows } = await migrator.query(
    `insert into users (id, tenant_id, full_name, email, status)
     values (uuid_generate_v4(), $1, $2, $3, 'active') returning id`,
    [tenantId, email, email],
  );
  return rows[0].id as string;
}

async function grant(tenantId: string, userId: string, role: string, practiceLineId: string | null) {
  await migrator.query(
    "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, $3, $4)",
    [tenantId, userId, role, practiceLineId],
  );
}

async function seed() {
  migrator = await migratorClient();
  await migrator.query("truncate audit_entries, user_roles, users, practice_lines, tenants cascade");

  const tenantA = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant A', 'tenant-a-audit-test') returning id",
  );
  const tenantB = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant B', 'tenant-b-audit-test') returning id",
  );
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  const practiceA = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantA],
  );
  ids.practiceA = practiceA.rows[0].id;

  ids.adminA = await makeUser(ids.tenantA, "admin-a@example.com");
  ids.execA = await makeUser(ids.tenantA, "exec-a@example.com");
  ids.directorA = await makeUser(ids.tenantA, "director-a@example.com");
  ids.teamLeadA = await makeUser(ids.tenantA, "team-lead-a@example.com");
  ids.bdeA = await makeUser(ids.tenantA, "bde-a@example.com");

  await grant(ids.tenantA, ids.adminA, "tenant_admin", null);
  await grant(ids.tenantA, ids.execA, "executive", null);
  await grant(ids.tenantA, ids.directorA, "director", ids.practiceA);
  await grant(ids.tenantA, ids.teamLeadA, "team_lead", ids.practiceA);
  await grant(ids.tenantA, ids.bdeA, "bde", ids.practiceA);

  // One row, written the only way it legitimately can be: directly by the migrator/superuser
  // identity, standing in here for what would be the service_role in production.
  await migrator.query(
    `insert into audit_entries (tenant_id, actor_id, entity_type, entity_id, action)
     values ($1, $2, 'deal', gen_random_uuid(), 'deal.create')`,
    [ids.tenantA, ids.adminA],
  );
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

describe("no authenticated identity, of any role, can insert an audit entry", () => {
  it.each(["tenant_admin", "executive", "director", "team_lead", "bde"] as const)(
    "%s cannot insert into audit_entries",
    async (role) => {
      const userId = { tenant_admin: ids.adminA, executive: ids.execA, director: ids.directorA, team_lead: ids.teamLeadA, bde: ids.bdeA }[
        role
      ];
      const client = await asUser(userId);
      await expect(
        client.query(
          "insert into audit_entries (tenant_id, actor_id, entity_type, entity_id, action) values ($1, $2, 'deal', gen_random_uuid(), 'deal.create')",
          [ids.tenantA, userId],
        ),
      ).rejects.toThrow(/row-level security|permission denied/);
      await client.end();
    },
  );
});

describe("read access matches docs/02-permission-matrix.md admin.view_audit_log", () => {
  it("tenant_admin can read audit entries in their own tenant", async () => {
    const client = await asUser(ids.adminA);
    const { rows } = await client.query("select * from audit_entries where tenant_id = $1", [ids.tenantA]);
    expect(rows.length).toBeGreaterThan(0);
    await client.end();
  });

  it("executive can read audit entries in their own tenant", async () => {
    const client = await asUser(ids.execA);
    const { rows } = await client.query("select * from audit_entries where tenant_id = $1", [ids.tenantA]);
    expect(rows.length).toBeGreaterThan(0);
    await client.end();
  });

  it("director can read audit entries in their own tenant", async () => {
    const client = await asUser(ids.directorA);
    const { rows } = await client.query("select * from audit_entries where tenant_id = $1", [ids.tenantA]);
    expect(rows.length).toBeGreaterThan(0);
    await client.end();
  });

  it("team_lead cannot read audit entries (no row, not an error)", async () => {
    const client = await asUser(ids.teamLeadA);
    const { rows } = await client.query("select * from audit_entries where tenant_id = $1", [ids.tenantA]);
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("bde cannot read audit entries (no row, not an error)", async () => {
    const client = await asUser(ids.bdeA);
    const { rows } = await client.query("select * from audit_entries where tenant_id = $1", [ids.tenantA]);
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("tenant_admin reads zero rows of tenant B's audit entries", async () => {
    const client = await asUser(ids.adminA);
    const { rows } = await client.query("select * from audit_entries where tenant_id = $1", [ids.tenantB]);
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("append-only: update and delete raise, even for the identity that owns the table", () => {
  it("update raises, connecting as the migrator/superuser identity directly", async () => {
    await expect(migrator.query("update audit_entries set action = 'hacked'")).rejects.toThrow(
      /append-only/,
    );
  });

  it("delete raises, connecting as the migrator/superuser identity directly", async () => {
    await expect(migrator.query("delete from audit_entries")).rejects.toThrow(/append-only/);
  });

  it("update raises for an authenticated tenant_admin identity too", async () => {
    const client = await asUser(ids.adminA);
    await expect(
      client.query("update audit_entries set action = 'hacked' where tenant_id = $1", [ids.tenantA]),
    ).rejects.toThrow(/append-only|row-level security/);
    await client.end();
  });
});
