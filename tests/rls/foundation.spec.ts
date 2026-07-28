import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M0.2 exit criteria (docs/07-build-backlog.md): "an authenticated user of each role sees a
// correct, empty shell; every permission pair is tested; cross-tenant isolation is proven."
// This suite proves the last part, connecting as each role's real database identity with the
// application layer (src/auth/permissions.ts, not built until M0.4) entirely bypassed - the
// RLS harness described in docs/05-test-strategy.md. Requires a Postgres with the M0.2
// migrations, tests/rls/fixtures/local_auth_shim.sql and the `authenticated` grants already
// applied - see tests/rls/README.md and `npm run db:setup:local`.

let migrator: pg.Client;

const ids = {
  tenantA: "", tenantB: "",
  practiceA1: "", practiceB1: "",
  adminA: "", execA: "", bdeA: "", suspendedBdeA: "", adminB: "",
};

async function seed() {
  migrator = await migratorClient();

  // Clean slate: safe to re-run.
  await migrator.query("truncate user_roles, users, practice_lines, tenants cascade");

  const tenantA = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant A', 'tenant-a-rls-test') returning id",
  );
  const tenantB = await migrator.query(
    "insert into tenants (name, slug) values ('Tenant B', 'tenant-b-rls-test') returning id",
  );
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  const practiceA1 = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantA],
  );
  const practiceB1 = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantB],
  );
  ids.practiceA1 = practiceA1.rows[0].id;
  ids.practiceB1 = practiceB1.rows[0].id;

  async function makeUser(tenantId: string, email: string, status = "active") {
    const { rows } = await migrator.query(
      `insert into users (id, tenant_id, full_name, email, status)
       values (uuid_generate_v4(), $1, $2, $3, $4) returning id`,
      [tenantId, email, email, status],
    );
    return rows[0].id as string;
  }

  ids.adminA = await makeUser(ids.tenantA, "admin-a@example.com");
  ids.execA = await makeUser(ids.tenantA, "exec-a@example.com");
  ids.bdeA = await makeUser(ids.tenantA, "bde-a@example.com");
  ids.suspendedBdeA = await makeUser(ids.tenantA, "suspended-a@example.com", "suspended");
  ids.adminB = await makeUser(ids.tenantB, "admin-b@example.com");

  async function grant(tenantId: string, userId: string, role: string, practiceLineId: string | null) {
    await migrator.query(
      "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, $3, $4)",
      [tenantId, userId, role, practiceLineId],
    );
  }

  await grant(ids.tenantA, ids.adminA, "tenant_admin", null);
  await grant(ids.tenantA, ids.execA, "executive", null);
  await grant(ids.tenantA, ids.bdeA, "bde", ids.practiceA1);
  await grant(ids.tenantA, ids.suspendedBdeA, "bde", ids.practiceA1);
  await grant(ids.tenantB, ids.adminB, "tenant_admin", null);
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

describe("cross-tenant isolation", () => {
  it("tenant A reads zero rows of tenant B's tenants row", async () => {
    const client = await asUser(ids.adminA);
    const { rows } = await client.query("select * from tenants where id = $1", [ids.tenantB]);
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("tenant A reads zero rows of tenant B's practice_lines", async () => {
    const client = await asUser(ids.adminA);
    const { rows } = await client.query("select * from practice_lines where tenant_id = $1", [ids.tenantB]);
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("tenant A reads zero rows of tenant B's users", async () => {
    const client = await asUser(ids.adminA);
    const { rows } = await client.query("select * from users where tenant_id = $1", [ids.tenantB]);
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("tenant A reads zero rows of tenant B's user_roles", async () => {
    const client = await asUser(ids.adminA);
    const { rows } = await client.query("select * from user_roles where tenant_id = $1", [ids.tenantB]);
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("tenant A's tenant_admin cannot write into tenant B's practice_lines", async () => {
    const client = await asUser(ids.adminA);
    const { rowCount } = await client.query(
      "update practice_lines set name = 'hijacked' where tenant_id = $1",
      [ids.tenantB],
    );
    expect(rowCount).toBe(0); // RLS silently filters the target row rather than raising
    await client.end();
  });
});

describe("executive is read-only, enforced at the database", () => {
  it("executive can select practice_lines", async () => {
    const client = await asUser(ids.execA);
    const { rows } = await client.query("select * from practice_lines where tenant_id = $1", [ids.tenantA]);
    expect(rows.length).toBeGreaterThan(0);
    await client.end();
  });

  it("executive fails to insert a practice_line", async () => {
    // INSERT's WITH CHECK failure raises (unlike SELECT/UPDATE's USING, which silently filters
    // rows) - "new row violates row-level security policy".
    const client = await asUser(ids.execA);
    await expect(
      client.query("insert into practice_lines (tenant_id, name, code) values ($1, 'x', 'X')", [ids.tenantA]),
    ).rejects.toThrow(/row-level security/);
    await client.end();
  });

  it("executive fails to update a practice_line", async () => {
    const client = await asUser(ids.execA);
    const { rowCount } = await client.query(
      "update practice_lines set name = 'hijacked' where tenant_id = $1",
      [ids.tenantA],
    );
    expect(rowCount).toBe(0);
    await client.end();
  });

  it("executive fails to insert a user_role for themself", async () => {
    const client = await asUser(ids.execA);
    await expect(
      client.query(
        "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, 'tenant_admin', null)",
        [ids.tenantA, ids.execA],
      ),
    ).rejects.toThrow();
    await client.end();
  });
});

describe("a suspended user is denied everything despite holding role rows", () => {
  it("cannot read practice_lines in their own tenant", async () => {
    const client = await asUser(ids.suspendedBdeA);
    const { rows } = await client.query("select * from practice_lines where tenant_id = $1", [ids.tenantA]);
    expect(rows).toHaveLength(0); // current_tenant_id() returns null for a non-active user
    await client.end();
  });

  it("cannot read their own user row via the tenant-scoped policy", async () => {
    const client = await asUser(ids.suspendedBdeA);
    const { rows } = await client.query("select * from users where id = $1", [ids.suspendedBdeA]);
    // users_select requires tenant_id = current_tenant_id(), which is null for a suspended user
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("role_scope_valid constraint", () => {
  it("rejects a tenant_admin row carrying a practice_line_id", async () => {
    await expect(
      migrator.query(
        "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, 'tenant_admin', $3)",
        [ids.tenantA, ids.adminA, ids.practiceA1],
      ),
    ).rejects.toThrow(/role_scope_valid/);
  });

  it("rejects a bde row with no practice_line_id", async () => {
    await expect(
      migrator.query(
        "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, 'bde', null)",
        [ids.tenantA, ids.bdeA],
      ),
    ).rejects.toThrow(/role_scope_valid/);
  });
});

describe("bde practice-wide read, own write (D-02)", () => {
  it("a bde reads users tenant-wide including colleagues outside their practice", async () => {
    const client = await asUser(ids.bdeA);
    const { rows } = await client.query("select * from users where tenant_id = $1", [ids.tenantA]);
    expect(rows.length).toBeGreaterThanOrEqual(4); // admin, exec, bde, suspended - all same tenant
    await client.end();
  });

  it("a bde cannot grant themself a role (admin.assign_role is tenant_admin-only)", async () => {
    const client = await asUser(ids.bdeA);
    await expect(
      client.query(
        "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, 'team_lead', $3)",
        [ids.tenantA, ids.bdeA, ids.practiceA1],
      ),
    ).rejects.toThrow(/row-level security/);
    await client.end();
  });
});
