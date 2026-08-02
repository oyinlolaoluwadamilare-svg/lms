import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSessionActor } from "@/services/actor";
import { attachDocumentToActivity, getDocumentDownloadUrl } from "@/services/documents";
import { logActivity } from "@/services/activities";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/domain/document";
import { dateInTimezone } from "@/lib/dates";
import { findOrCreateByUniqueMatch, findOrCreateTenant, findOrCreateUser, signIn as signInAs } from "./support/permanentFixture";

// M3.8 exit criteria (docs/07-build-backlog.md): "Attachments on activities, inheriting deal
// visibility." Exercises the real chain against the real hosted project: a real signed-in session,
// the real can() check, the real documents_insert/documents_select RLS policies (migration 0010),
// a real file actually uploaded to and downloaded from the private "documents" Storage bucket, and
// the real audit write.
//
// Like every other activities-adjacent fixture, this accumulates real, permanent history:
// documents.deal_id/activity_id are real FKs (no cascade), and Storage objects this suite uploads
// are never deleted (no removal capability exists yet - M3.8's own migration comment explains why).
// Find-or-create for the tenant/practice/account/deal/users, exactly like
// tests/integration/edit-retract-activity.spec.ts.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "M3-8-Integration-Test-Pw1!";
const TIMEZONE = "Africa/Lagos";

let service: SupabaseClient;

const ids = {
  tenantId: "",
  practiceLineId: "",
  otherPracticeLineId: "",
  stageId: "",
  accountId: "",
  bdeAuthId: "",
  otherBdeAuthId: "",
  otherPracticeBdeAuthId: "",
  directorAuthId: "",
  executiveAuthId: "",
  dealId: "",
};

function signIn(email: string): Promise<SupabaseClient> {
  return signInAs(SUPABASE_URL, ANON_KEY, email, PASSWORD);
}

function pdfBytes(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer as ArrayBuffer;
}

async function logTestActivity(client: SupabaseClient, actor: Awaited<ReturnType<typeof getSessionActor>>, summary: string) {
  if (actor.status !== "active") throw new Error("expected an active session");
  const result = await logActivity(client, actor.actor, TIMEZONE, {
    dealId: ids.dealId,
    type: "note",
    activityDate: dateInTimezone(new Date().toISOString(), TIMEZONE),
    summary,
    outcome: null,
    outcomeDisposition: null,
  });
  if (!result.ok) throw new Error(`fixture logActivity failed: ${result.code}`);
  return result.activity;
}

beforeAll(async () => {
  service = createServiceClient();

  ids.tenantId = await findOrCreateTenant(service, "m3-8-integration-test", "M3.8 Integration Test Tenant");

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
    { tenant_id: ids.tenantId, name: "M3.8 Test Client" },
    { tenant_id: ids.tenantId, name: "M3.8 Test Client" },
  );

  ids.bdeAuthId = await findOrCreateUser(service, ids.tenantId, "m3-8-bde@example.com", "M3.8 Bde", PASSWORD);
  ids.otherBdeAuthId = await findOrCreateUser(service, ids.tenantId, "m3-8-bde-other@example.com", "M3.8 Other Bde", PASSWORD);
  ids.otherPracticeBdeAuthId = await findOrCreateUser(
    service,
    ids.tenantId,
    "m3-8-bde-other-practice@example.com",
    "M3.8 Bde Other Practice",
    PASSWORD,
  );
  ids.directorAuthId = await findOrCreateUser(service, ids.tenantId, "m3-8-director@example.com", "M3.8 Director", PASSWORD);
  ids.executiveAuthId = await findOrCreateUser(service, ids.tenantId, "m3-8-executive@example.com", "M3.8 Executive", PASSWORD);

  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  await service.from("user_roles").insert([
    { tenant_id: ids.tenantId, user_id: ids.bdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherBdeAuthId, role: "bde", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.otherPracticeBdeAuthId, role: "bde", practice_line_id: ids.otherPracticeLineId },
    { tenant_id: ids.tenantId, user_id: ids.directorAuthId, role: "director", practice_line_id: ids.practiceLineId },
    { tenant_id: ids.tenantId, user_id: ids.executiveAuthId, role: "executive", practice_line_id: null },
  ]);

  // D-03: accounts_select needs an account_practice_owners row (migration 0005) - see
  // log-activity.spec.ts's own comment for how this gap was originally found via manual QA.
  await service.from("account_practice_owners").delete().eq("account_id", ids.accountId);
  await service
    .from("account_practice_owners")
    .insert({ account_id: ids.accountId, practice_line_id: ids.practiceLineId, owner_id: ids.bdeAuthId });

  ids.dealId = await findOrCreateByUniqueMatch(
    service,
    "deals",
    { tenant_id: ids.tenantId, reference: "D-ATTACH-1" },
    {
      tenant_id: ids.tenantId,
      reference: "D-ATTACH-1",
      name: "Attach Document Test Deal",
      account_id: ids.accountId,
      practice_line_id: ids.practiceLineId,
      stage_id: ids.stageId,
      client_type: "new",
      owner_id: ids.bdeAuthId,
      author_id: ids.bdeAuthId,
      status: "active",
      expected_close_date: "2027-06-01",
    },
  );
});

afterAll(async () => {
  await service.from("user_roles").delete().eq("tenant_id", ids.tenantId);
  // Deliberately not deleting documents/activities/the deal/account/stage/practice lines/users/
  // tenant, and not deleting anything from Storage - see this file's header comment. beforeAll is
  // find-or-create for all of these.
});

describe("attachDocumentToActivity, end to end against a real signed-in session", () => {
  it("the deal's owning bde attaches a real file: uploaded to Storage, a documents row exists, and exactly one audit row is written", async () => {
    const client = await signIn("m3-8-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const activity = await logTestActivity(client, session, "Activity with a real attachment");

    const { count: auditBefore } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "document")
      .eq("action", "document.upload");

    const result = await attachDocumentToActivity(client, session.actor, activity.id, {
      fileName: "proposal.pdf",
      mimeType: "application/pdf",
      sizeBytes: 20,
      bytes: pdfBytes("%PDF-1.4 test content"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: row } = await service
      .from("documents")
      .select("tenant_id, deal_id, activity_id, practice_line_id, uploaded_by, file_name, mime_type, document_type")
      .eq("id", result.document.id)
      .single();
    expect(row).toMatchObject({
      tenant_id: ids.tenantId,
      deal_id: ids.dealId,
      activity_id: activity.id,
      practice_line_id: ids.practiceLineId,
      uploaded_by: ids.bdeAuthId,
      file_name: "proposal.pdf",
      mime_type: "application/pdf",
      document_type: "other",
    });

    const { data: fileData, error: downloadError } = await service.storage.from("documents").download(result.document.storagePath);
    expect(downloadError).toBeNull();
    expect(fileData).not.toBeNull();
    const text = await fileData!.text();
    expect(text).toBe("%PDF-1.4 test content");

    const { count: auditAfter } = await service
      .from("audit_entries")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "document")
      .eq("action", "document.upload");
    expect(auditAfter).toBe((auditBefore ?? 0) + 1);
  });

  it("a same-practice bde who doesn't own/co-own/author the deal is denied - 'own' has no practice-wide override", async () => {
    const authorClient = await signIn("m3-8-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, "Peer cannot attach to this");

    const client = await signIn("m3-8-bde-other@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await attachDocumentToActivity(client, session.actor, activity.id, {
      fileName: "should-not-upload.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      bytes: pdfBytes("no"),
    });
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a director can attach a file to any practice member's activity", async () => {
    const authorClient = await signIn("m3-8-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, "Director attaches a file here");

    const client = await signIn("m3-8-director@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await attachDocumentToActivity(client, session.actor, activity.id, {
      fileName: "director-upload.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      bytes: pdfBytes("director"),
    });
    expect(result.ok).toBe(true);
  });

  it("an executive (tenant-wide read, never write) is denied, even though they can see the deal", async () => {
    const authorClient = await signIn("m3-8-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, "Executive cannot attach here");

    const client = await signIn("m3-8-executive@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await attachDocumentToActivity(client, session.actor, activity.id, {
      fileName: "exec-upload.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      bytes: pdfBytes("exec"),
    });
    expect(result).toEqual({ ok: false, code: "denied" });
  });

  it("a file over the size limit is rejected before any Storage upload is attempted", async () => {
    const client = await signIn("m3-8-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;
    const activity = await logTestActivity(client, session, "Too-large attachment attempt");

    const { count: docsBefore } = await service
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("activity_id", activity.id);

    const result = await attachDocumentToActivity(client, session.actor, activity.id, {
      fileName: "huge.pdf",
      mimeType: "application/pdf",
      sizeBytes: MAX_DOCUMENT_SIZE_BYTES + 1,
      bytes: pdfBytes("irrelevant - size is checked before any byte is read"),
    });
    expect(result).toEqual({ ok: false, code: "too_large" });

    const { count: docsAfter } = await service.from("documents").select("id", { count: "exact", head: true }).eq("activity_id", activity.id);
    expect(docsAfter).toBe(docsBefore ?? 0);
  });

  it("a disallowed file type is rejected before any Storage upload is attempted", async () => {
    const client = await signIn("m3-8-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;
    const activity = await logTestActivity(client, session, "Disallowed-type attachment attempt");

    const result = await attachDocumentToActivity(client, session.actor, activity.id, {
      fileName: "virus.exe",
      mimeType: "application/x-msdownload",
      sizeBytes: 10,
      bytes: pdfBytes("MZ"),
    });
    expect(result).toEqual({ ok: false, code: "type_not_allowed" });
  });
});

describe("getDocumentDownloadUrl, end to end against a real signed-in session", () => {
  it("the deal's owning bde gets a working signed URL for a real attachment", async () => {
    const client = await signIn("m3-8-bde@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;
    const activity = await logTestActivity(client, session, "Attachment to be downloaded");
    const attached = await attachDocumentToActivity(client, session.actor, activity.id, {
      fileName: "downloadable.pdf",
      mimeType: "application/pdf",
      sizeBytes: 20,
      bytes: pdfBytes("downloadable content"),
    });
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;

    const result = await getDocumentDownloadUrl(client, attached.document.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe("downloadable.pdf");

    const response = await fetch(result.url);
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toBe("downloadable content");
  });

  it("a bde outside the deal's practice can't even see the document - not_found, same as every other cross-practice case", async () => {
    const authorClient = await signIn("m3-8-bde@example.com");
    const authorSession = await getSessionActor(authorClient);
    expect(authorSession.status).toBe("active");
    if (authorSession.status !== "active") return;
    const activity = await logTestActivity(authorClient, authorSession, "Attachment hidden from other practices");
    const attached = await attachDocumentToActivity(authorClient, authorSession.actor, activity.id, {
      fileName: "hidden.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      bytes: pdfBytes("hidden"),
    });
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;

    const client = await signIn("m3-8-bde-other-practice@example.com");
    const session = await getSessionActor(client);
    expect(session.status).toBe("active");
    if (session.status !== "active") return;

    const result = await getDocumentDownloadUrl(client, attached.document.id);
    expect(result).toEqual({ ok: false, code: "not_found" });
  });
});
