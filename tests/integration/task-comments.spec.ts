import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { createTask } from "@/services/tasks";
import { addWatcher, createTaskComment, getTaskCommentsContext, resolveTaskComment } from "@/services/taskComments";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M4.9 exit criteria (docs/07-build-backlog.md): "Comments, watchers and @mention with an in-scope
// user picker." Proves, against the real hosted project:
// - createTask's own new auto-watch behaviour: the assignee and assigner become watchers from
//   creation (src/services/tasks.ts).
// - createTaskComment: posting a comment succeeds for whoever has task visibility; @mentioning an
//   in-scope user adds them as a watcher AND sends them a "mentioned" notification
//   (src/services/notifications.ts's sendNotification, wired for real for the first time here);
//   mentioning yourself adds no notification (same self-assign-skip precedent as createTask);
//   mentioning someone OUTSIDE the in-scope picker population is rejected server-side, not merely
//   hidden from the picker (CLAUDE.md #1).
// - addWatcher: self-add (task.watch) and add-other (task.add_watcher, re-validated against the
//   same in-scope population) both work; adding an out-of-scope user is rejected.
// - resolveTaskComment: the task's assignee/assigner can resolve a comment even if someone else
//   wrote it (task.resolve_comment mirrors task.update, not comment authorship); a practice peer
//   with mere visibility cannot; an executive is denied outright (can()-level, RLS never reached).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M4-9-Integration-Test-Pw1!";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  otherPracticeLineId: "",
  stageId: "",
  accountId: "",
  dealId: "",
  assignerAuthId: "",
  assigneeAuthId: "",
  peerAuthId: "",
  otherPracticeAuthId: "",
  executiveAuthId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m4-9-integration-test", "M4.9 Integration Test Tenant");

  ids.practiceLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ADV" },
    { tenant_id: ids.tenantId, name: "Advisory", code: "ADV" },
  );
  ids.otherPracticeLineId = await findOrCreateByUniqueMatch(
    service,
    "practice_lines",
    { tenant_id: ids.tenantId, code: "ES" },
    { tenant_id: ids.tenantId, name: "Executive Search", code: "ES" },
  );
  ids.stageId = await findOrCreateByUniqueMatch(
    service,
    "pipeline_stages",
    { tenant_id: ids.tenantId, code: "DISCOVERY" },
    { tenant_id: ids.tenantId, name: "Discovery", code: "DISCOVERY", sort_order: 1, probability_threshold: 20, stage_type: "open" },
  );
  ids.accountId = await findOrCreateByUniqueMatch(
    service,
    "accounts",
    { tenant_id: ids.tenantId, name: "M4.9 Test Client" },
    { tenant_id: ids.tenantId, name: "M4.9 Test Client" },
  );

  ids.assignerAuthId = await findOrCreateUser(service, ids.tenantId, "m4-9-assigner@example.com", "M4.9 Assigner", PASSWORD);
  ids.assigneeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-9-assignee@example.com", "M4.9 Assignee", PASSWORD);
  ids.peerAuthId = await findOrCreateUser(service, ids.tenantId, "m4-9-peer@example.com", "M4.9 Peer", PASSWORD);
  ids.otherPracticeAuthId = await findOrCreateUser(service, ids.tenantId, "m4-9-other-practice@example.com", "M4.9 Other Practice", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m4-9-executive@example.com", "M4.9 Executive", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.assignerAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.assigneeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.peerAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeAuthId, role: "bde", practice_line_id: ids.otherPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-COMMENTS-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-COMMENTS-1",
      name: "Task Comments Test Deal",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ids.assignerAuthId,
      author_id: ids.assignerAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );

  await service.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("deal_id", ids.dealId).is("deleted_at", null);
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
});

async function makeTask(): Promise<string> {
  const client = await signIn("m4-9-assigner@example.com");
  const session = await getSessionActor(client);
  if (session.status !== "active") throw new Error("expected an active session");
  const result = await createTask(client, session.actor, {
    dealId: ids.dealId,
    originActivityId: null,
    title: "Comments test task",
    description: null,
    assigneeId: ids.assigneeAuthId,
    dueDate: "2027-06-15",
    priority: "normal",
  });
  if (!result.ok) throw new Error(`fixture createTask failed: ${result.code}`);
  return result.task.id;
}

describe("createTask's auto-watch behaviour", () => {
  it("the assignee and assigner are both watchers from creation", async () => {
    const taskId = await makeTask();
    const client = await signIn("m4-9-assigner@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const context = await getTaskCommentsContext(client, session.actor, taskId);
    expect(context).not.toBeNull();
    const watcherIds = context!.watchers.map((w) => w.userId);
    expect(watcherIds).toEqual(expect.arrayContaining([ids.assignerAuthId, ids.assigneeAuthId]));
  });
});

describe("createTaskComment: posting, @mention, watcher/notification side effects", () => {
  it("a practice peer with mere visibility can post a comment", async () => {
    const taskId = await makeTask();
    const client = await signIn("m4-9-peer@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await createTaskComment(client, session.actor, taskId, "Checking in", []);
    expect(result.ok).toBe(true);
  });

  it("@mentioning an in-scope user adds them as a watcher and sends them a mentioned notification", async () => {
    const taskId = await makeTask();
    const client = await signIn("m4-9-assigner@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await createTaskComment(client, session.actor, taskId, "Loop in the peer", [ids.peerAuthId]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const watchers = await getTaskCommentsContext(client, session.actor, taskId);
    expect(watchers!.watchers.map((w) => w.userId)).toContain(ids.peerAuthId);

    const { data: notifications } = await service
      .from("notifications")
      .select("id")
      .eq("entity_id", taskId)
      .eq("event_type", "mentioned")
      .eq("recipient_id", ids.peerAuthId);
    expect(notifications).toHaveLength(1);
  });

  it("mentioning yourself sends no notification", async () => {
    const taskId = await makeTask();
    const client = await signIn("m4-9-assigner@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await createTaskComment(client, session.actor, taskId, "Note to self", [ids.assignerAuthId]);
    expect(result.ok).toBe(true);

    const { data: notifications } = await service
      .from("notifications")
      .select("id")
      .eq("entity_id", taskId)
      .eq("event_type", "mentioned")
      .eq("recipient_id", ids.assignerAuthId);
    expect(notifications).toHaveLength(0);
  });

  it("mentioning a user outside the in-scope picker population is rejected", async () => {
    const taskId = await makeTask();
    const client = await signIn("m4-9-assigner@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await createTaskComment(client, session.actor, taskId, "Mentioning someone out of scope", [ids.otherPracticeAuthId]);
    expect(result).toEqual({ ok: false, code: "invalid_mention" });
  });
});

describe("addWatcher: self-add and add-other, both re-validated server-side", () => {
  it("a practice peer can watch a task themselves (task.watch)", async () => {
    const taskId = await makeTask();
    const client = await signIn("m4-9-peer@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await addWatcher(client, session.actor, taskId, ids.peerAuthId);
    expect(result.ok).toBe(true);
  });

  it("the assigner can add a practice peer as a watcher (task.add_watcher)", async () => {
    const taskId = await makeTask();
    const client = await signIn("m4-9-assigner@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await addWatcher(client, session.actor, taskId, ids.peerAuthId);
    expect(result.ok).toBe(true);
  });

  it("adding a watcher outside the in-scope picker population is rejected", async () => {
    const taskId = await makeTask();
    const client = await signIn("m4-9-assigner@example.com");
    const session = await getSessionActor(client);
    if (session.status !== "active") throw new Error("expected an active session");

    const result = await addWatcher(client, session.actor, taskId, ids.otherPracticeAuthId);
    expect(result).toEqual({ ok: false, code: "invalid_watcher" });
  });
});

describe("resolveTaskComment: scoped like task.update, not comment authorship", () => {
  it("the task's assignee can resolve a comment authored by someone else", async () => {
    const taskId = await makeTask();
    const assignerClient = await signIn("m4-9-assigner@example.com");
    const assignerSession = await getSessionActor(assignerClient);
    if (assignerSession.status !== "active") throw new Error("expected an active session");
    const comment = await createTaskComment(assignerClient, assignerSession.actor, taskId, "Please review", []);
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;

    const assigneeClient = await signIn("m4-9-assignee@example.com");
    const assigneeSession = await getSessionActor(assigneeClient);
    if (assigneeSession.status !== "active") throw new Error("expected an active session");

    const result = await resolveTaskComment(assigneeClient, assigneeSession.actor, comment.commentId, true);
    expect(result.ok).toBe(true);
  });

  it("a practice peer with mere visibility cannot resolve a comment", async () => {
    const taskId = await makeTask();
    const assignerClient = await signIn("m4-9-assigner@example.com");
    const assignerSession = await getSessionActor(assignerClient);
    if (assignerSession.status !== "active") throw new Error("expected an active session");
    const comment = await createTaskComment(assignerClient, assignerSession.actor, taskId, "Visible to the peer", []);
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;

    const peerClient = await signIn("m4-9-peer@example.com");
    const peerSession = await getSessionActor(peerClient);
    if (peerSession.status !== "active") throw new Error("expected an active session");

    const result = await resolveTaskComment(peerClient, peerSession.actor, comment.commentId, true);
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("an executive is denied outright - can()-level, not merely RLS", async () => {
    const taskId = await makeTask();
    const assignerClient = await signIn("m4-9-assigner@example.com");
    const assignerSession = await getSessionActor(assignerClient);
    if (assignerSession.status !== "active") throw new Error("expected an active session");
    const comment = await createTaskComment(assignerClient, assignerSession.actor, taskId, "Executive cannot resolve", []);
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;

    const executiveClient = await signIn("m4-9-executive@example.com");
    const executiveSession = await getSessionActor(executiveClient);
    if (executiveSession.status !== "active") throw new Error("expected an active session");

    const result = await resolveTaskComment(executiveClient, executiveSession.actor, comment.commentId, true);
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("unresolving clears resolved_at/resolved_by back to null", async () => {
    const taskId = await makeTask();
    const assignerClient = await signIn("m4-9-assigner@example.com");
    const assignerSession = await getSessionActor(assignerClient);
    if (assignerSession.status !== "active") throw new Error("expected an active session");
    const comment = await createTaskComment(assignerClient, assignerSession.actor, taskId, "Round trip", []);
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;

    await resolveTaskComment(assignerClient, assignerSession.actor, comment.commentId, true);
    const unresolve = await resolveTaskComment(assignerClient, assignerSession.actor, comment.commentId, false);
    expect(unresolve.ok).toBe(true);

    const context = await getTaskCommentsContext(assignerClient, assignerSession.actor, taskId);
    const found = context!.comments.find((c) => c.id === comment.commentId);
    expect(found?.resolvedAt).toBeNull();
  });
});
