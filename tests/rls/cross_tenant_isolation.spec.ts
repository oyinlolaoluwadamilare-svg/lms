import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M0.5 exit criteria (docs/07-build-backlog.md): "RLS test harness connecting as each role
// identity; cross-tenant isolation proven on every existing table." tests/rls/foundation.spec.ts
// (M0.2) already proves this for tenant_admin, executive and bde identities - this file completes
// the set with director and team_lead (entirely untested until now) and turns the assertion into
// an explicit per-role x per-table matrix, the same rigor tests/permissions/matrix.spec.ts applies
// to the application-layer guard, rather than a few spot-checked cases. Requires the same local
// setup as foundation.spec.ts - see tests/rls/README.md and `npm run db:setup:local`.

let migrator: pg.Client;

const ROLES = ["tenant_admin", "executive", "director", "team_lead", "bde"] as const;

const ids = {
  tenantA: "",
  tenantB: "",
  practiceA: "",
  practiceB: "",
  userIdByRole: {} as Record<(typeof ROLES)[number], string>,
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
  await migrator.query("truncate user_roles, users, practice_lines, tenants cascade");

  const tenantA = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant A', 'tenant-a-cross-tenant-test') returning id",
  );
  const tenantB = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant B', 'tenant-b-cross-tenant-test') returning id",
  );
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  const practiceA = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantA],
  );
  const practiceB = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantB],
  );
  ids.practiceA = practiceA.rows[0].id;
  ids.practiceB = practiceB.rows[0].id;

  // One identity per role, in tenant A - the full set docs/02-permission-matrix.md defines.
  for (const role of ROLES) {
    const userId = await makeUser(ids.tenantA, `${role}-a@example.com`);
    const practiceLineId = role === "tenant_admin" || role === "executive" ? null : ids.practiceA;
    await grant(ids.tenantA, userId, role, practiceLineId);
    ids.userIdByRole[role] = userId;
  }

  // A lone tenant_admin in tenant B - enough to own the rows tenant A's identities must never see.
  const adminB = await makeUser(ids.tenantB, "tenant_admin-b@example.com");
  await grant(ids.tenantB, adminB, "tenant_admin", null);
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

describe("cross-tenant isolation, every role identity x every existing table", () => {
  const TABLE_QUERIES = [
    { table: "tenants", query: "select * from tenants where id = $1" },
    { table: "practice_lines", query: "select * from practice_lines where tenant_id = $1" },
    { table: "users", query: "select * from users where tenant_id = $1" },
    { table: "user_roles", query: "select * from user_roles where tenant_id = $1" },
  ] as const;

  const cases = ROLES.flatMap((role) => TABLE_QUERIES.map(({ table, query }) => ({ role, table, query })));

  it.each(cases)("$role reads zero rows of tenant B's $table", async ({ role, query }) => {
    const client = await asUser(ids.userIdByRole[role]);
    const { rows } = await client.query(query, [ids.tenantB]);
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("write attempts against another tenant are silently filtered, for every role", () => {
  it.each(ROLES)("%s cannot update tenant B's practice_lines row", async (role) => {
    const client = await asUser(ids.userIdByRole[role]);
    const { rowCount } = await client.query(
      "update practice_lines set name = 'hijacked' where tenant_id = $1",
      [ids.tenantB],
    );
    expect(rowCount).toBe(0);
    await client.end();
  });
});

describe("director and team_lead identities (untested until M0.5)", () => {
  it("director can select practice_lines within their own tenant", async () => {
    const client = await asUser(ids.userIdByRole.director);
    const { rows } = await client.query("select * from practice_lines where tenant_id = $1", [ids.tenantA]);
    expect(rows.length).toBeGreaterThan(0);
    await client.end();
  });

  it("director cannot insert a practice_line (tenant_admin-only in this slice)", async () => {
    const client = await asUser(ids.userIdByRole.director);
    await expect(
      client.query("insert into practice_lines (tenant_id, name, code) values ($1, 'x', 'X')", [ids.tenantA]),
    ).rejects.toThrow(/row-level security/);
    await client.end();
  });

  it("team_lead can select users tenant-wide", async () => {
    const client = await asUser(ids.userIdByRole.team_lead);
    const { rows } = await client.query("select * from users where tenant_id = $1", [ids.tenantA]);
    expect(rows.length).toBeGreaterThanOrEqual(ROLES.length);
    await client.end();
  });

  it("team_lead cannot grant themself a role (admin.assign_role is tenant_admin-only)", async () => {
    const client = await asUser(ids.userIdByRole.team_lead);
    await expect(
      client.query(
        "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, 'tenant_admin', null)",
        [ids.tenantA, ids.userIdByRole.team_lead],
      ),
    ).rejects.toThrow(/row-level security/);
    await client.end();
  });
});
