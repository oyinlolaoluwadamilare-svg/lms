import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M4.1 exit criteria (docs/07-build-backlog.md): "tasks, task_assignments, task_comments,
// task_watchers migrations with the blocked and done constraints." Proves migration 0011's DB-level
// constraints (blocked_needs_reason, done_needs_completion) and RLS shape: tasks_select/insert/
// update mirror docs/02-permission-matrix.md's Tasks section (own+assigned+practice for bde,
// practice for team_lead/director, tenant for executive/tenant_admin), task_assignments is
// read-only/immutable for `authenticated` (the domain model's own "immutable reassignment ledger"),
// task_comments is visible-scoped for both read and write, and task_watchers is select-only for now
// (M4.1's own migration comment: no "add watcher" action exists in the permission matrix yet).

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
    "truncate task_watchers, task_comments, task_assignments, tasks, activities, deal_co_owners, deals, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-tasks') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-tasks') returning id");
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
  ids.stageDiscovery = stageDiscovery.rows[0].id;

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
     values ($1, 'D-TASK-A', 'Deal A', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantA, ids.accountA, ids.practiceA1, ids.stageDiscovery, ids.bdeA1],
  );
  ids.dealOwnedByBde1 = dealA.rows[0].id;

  const dealB = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-TASK-B', 'Deal B', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
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

describe("migration 0011: constraints", () => {
  it("rejects an empty title", async () => {
    await expect(
      migrator.query(
        `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
         values ($1, $2, '   ', $3, $3, current_date)`,
        [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
      ),
    ).rejects.toThrow();
  });

  it("rejects status = 'blocked' with no blocked_reason", async () => {
    await expect(
      migrator.query(
        `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date, status)
         values ($1, $2, 'Blocked task', $3, $3, current_date, 'blocked')`,
        [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
      ),
    ).rejects.toThrow(/blocked_needs_reason/);
  });

  it("accepts status = 'blocked' with a real blocked_reason", async () => {
    const { rows } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date, status, blocked_reason)
       values ($1, $2, 'Blocked task with reason', $3, $3, current_date, 'blocked', 'Waiting on legal') returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    expect(rows[0].id).toBeDefined();
  });

  it("rejects status = 'done' with no completed_at/completed_by", async () => {
    await expect(
      migrator.query(
        `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date, status)
         values ($1, $2, 'Done task', $3, $3, current_date, 'done')`,
        [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
      ),
    ).rejects.toThrow(/done_needs_completion/);
  });

  it("accepts status = 'done' with both completed_at and completed_by set", async () => {
    const { rows } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date, status, completed_at, completed_by)
       values ($1, $2, 'Done task, properly completed', $3, $3, current_date, 'done', now(), $3) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    expect(rows[0].id).toBeDefined();
  });

  it("rejects a null due_date - resolved as NOT NULL per docs/01-domain-model.md", async () => {
    await expect(
      migrator.query(
        `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
         values ($1, $2, 'No due date', $3, $3, null)`,
        [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
      ),
    ).rejects.toThrow();
  });
});

describe("tasks_select: own+assigned+practice (bde), practice (team_lead/director), tenant (executive/tenant_admin)", () => {
  it("a bde in the deal's own practice can see a task on it, even one assigned to someone else", async () => {
    await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Visible via practice', $3, $3, current_date)`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.teamLeadA],
    );
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select id from tasks where deal_id = $1 and title = 'Visible via practice'", [
      ids.dealOwnedByBde1,
    ]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a bde in a different practice, same tenant, cannot see it", async () => {
    const client = await asUser(ids.otherPracticeUser);
    const { rows } = await client.query("select id from tasks where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("a deal-less task is visible to its own assignee even though they hold no practice entitlement for it to derive from", async () => {
    const { rows: inserted } = await migrator.query(
      `insert into tasks (tenant_id, title, assignee_id, assigned_by, due_date)
       values ($1, 'No deal, personal task', $2, $2, current_date) returning id`,
      [ids.tenantA, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select id from tasks where id = $1", [inserted[0].id]);
    await client.end();
    expect(rows).toHaveLength(1);
  });

  it("a deal-less task is invisible to a same-practice colleague who is neither its assignee nor assigner", async () => {
    const { rows: inserted } = await migrator.query(
      `insert into tasks (tenant_id, title, assignee_id, assigned_by, due_date)
       values ($1, 'No deal, not yours', $2, $2, current_date) returning id`,
      [ids.tenantA, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA2);
    const { rows } = await client.query("select id from tasks where id = $1", [inserted[0].id]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("executive sees it tenant-wide despite holding no practice grant", async () => {
    const client = await asUser(ids.execA);
    const { rows } = await client.query("select id from tasks where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a different tenant entirely sees none of it", async () => {
    const client = await asUser(ids.otherTenantUser);
    const { rows } = await client.query("select id from tasks where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows).toHaveLength(0);
  });
});

describe("tasks_insert: task.create's practice/tenant scope", () => {
  it("a bde in the deal's own practice can create a task on it", async () => {
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(
      client,
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Created by owning bde', $3, $3, current_date)`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    await client.end();
    expect(inserted).toBe(true);
  });

  it("a bde outside the deal's practice cannot create a task on it", async () => {
    const client = await asUser(ids.otherPracticeUser);
    const inserted = await tryInsert(
      client,
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Outsider attempt', $3, $3, current_date)`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.otherPracticeUser],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("a deal-less task can be created by any practice-scoped writer - can() enforces the real assignee-scope rule, not RLS", async () => {
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(
      client,
      `insert into tasks (tenant_id, title, assignee_id, assigned_by, due_date)
       values ($1, 'Personal, no deal', $2, $2, current_date)`,
      [ids.tenantA, ids.bdeA1],
    );
    await client.end();
    expect(inserted).toBe(true);
  });

  it("executive can never create a task", async () => {
    const client = await asUser(ids.execA);
    const inserted = await tryInsert(
      client,
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Exec attempt', $3, $3, current_date)`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.execA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("tenant_admin can create a task on any deal in the tenant", async () => {
    const client = await asUser(ids.adminA);
    const inserted = await tryInsert(
      client,
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Admin created', $3, $3, current_date)`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.adminA],
    );
    await client.end();
    expect(inserted).toBe(true);
  });
});

describe("tasks_update: assignee/assigner (bde), practice (team_lead/director), tenant (tenant_admin)", () => {
  it("the assignee can update their own task", async () => {
    const { rows } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Assignee updates this', $3, $4, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1, ids.teamLeadA],
    );
    const client = await asUser(ids.bdeA1);
    const result = await client.query("update tasks set title = 'Updated by assignee' where id = $1", [rows[0].id]);
    await client.end();
    expect(result.rowCount).toBe(1);
  });

  it("the assigner can update a task they assigned to someone else", async () => {
    const { rows } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Assigner updates this', $3, $4, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA2, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA1);
    const result = await client.query("update tasks set title = 'Updated by assigner' where id = $1", [rows[0].id]);
    await client.end();
    expect(result.rowCount).toBe(1);
  });

  it("a same-practice bde who is neither assignee nor assigner cannot update it", async () => {
    const { rows } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Not bde2''s task', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.teamLeadA],
    );
    const client = await asUser(ids.bdeA2);
    const result = await client.query("update tasks set title = 'Hijacked' where id = $1", [rows[0].id]);
    await client.end();
    expect(result.rowCount).toBe(0);
  });

  it("director can update any task in their entitled practice, even one they neither created nor were assigned", async () => {
    const { rows } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Director updates via practice', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.directorA);
    const result = await client.query("update tasks set title = 'Updated by director' where id = $1", [rows[0].id]);
    await client.end();
    expect(result.rowCount).toBe(1);
  });

  it("executive can never update a task", async () => {
    const { rows } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Exec cannot update', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.execA);
    const result = await client.query("update tasks set title = 'Hijacked by exec' where id = $1", [rows[0].id]);
    await client.end();
    expect(result.rowCount).toBe(0);
  });
});

describe("no hard-delete path on tasks", () => {
  it("no role, not even tenant_admin, can DELETE a tasks row - CLAUDE.md #3", async () => {
    const { rows } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Never hard deleted', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.adminA);
    await expect(client.query("delete from tasks where id = $1", [rows[0].id])).rejects.toThrow(/permission denied/);
    await client.end();

    const { rows: stillThere } = await migrator.query("select id from tasks where id = $1", [rows[0].id]);
    expect(stillThere).toHaveLength(1);
  });
});

describe("task_assignments: 'the immutable reassignment ledger' - select-only, matching the parent task's visibility", () => {
  it("the task's own assignee can see its assignment history", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Has assignment history', $3, $4, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1, ids.teamLeadA],
    );
    await migrator.query(
      "insert into task_assignments (task_id, to_user_id, assigned_by) values ($1, $2, $3)",
      [task[0].id, ids.bdeA1, ids.teamLeadA],
    );
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select id from task_assignments where task_id = $1", [task[0].id]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a bde outside the deal's practice cannot see the assignment history", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Hidden assignment history', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    await migrator.query("insert into task_assignments (task_id, to_user_id, assigned_by) values ($1, $2, $2)", [
      task[0].id,
      ids.bdeA1,
    ]);
    const client = await asUser(ids.otherPracticeUser);
    const { rows } = await client.query("select id from task_assignments where task_id = $1", [task[0].id]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("no `authenticated` identity can insert a task_assignments row directly - only a future service-role write path (M4.2) may", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'No direct insert', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.adminA);
    const inserted = await tryInsert(
      client,
      "insert into task_assignments (task_id, to_user_id, assigned_by) values ($1, $2, $2)",
      [task[0].id, ids.adminA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("update and delete raise even for the migrator/superuser identity directly - forbid_mutation()", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Immutable ledger row', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const { rows: assignment } = await migrator.query(
      "insert into task_assignments (task_id, to_user_id, assigned_by) values ($1, $2, $2) returning id",
      [task[0].id, ids.bdeA1],
    );
    await expect(
      migrator.query("update task_assignments set to_user_id = $1 where id = $2", [ids.bdeA2, assignment[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(migrator.query("delete from task_assignments where id = $1", [assignment[0].id])).rejects.toThrow(/append-only/);
  });

  // M4.10 exit criteria (docs/07-build-backlog.md): "reassignment history is never overwritten."
  // The test above only proves this for the migrator/superuser identity - the same two-tier shape
  // tests/rls/audit_log.spec.ts already established for the OTHER immutable ledger table in this
  // codebase (its own "update raises for an authenticated tenant_admin identity too") is added here
  // too, since forbid_mutation() blocking the table owner is a different, weaker guarantee than it
  // also blocking a real signed-in session - even the role with the broadest reach anywhere else in
  // this schema.
  it("update and delete raise for an authenticated tenant_admin identity too, not just the migrator", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Immutable even for tenant_admin', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const { rows: assignment } = await migrator.query(
      "insert into task_assignments (task_id, to_user_id, assigned_by) values ($1, $2, $2) returning id",
      [task[0].id, ids.bdeA1],
    );
    const client = await asUser(ids.adminA);
    await expect(
      client.query("update task_assignments set to_user_id = $1 where id = $2", [ids.bdeA2, assignment[0].id]),
    ).rejects.toThrow(/append-only|row-level security/);
    await expect(client.query("delete from task_assignments where id = $1", [assignment[0].id])).rejects.toThrow(
      /append-only|row-level security/,
    );
    await client.end();

    const { rows: stillThere } = await migrator.query(
      "select to_user_id from task_assignments where id = $1",
      [assignment[0].id],
    );
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].to_user_id).toBe(ids.bdeA1);
  });
});

describe("task_comments: task.comment is 'visible' for both read and write - the same audience as task.view", () => {
  it("the task's own assignee can post a comment on it", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Commentable by assignee', $3, $4, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1, ids.teamLeadA],
    );
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(
      client,
      "insert into task_comments (task_id, author_id, body) values ($1, $2, 'On it')",
      [task[0].id, ids.bdeA1],
    );
    await client.end();
    expect(inserted).toBe(true);
  });

  it("a same-practice colleague (visible via practice) can also comment, even if neither assignee nor assigner", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Commentable via practice', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA2);
    const inserted = await tryInsert(
      client,
      "insert into task_comments (task_id, author_id, body) values ($1, $2, 'Practice-wide visibility')",
      [task[0].id, ids.bdeA2],
    );
    await client.end();
    expect(inserted).toBe(true);
  });

  it("a bde outside the deal's practice cannot see or comment on it", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Not visible outside practice', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.otherPracticeUser);
    const { rows: seen } = await client.query("select id from task_comments where task_id = $1", [task[0].id]);
    const inserted = await tryInsert(
      client,
      "insert into task_comments (task_id, author_id, body) values ($1, $2, 'Should not land')",
      [task[0].id, ids.otherPracticeUser],
    );
    await client.end();
    expect(seen).toHaveLength(0);
    expect(inserted).toBe(false);
  });

  it("cannot post a comment impersonating a different author_id", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'No impersonation', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(
      client,
      "insert into task_comments (task_id, author_id, body) values ($1, $2, 'Pretending to be someone else')",
      [task[0].id, ids.teamLeadA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });

  it("rejects an empty comment body", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Empty body rejected', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    await expect(
      migrator.query("insert into task_comments (task_id, author_id, body) values ($1, $2, '   ')", [task[0].id, ids.bdeA1]),
    ).rejects.toThrow();
  });
});

// M4.9 (docs/07-build-backlog.md): "Comments, watchers and @mention with an in-scope user picker."
// task_watchers_insert (migration 0015) mirrors task_comments_insert's own "visible" shape, minus
// the author_id=auth.uid() restriction (added_by=auth.uid() is still enforced, but the WATCHED
// user_id can be anyone - RLS cannot verify a SECOND person's own role, so the fine-grained "is this
// other user actually in scope" check is src/services/taskComments.ts's job, the same
// "you can only pick who the picker offered" split createTask's own assignee re-check established).
describe("task_watchers: visible-scoped insert as of M4.9 (migration 0015), same audience as task_comments", () => {
  it("the task's own assignee can see who is watching it", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Has a watcher', $3, $4, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1, ids.teamLeadA],
    );
    await migrator.query("insert into task_watchers (task_id, user_id) values ($1, $2)", [task[0].id, ids.teamLeadA]);
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select user_id from task_watchers where task_id = $1", [task[0].id]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("the task's own assignee can add themselves as a watcher", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Self-watch', $3, $4, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1, ids.teamLeadA],
    );
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(client, "insert into task_watchers (task_id, user_id, added_by) values ($1, $2, $2)", [
      task[0].id,
      ids.bdeA1,
    ]);
    await client.end();
    expect(inserted).toBe(true);
  });

  it("a same-practice colleague (visible via practice) can add someone else as a watcher too", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Watcher added by a practice peer', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA2);
    const inserted = await tryInsert(
      client,
      "insert into task_watchers (task_id, user_id, added_by) values ($1, $2, $3)",
      [task[0].id, ids.teamLeadA, ids.bdeA2],
    );
    await client.end();
    expect(inserted).toBe(true);
  });

  it("a bde outside the deal's practice cannot see the task or add a watcher to it", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Not visible outside practice', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.otherPracticeUser);
    const { rows: seen } = await client.query("select task_id from task_watchers where task_id = $1", [task[0].id]);
    const inserted = await tryInsert(
      client,
      "insert into task_watchers (task_id, user_id, added_by) values ($1, $2, $2)",
      [task[0].id, ids.otherPracticeUser],
    );
    await client.end();
    expect(seen).toHaveLength(0);
    expect(inserted).toBe(false);
  });

  it("cannot add a watcher impersonating a different added_by", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'No impersonation', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(
      client,
      "insert into task_watchers (task_id, user_id, added_by) values ($1, $2, $3)",
      [task[0].id, ids.teamLeadA, ids.teamLeadA],
    );
    await client.end();
    expect(inserted).toBe(false);
  });
});

// task_comments_resolve (migration 0015) - scoped like tasks_update (task.resolve_comment's own
// shape), narrower than task_comments_select/_insert's own visibility-only shape: a practice peer
// with mere visibility, unlike the assignee/assigner/a lead, cannot resolve someone else's comment.
describe("task_comments_resolve: assigned_by/assigned for bde, practice for team_lead/director, denied for executive", () => {
  it("the task's own assignee can resolve a comment on it", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Resolvable by assignee', $3, $4, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1, ids.teamLeadA],
    );
    const { rows: comment } = await migrator.query(
      "insert into task_comments (task_id, author_id, body) values ($1, $2, 'Please check') returning id",
      [task[0].id, ids.teamLeadA],
    );
    const client = await asUser(ids.bdeA1);
    const result = await client.query("update task_comments set resolved_at = now(), resolved_by = $2 where id = $1", [
      comment[0].id,
      ids.bdeA1,
    ]);
    await client.end();
    expect(result.rowCount).toBe(1);
  });

  it("a practice peer with mere visibility (neither assignee, assigner, nor a lead) cannot resolve a comment", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Not resolvable by a peer', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const { rows: comment } = await migrator.query(
      "insert into task_comments (task_id, author_id, body) values ($1, $2, 'Visible but not resolvable') returning id",
      [task[0].id, ids.bdeA1],
    );
    const client = await asUser(ids.bdeA2);
    const result = await client.query("update task_comments set resolved_at = now(), resolved_by = $2 where id = $1", [
      comment[0].id,
      ids.bdeA2,
    ]);
    await client.end();
    expect(result.rowCount).toBe(0);
  });

  it("a director can resolve any comment practice-wide, even one they neither authored nor were assigned", async () => {
    const { rows: task } = await migrator.query(
      `insert into tasks (tenant_id, deal_id, title, assignee_id, assigned_by, due_date)
       values ($1, $2, 'Resolvable by a director', $3, $3, current_date) returning id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
    );
    const { rows: comment } = await migrator.query(
      "insert into task_comments (task_id, author_id, body) values ($1, $2, 'Director can resolve') returning id",
      [task[0].id, ids.bdeA1],
    );
    const client = await asUser(ids.directorA);
    const result = await client.query("update task_comments set resolved_at = now(), resolved_by = $2 where id = $1", [
      comment[0].id,
      ids.directorA,
    ]);
    await client.end();
    expect(result.rowCount).toBe(1);
  });
});
