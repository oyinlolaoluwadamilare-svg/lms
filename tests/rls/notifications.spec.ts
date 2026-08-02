import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M4.2 exit criteria (docs/07-build-backlog.md): "`assignTask` as the single assignment path,
// writing the ledger entry and notification." Proves migration 0012's RLS shape: notifications are
// recipient-only (no tenant_admin/executive tenant-wide override - deliberately narrower than every
// other table in this schema, since docs/02-permission-matrix.md has no "notification.view" action
// for any role), no insert policy for `authenticated` at all (service-role only, the same
// audit_entries/stage_events shape), and a self-service "mark my own notification read" update path
// that touches nothing but read_at.

let migrator: pg.Client;

const ids = {
  tenantA: "",
  tenantB: "",
  recipientA: "",
  actorA: "",
  otherUserA: "",
  userB: "",
};

async function makeUser(tenantId: string, email: string) {
  const { rows } = await migrator.query(
    `insert into users (id, tenant_id, full_name, email, status)
     values (uuid_generate_v4(), $1, $2, $3, 'active') returning id`,
    [tenantId, email, email],
  );
  return rows[0].id;
}

async function grant(tenantId: string, userId: string, role: string) {
  await migrator.query(
    "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, $3, null)",
    [tenantId, userId, role],
  );
}

async function seed() {
  migrator = await migratorClient();
  await migrator.query("truncate notifications, user_roles, users, tenants cascade");

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-notifications') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-notifications') returning id");
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  ids.recipientA = await makeUser(ids.tenantA, "recipient-a@example.com");
  ids.actorA = await makeUser(ids.tenantA, "actor-a@example.com");
  ids.otherUserA = await makeUser(ids.tenantA, "other-user-a@example.com");
  ids.userB = await makeUser(ids.tenantB, "user-b@example.com");

  // Every role should behave identically here (no notification.view action exists at all) -
  // tenant_admin/executive are used throughout (both permit a null practice_line_id, so no
  // practice_lines fixture is needed at all - irrelevant to what this file actually tests) - a
  // tenant_admin grant on otherUserA proves even that role gets no special visibility.
  await grant(ids.tenantA, ids.otherUserA, "tenant_admin");
  await grant(ids.tenantA, ids.recipientA, "executive");
  await grant(ids.tenantB, ids.userB, "executive");
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

function insertNotification(recipientId: string, title = "Task assigned to you") {
  return migrator.query(
    `insert into notifications (tenant_id, recipient_id, actor_id, event_type, entity_type, entity_id, title)
     values ($1, $2, $3, 'task_assigned', 'task', gen_random_uuid(), $4) returning id`,
    [ids.tenantA, recipientId, ids.actorA, title],
  );
}

describe("notifications_select: recipient-only, no tenant-wide override for any role", () => {
  it("the recipient can see their own notification", async () => {
    const { rows: inserted } = await insertNotification(ids.recipientA);
    const client = await asUser(ids.recipientA);
    const { rows } = await client.query("select id from notifications where id = $1", [inserted[0].id]);
    await client.end();
    expect(rows).toHaveLength(1);
  });

  it("a same-tenant tenant_admin cannot see someone else's notification - no 'notification.view' action exists for any role", async () => {
    const { rows: inserted } = await insertNotification(ids.recipientA);
    const client = await asUser(ids.otherUserA); // holds tenant_admin
    const { rows } = await client.query("select id from notifications where id = $1", [inserted[0].id]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("a user in a different tenant cannot see it at all", async () => {
    const { rows: inserted } = await insertNotification(ids.recipientA);
    const client = await asUser(ids.userB);
    const { rows } = await client.query("select id from notifications where id = $1", [inserted[0].id]);
    await client.end();
    expect(rows).toHaveLength(0);
  });
});

describe("notifications_insert: no policy for `authenticated` at all - service-role only", () => {
  it("the intended recipient cannot insert their own notification directly", async () => {
    const client = await asUser(ids.recipientA);
    const inserted = await tryInsert(
      client,
      `insert into notifications (tenant_id, recipient_id, actor_id, event_type, entity_type, entity_id, title)
       values ($1, $2, $3, 'task_assigned', 'task', gen_random_uuid(), 'Self-inserted')`,
      [ids.tenantA, ids.recipientA, ids.actorA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("no role, not even tenant_admin, can insert a notification for someone else", async () => {
    const client = await asUser(ids.otherUserA);
    const inserted = await tryInsert(
      client,
      `insert into notifications (tenant_id, recipient_id, actor_id, event_type, entity_type, entity_id, title)
       values ($1, $2, $3, 'task_assigned', 'task', gen_random_uuid(), 'Admin-inserted')`,
      [ids.tenantA, ids.recipientA, ids.otherUserA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });
});

describe("notifications_mark_read: recipient can mark their own notification read, and only their own", () => {
  it("the recipient can set read_at on their own notification", async () => {
    const { rows: inserted } = await insertNotification(ids.recipientA);
    const client = await asUser(ids.recipientA);
    const result = await client.query("update notifications set read_at = now() where id = $1", [inserted[0].id]);
    await client.end();
    expect(result.rowCount).toBe(1);
  });

  it("someone else cannot mark another user's notification read", async () => {
    const { rows: inserted } = await insertNotification(ids.recipientA);
    const client = await asUser(ids.otherUserA);
    const result = await client.query("update notifications set read_at = now() where id = $1", [inserted[0].id]);
    await client.end();
    expect(result.rowCount).toBe(0);
  });
});

describe("no hard-delete path on notifications", () => {
  it("no role, not even tenant_admin, can DELETE a notifications row - CLAUDE.md #3", async () => {
    const { rows: inserted } = await insertNotification(ids.recipientA);
    const client = await asUser(ids.otherUserA);
    await expect(client.query("delete from notifications where id = $1", [inserted[0].id])).rejects.toThrow(/permission denied/);
    await client.end();

    const { rows: stillThere } = await migrator.query("select id from notifications where id = $1", [inserted[0].id]);
    expect(stillThere).toHaveLength(1);
  });
});
