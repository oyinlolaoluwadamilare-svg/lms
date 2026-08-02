import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M4.8 exit criteria (docs/07-build-backlog.md): "...with per-type user preferences replacing
// coarse toggles." Proves migration 0014's notification_preferences RLS shape: a user can select,
// insert (upsert their first-ever toggle of a given event type) and update only their own row -
// never anyone else's, not even a tenant_admin's, mirroring notifications' own "no notification.view
// action exists for any role" reasoning (tests/rls/notifications.spec.ts). No delete policy exists
// for anyone (CLAUDE.md #3) - "turn back on" is another upsert (enabled = true), never a row
// removal.

let migrator: pg.Client;

const ids = {
  tenantA: "",
  tenantB: "",
  userA: "",
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
  await migrator.query("truncate notification_preferences, user_roles, users, tenants cascade");

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-notif-prefs') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-notif-prefs') returning id");
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  ids.userA = await makeUser(ids.tenantA, "user-a@example.com");
  ids.otherUserA = await makeUser(ids.tenantA, "other-user-a@example.com");
  ids.userB = await makeUser(ids.tenantB, "user-b@example.com");

  // Same reasoning as tests/rls/notifications.spec.ts: every role should behave identically here
  // (no notification.view/notification.preferences action of any kind exists), so a tenant_admin
  // grant on otherUserA proves even that role gets no special visibility over userA's own row.
  await grant(ids.tenantA, ids.otherUserA, "tenant_admin");
  await grant(ids.tenantA, ids.userA, "executive");
  await grant(ids.tenantB, ids.userB, "executive");
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

async function tryQuery(client: pg.Client, sql: string, params: unknown[]): Promise<pg.QueryResult | false> {
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (err instanceof Error && /row-level security/.test(err.message)) return false;
    throw err;
  }
}

function insertPreference(userId: string, tenantId: string, eventType = "task_overdue", enabled = false) {
  return migrator.query(
    `insert into notification_preferences (tenant_id, user_id, event_type, enabled)
     values ($1, $2, $3, $4) returning id`,
    [tenantId, userId, eventType, enabled],
  );
}

describe("notification_preferences_select: own row only, no tenant-wide override for any role", () => {
  // Each test below inserts its own row for the same user - notification_preferences enforces
  // unique(user_id, event_type), so each needs a distinct event_type to avoid colliding with the
  // others (unlike notifications, which has no such uniqueness constraint).
  it("a user can see their own preference row", async () => {
    const { rows: inserted } = await insertPreference(ids.userA, ids.tenantA, "select_own");
    const client = await asUser(ids.userA);
    const { rows } = await client.query("select id from notification_preferences where id = $1", [inserted[0].id]);
    await client.end();
    expect(rows).toHaveLength(1);
  });

  it("a same-tenant tenant_admin cannot see someone else's preference row", async () => {
    const { rows: inserted } = await insertPreference(ids.userA, ids.tenantA, "select_tenant_admin");
    const client = await asUser(ids.otherUserA); // holds tenant_admin
    const { rows } = await client.query("select id from notification_preferences where id = $1", [inserted[0].id]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("a user in a different tenant cannot see it at all", async () => {
    const { rows: inserted } = await insertPreference(ids.userA, ids.tenantA, "select_cross_tenant");
    const client = await asUser(ids.userB);
    const { rows } = await client.query("select id from notification_preferences where id = $1", [inserted[0].id]);
    await client.end();
    expect(rows).toHaveLength(0);
  });
});

describe("notification_preferences_upsert: a user can insert only their own row", () => {
  it("a user can insert a preference row for themselves", async () => {
    const client = await asUser(ids.userA);
    const result = await tryQuery(
      client,
      `insert into notification_preferences (tenant_id, user_id, event_type, enabled) values ($1, $2, 'upsert_self', false)`,
      [ids.tenantA, ids.userA],
    );
    await client.end();
    expect(result).not.toBe(false);
    expect((result as pg.QueryResult).rowCount).toBe(1);
  });

  it("a user cannot insert a preference row for someone else, not even a tenant_admin", async () => {
    const client = await asUser(ids.otherUserA); // holds tenant_admin
    // A different event_type than the test above, so this is unambiguously an RLS rejection, not a
    // unique(user_id, event_type) collision with that test's own already-inserted row.
    const result = await tryQuery(
      client,
      `insert into notification_preferences (tenant_id, user_id, event_type, enabled) values ($1, $2, 'upsert_other', false)`,
      [ids.tenantA, ids.userA],
    );
    await client.end();
    expect(result).toBe(false);
  });
});

describe("notification_preferences_update: a user can update only their own row", () => {
  it("a user can update their own preference row", async () => {
    const { rows: inserted } = await insertPreference(ids.userA, ids.tenantA, "update_own", true);
    const client = await asUser(ids.userA);
    const result = await client.query("update notification_preferences set enabled = false where id = $1", [inserted[0].id]);
    await client.end();
    expect(result.rowCount).toBe(1);
  });

  it("someone else cannot update another user's preference row", async () => {
    const { rows: inserted } = await insertPreference(ids.userA, ids.tenantA, "update_other", true);
    const client = await asUser(ids.otherUserA);
    const result = await client.query("update notification_preferences set enabled = false where id = $1", [inserted[0].id]);
    await client.end();
    expect(result.rowCount).toBe(0);
  });
});

describe("no hard-delete path on notification_preferences", () => {
  // Asserts 0 rows affected, not a thrown "permission denied" error - this table (like the real
  // hosted Supabase project generally) grants `authenticated` full table-level DELETE, matching
  // information_schema.role_table_grants verified directly against the real project during this
  // migration's own review; RLS (no delete policy exists) is what actually blocks it, by filtering
  // the DELETE down to zero matching rows, not by revoking the privilege outright. This is a
  // genuine, disclosed divergence from tests/rls/notifications.spec.ts's own "no hard-delete" test,
  // which asserts a thrown /permission denied/ error - that pattern only holds because notifications'
  // own local `authenticated` grant (set manually, out of band, at some undocumented point in this
  // repo's history) happens to omit DELETE entirely, which does NOT match the real hosted project's
  // actual privilege model. Not "fixed" here for notifications/every other existing table - out of
  // scope for this migration - but not silently copied either.
  it("no role, not even tenant_admin, can DELETE a preference row - CLAUDE.md #3", async () => {
    const { rows: inserted } = await insertPreference(ids.userA, ids.tenantA, "delete_own");
    const client = await asUser(ids.otherUserA);
    const result = await client.query("delete from notification_preferences where id = $1", [inserted[0].id]);
    await client.end();
    expect(result.rowCount).toBe(0);

    const { rows: stillThere } = await migrator.query("select id from notification_preferences where id = $1", [inserted[0].id]);
    expect(stillThere).toHaveLength(1);
  });
});

describe("notifications_task_overdue_once: at most one task_overdue notification per task", () => {
  it("a second task_overdue insert for the same entity_id is rejected by the partial unique index", async () => {
    const taskId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    await migrator.query(
      `insert into notifications (tenant_id, recipient_id, actor_id, event_type, entity_type, entity_id, title)
       values ($1, $2, null, 'task_overdue', 'task', $3, 'A task is overdue')`,
      [ids.tenantA, ids.userA, taskId],
    );
    await expect(
      migrator.query(
        `insert into notifications (tenant_id, recipient_id, actor_id, event_type, entity_type, entity_id, title)
         values ($1, $2, null, 'task_overdue', 'task', $3, 'A task is overdue')`,
        [ids.tenantA, ids.userA, taskId],
      ),
    ).rejects.toThrow(/duplicate key value violates unique constraint "notifications_task_overdue_once"/);
  });

  it("a different event_type for the same entity_id is unaffected by the partial index", async () => {
    const taskId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    await migrator.query(
      `insert into notifications (tenant_id, recipient_id, actor_id, event_type, entity_type, entity_id, title)
       values ($1, $2, null, 'task_assigned', 'task', $3, 'A task was assigned to you')`,
      [ids.tenantA, ids.userA, taskId],
    );
    const result = await migrator.query(
      `insert into notifications (tenant_id, recipient_id, actor_id, event_type, entity_type, entity_id, title)
       values ($1, $2, null, 'task_overdue', 'task', $3, 'A task is overdue') returning id`,
      [ids.tenantA, ids.userA, taskId],
    );
    expect(result.rowCount).toBe(1);
  });
});
