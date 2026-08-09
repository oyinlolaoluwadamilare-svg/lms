import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M5.2 exit criteria (docs/07-build-backlog.md): "`closeDeal` service: atomic outcome, stage
// event, status, open-task cancellation, audit. Closing is impossible without a reason; loss
// requires detail; lost-to-competitor requires a name." Exercises migration 0017's close_deal
// Postgres function directly, through real `authenticated` sessions (not the superuser migrator
// client) - proving the function is actually callable by the role PostgREST calls it as, that it
// really is atomic (a rejected call leaves every one of the four tables it touches untouched), and
// documenting its trust boundary: `close_deal` does not re-check deal.mark_won/deal.mark_lost's own
// role-scope itself (src/services/deals.ts's closeDeal does, before ever invoking this), so a
// session with no business reason to close this particular deal can still do it directly - the same
// trust relationship this codebase already has with writeStageEvent/writeAudit/sweep_overdue_tasks.

let migrator: pg.Client;

const ids = {
  tenantA: "",
  tenantB: "",
  practiceA: "",
  bdeA: "",
  otherPracticeUserA: "",
  openStageA: "",
  wonStageA: "",
  lostStageA: "",
  accountA: "",
  winReasonA: "",
  lossReasonA: "",
  competitorReasonA: "",
  winReasonB: "",
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
  await migrator.query("insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, $3, $4)", [
    tenantId,
    userId,
    role,
    practiceLineId,
  ]);
}

async function makeDeal(tenantId: string, practiceLineId: string, accountId: string, stageId: string, ownerId: string, reference: string) {
  const { rows } = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type, owner_id, author_id, status, expected_close_date)
     values ($1, $2, $2, $3, $4, $5, 'new', $6, $6, 'active', current_date + 30) returning id`,
    [tenantId, reference, accountId, practiceLineId, stageId, ownerId],
  );
  return rows[0].id;
}

async function makeTask(tenantId: string, dealId: string, status: string, assigneeId: string) {
  const isDone = status === "done";
  const { rows } = await migrator.query(
    `insert into tasks (tenant_id, deal_id, title, status, due_date, assignee_id, assigned_by, completed_at, completed_by)
     values ($1, $2, $3, $4::task_status, current_date + 1, $5::uuid, $5::uuid, $6, $7)
     returning id`,
    [tenantId, dealId, `${status} task`, status, assigneeId, isDone ? new Date() : null, isDone ? assigneeId : null],
  );
  return rows[0].id;
}

async function seed() {
  migrator = await migratorClient();
  await migrator.query(
    "truncate audit_entries, stage_events, deal_outcomes, tasks, deals, accounts, outcome_reasons, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-close-deal') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-close-deal') returning id");
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  const practiceA = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantA],
  );
  ids.practiceA = practiceA.rows[0].id;
  const practiceB = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantB],
  );

  ids.bdeA = await makeUser(ids.tenantA, "bde-close-a@example.com");
  ids.otherPracticeUserA = await makeUser(ids.tenantA, "other-practice-close-a@example.com");
  await grant(ids.tenantA, ids.bdeA, "bde", ids.practiceA);
  await grant(ids.tenantA, ids.otherPracticeUserA, "bde", ids.practiceA);

  const openStage = await migrator.query(
    "insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type) values ($1, 'Discovery', 'DISCOVERY', 1, 20, 'open') returning id",
    [ids.tenantA],
  );
  ids.openStageA = openStage.rows[0].id;
  const wonStage = await migrator.query(
    "insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type) values ($1, 'Won', 'WON', 90, 100, 'won') returning id",
    [ids.tenantA],
  );
  ids.wonStageA = wonStage.rows[0].id;
  const lostStage = await migrator.query(
    "insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type) values ($1, 'Lost', 'LOST', 91, 0, 'lost') returning id",
    [ids.tenantA],
  );
  ids.lostStageA = lostStage.rows[0].id;

  const accountA = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Test Client') returning id", [ids.tenantA]);
  ids.accountA = accountA.rows[0].id;

  const winReasonA = await migrator.query(
    "insert into outcome_reasons (tenant_id, type, label, requires_competitor_name) values ($1, 'win', 'Best fit', false) returning id",
    [ids.tenantA],
  );
  ids.winReasonA = winReasonA.rows[0].id;
  const lossReasonA = await migrator.query(
    "insert into outcome_reasons (tenant_id, type, label, requires_competitor_name) values ($1, 'loss', 'Budget cut', false) returning id",
    [ids.tenantA],
  );
  ids.lossReasonA = lossReasonA.rows[0].id;
  const competitorReasonA = await migrator.query(
    "insert into outcome_reasons (tenant_id, type, label, requires_competitor_name) values ($1, 'loss', 'Lost to competitor', true) returning id",
    [ids.tenantA],
  );
  ids.competitorReasonA = competitorReasonA.rows[0].id;

  const winReasonB = await migrator.query(
    "insert into outcome_reasons (tenant_id, type, label) values ($1, 'win', 'Tenant B reason') returning id",
    [ids.tenantB],
  );
  ids.winReasonB = winReasonB.rows[0].id;
  void practiceB;
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

async function callCloseDeal(
  client: pg.Client,
  args: {
    dealId: string;
    result: "win" | "loss";
    reasonId: string;
    reasonDetail?: string | null;
    competitorName?: string | null;
    finalValueMinor?: number | null;
    currencyCode?: string | null;
  },
) {
  return client.query(
    `select close_deal($1, $2, $3, $4, $5, $6, $7, current_date)`,
    [
      args.dealId,
      args.result,
      args.reasonId,
      args.reasonDetail ?? null,
      args.competitorName ?? null,
      args.finalValueMinor ?? null,
      args.currencyCode ?? null,
    ],
  );
}

describe("close_deal (migration 0017): atomic outcome + stage + task-cancellation + audit", () => {
  it("a win close atomically writes deal status/stage, stage_events, deal_outcomes and audit_entries, and cancels only open tasks", async () => {
    const dealId = await makeDeal(ids.tenantA, ids.practiceA, ids.accountA, ids.openStageA, ids.bdeA, "D-CLOSE-WIN");
    const openTaskId = await makeTask(ids.tenantA, dealId, "open", ids.bdeA);
    const inProgressTaskId = await makeTask(ids.tenantA, dealId, "in_progress", ids.bdeA);
    const doneTaskId = await makeTask(ids.tenantA, dealId, "done", ids.bdeA);

    const client = await asUser(ids.bdeA);
    await callCloseDeal(client, { dealId, result: "win", reasonId: ids.winReasonA, finalValueMinor: 1_200_000, currencyCode: "NGN" });
    await client.end();

    const { rows: dealRows } = await migrator.query("select status, stage_id, actual_close_date from deals where id = $1", [dealId]);
    expect(dealRows[0].status).toBe("won");
    expect(dealRows[0].stage_id).toBe(ids.wonStageA);
    expect(dealRows[0].actual_close_date).not.toBeNull();

    const { rows: stageEventRows } = await migrator.query(
      "select from_stage_id, to_stage_id, actor_id from stage_events where deal_id = $1",
      [dealId],
    );
    expect(stageEventRows).toHaveLength(1);
    expect(stageEventRows[0].from_stage_id).toBe(ids.openStageA);
    expect(stageEventRows[0].to_stage_id).toBe(ids.wonStageA);
    expect(stageEventRows[0].actor_id).toBe(ids.bdeA);

    const { rows: outcomeRows } = await migrator.query(
      "select result, reason_id, final_value_minor, closed_by from deal_outcomes where deal_id = $1",
      [dealId],
    );
    expect(outcomeRows).toHaveLength(1);
    expect(outcomeRows[0].result).toBe("win");
    expect(outcomeRows[0].reason_id).toBe(ids.winReasonA);
    expect(outcomeRows[0].closed_by).toBe(ids.bdeA);

    const { rows: taskRows } = await migrator.query("select id, status from tasks where deal_id = $1 order by id", [dealId]);
    const statusById = new Map(taskRows.map((r) => [r.id, r.status]));
    expect(statusById.get(openTaskId)).toBe("cancelled");
    expect(statusById.get(inProgressTaskId)).toBe("cancelled");
    expect(statusById.get(doneTaskId)).toBe("done");

    const { rows: auditRows } = await migrator.query(
      "select action, actor_id from audit_entries where entity_type = 'deal' and entity_id = $1",
      [dealId],
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("deal.mark_won");
    expect(auditRows[0].actor_id).toBe(ids.bdeA);
  });

  it("a loss close with detail succeeds and cancels the deal's open task", async () => {
    const dealId = await makeDeal(ids.tenantA, ids.practiceA, ids.accountA, ids.openStageA, ids.bdeA, "D-CLOSE-LOSS");
    const taskId = await makeTask(ids.tenantA, dealId, "in_progress", ids.bdeA);

    const client = await asUser(ids.bdeA);
    await callCloseDeal(client, { dealId, result: "loss", reasonId: ids.lossReasonA, reasonDetail: "Budget cut mid-cycle" });
    await client.end();

    const { rows: dealRows } = await migrator.query("select status, stage_id from deals where id = $1", [dealId]);
    expect(dealRows[0].status).toBe("lost");
    expect(dealRows[0].stage_id).toBe(ids.lostStageA);

    const { rows: taskRows } = await migrator.query("select status from tasks where id = $1", [taskId]);
    expect(taskRows[0].status).toBe("cancelled");
  });

  it("rejects a loss with no detail, and leaves every table untouched (atomicity)", async () => {
    const dealId = await makeDeal(ids.tenantA, ids.practiceA, ids.accountA, ids.openStageA, ids.bdeA, "D-CLOSE-REJECT-1");
    const client = await asUser(ids.bdeA);

    await expect(callCloseDeal(client, { dealId, result: "loss", reasonId: ids.lossReasonA })).rejects.toThrow(/loss_requires_detail/);
    await client.end();

    const { rows: dealRows } = await migrator.query("select status, stage_id from deals where id = $1", [dealId]);
    expect(dealRows[0].status).toBe("active");
    expect(dealRows[0].stage_id).toBe(ids.openStageA);
    expect((await migrator.query("select 1 from deal_outcomes where deal_id = $1", [dealId])).rowCount).toBe(0);
    expect((await migrator.query("select 1 from stage_events where deal_id = $1", [dealId])).rowCount).toBe(0);
    expect((await migrator.query("select 1 from audit_entries where entity_id = $1", [dealId])).rowCount).toBe(0);
  });

  it("rejects a competitor-required loss reason with no competitor name, and leaves every table untouched", async () => {
    const dealId = await makeDeal(ids.tenantA, ids.practiceA, ids.accountA, ids.openStageA, ids.bdeA, "D-CLOSE-REJECT-2");
    const client = await asUser(ids.bdeA);

    await expect(
      callCloseDeal(client, { dealId, result: "loss", reasonId: ids.competitorReasonA, reasonDetail: "They went elsewhere" }),
    ).rejects.toThrow(/requires a competitor name/);
    await client.end();

    expect((await migrator.query("select 1 from deals where id = $1 and status = 'active'", [dealId])).rowCount).toBe(1);
    expect((await migrator.query("select 1 from deal_outcomes where deal_id = $1", [dealId])).rowCount).toBe(0);
  });

  it("accepts a competitor-required loss reason once a competitor name is given", async () => {
    const dealId = await makeDeal(ids.tenantA, ids.practiceA, ids.accountA, ids.openStageA, ids.bdeA, "D-CLOSE-COMPETITOR-OK");
    const client = await asUser(ids.bdeA);

    await callCloseDeal(client, {
      dealId,
      result: "loss",
      reasonId: ids.competitorReasonA,
      reasonDetail: "Lost on price",
      competitorName: "Acme Corp",
    });
    await client.end();

    const { rows } = await migrator.query("select competitor_name from deal_outcomes where deal_id = $1", [dealId]);
    expect(rows[0].competitor_name).toBe("Acme Corp");
  });

  it("rejects a reason whose type doesn't match the result (a win reason used to record a loss)", async () => {
    const dealId = await makeDeal(ids.tenantA, ids.practiceA, ids.accountA, ids.openStageA, ids.bdeA, "D-CLOSE-REJECT-3");
    const client = await asUser(ids.bdeA);

    await expect(
      callCloseDeal(client, { dealId, result: "loss", reasonId: ids.winReasonA, reasonDetail: "detail" }),
    ).rejects.toThrow(/does not match result/);
    await client.end();
  });

  it("rejects a reason belonging to a different tenant", async () => {
    const dealId = await makeDeal(ids.tenantA, ids.practiceA, ids.accountA, ids.openStageA, ids.bdeA, "D-CLOSE-REJECT-4");
    const client = await asUser(ids.bdeA);

    await expect(callCloseDeal(client, { dealId, result: "win", reasonId: ids.winReasonB })).rejects.toThrow(/not found for this tenant/);
    await client.end();
  });

  it("re-closing an already-won deal fails on the deal_outcomes primary key, atomically (no partial re-write)", async () => {
    const dealId = await makeDeal(ids.tenantA, ids.practiceA, ids.accountA, ids.openStageA, ids.bdeA, "D-CLOSE-ALREADY");
    const client = await asUser(ids.bdeA);
    await callCloseDeal(client, { dealId, result: "win", reasonId: ids.winReasonA });

    await expect(callCloseDeal(client, { dealId, result: "win", reasonId: ids.winReasonA })).rejects.toThrow(
      /duplicate key value violates unique constraint "deal_outcomes_pkey"/,
    );
    await client.end();

    const { rows } = await migrator.query("select count(*)::int as n from deal_outcomes where deal_id = $1", [dealId]);
    expect(rows[0].n).toBe(1);
  });

  // Trust-boundary documentation, not a gap: migration 0017's own header comment is explicit that
  // close_deal does not re-implement deal.mark_won/deal.mark_lost's own role-scope check - that is
  // src/services/deals.ts's closeDeal's job, before this function is ever invoked. A session with
  // no business relationship to the deal at all can still call this function directly and succeed,
  // the same trust relationship writeStageEvent/writeAudit/sweep_overdue_tasks already have with
  // their own callers. This is exactly why closeDeal (the TS service) must never be bypassed.
  it("documents the trust boundary: a practice peer with no deal.mark_won scope over this specific deal can still call close_deal directly", async () => {
    const dealId = await makeDeal(ids.tenantA, ids.practiceA, ids.accountA, ids.openStageA, ids.bdeA, "D-CLOSE-TRUST-BOUNDARY");
    const client = await asUser(ids.otherPracticeUserA);

    await callCloseDeal(client, { dealId, result: "win", reasonId: ids.winReasonA });
    await client.end();

    const { rows } = await migrator.query("select status from deals where id = $1", [dealId]);
    expect(rows[0].status).toBe("won");
  });
});
