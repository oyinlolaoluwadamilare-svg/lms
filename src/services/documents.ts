import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { can, type Actor } from "@/auth/permissions";
import { getActivityForAuthorization } from "@/data/activities";
import { getDealForAuthorization } from "@/data/deals";
import { listDealCoOwnerIds } from "@/data/dealCoOwners";
import { getDocumentForDownload, insertDocument, type InsertedDocument } from "@/data/documents";
import { validateDocumentUpload } from "@/domain/document";
import { createServiceClient } from "@/lib/supabase/service";
import { createSignedDownloadUrl, uploadFileToStorage } from "@/lib/storage";
import { writeAudit } from "@/services/audit";

export interface NewAttachmentInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  bytes: ArrayBuffer;
}

export type AttachDocumentResult =
  | { ok: true; document: InsertedDocument }
  | { ok: false; code: "not_found" | "denied" | "retracted" | "too_large" | "type_not_allowed" };

// The single path for attaching a file to an activity (docs/07-build-backlog.md M3.8: "Attachments
// on activities, inheriting deal visibility"). Mirrors logActivity's shape (src/services/
// activities.ts): not_found before denied (RLS already hid the activity from an actor outside
// their scope, so this never confirms existence to them), can() checked here even though
// documents_insert (migration 0010) enforces the same own/practice/tenant scope independently
// (CLAUDE.md #1). activity.attach_file's Resource is the underlying DEAL's ownership fields - the
// SAME shape activity.create already uses, not the activity's own author - docs/02-permission-
// matrix.md's "own" is one definition, used consistently everywhere in the Activities table.
//
// No virus/malware scanning: this environment has no scanning service configured or credentials
// for one, and none is available to provision from within this session - a disclosed, known gap,
// not a silent omission, flagged explicitly (the same "known gap" shape src/services/audit.ts's
// own comment already uses for the non-atomic multi-call writes throughout this codebase).
//
// Upload to Storage happens BEFORE the documents row insert, deliberately - the safer of two
// orderings this Supabase-client architecture allows (no single transaction spans a Storage write
// and a table write): if the later insert fails, the result is an orphaned, harmless, unreferenced
// Storage object, never a documents row that promises a file that was never actually written -
// the same "no user-facing broken promise" reasoning src/services/deals.ts's createDeal already
// applies to write ordering.
export async function attachDocumentToActivity(
  supabase: SupabaseClient,
  actor: Actor,
  activityId: string,
  file: NewAttachmentInput,
): Promise<AttachDocumentResult> {
  const activity = await getActivityForAuthorization(supabase, activityId);
  if (!activity || !activity.dealId) return { ok: false, code: "not_found" };

  const deal = await getDealForAuthorization(supabase, activity.dealId);
  if (!deal) return { ok: false, code: "not_found" };

  const coOwnerIds = await listDealCoOwnerIds(supabase, activity.dealId);
  const resource = {
    tenantId: deal.tenantId,
    practiceLineId: deal.practiceLineId,
    ownerId: deal.ownerId ?? undefined,
    authorId: deal.authorId,
    coOwnerIds,
  };
  if (!can(actor, "activity.attach_file", resource)) {
    return { ok: false, code: "denied" };
  }

  if (activity.retractedAt) return { ok: false, code: "retracted" };

  const validationError = validateDocumentUpload(file.sizeBytes, file.mimeType);
  if (validationError) return { ok: false, code: validationError };

  // Prefixed by tenant then deal, both real ids, for tidy per-tenant path isolation in the shared
  // private bucket (defence in depth only - the bucket is never reachable by an end user's own
  // session either way, see src/lib/storage.ts's own comment) - randomUUID() plus the original file
  // name keeps the object individually addressable and human-inspectable from the Storage side.
  const storagePath = `${actor.tenantId}/${activity.dealId}/${randomUUID()}-${file.fileName}`;

  await uploadFileToStorage(createServiceClient(), storagePath, file.bytes, file.mimeType);

  const document = await insertDocument(supabase, {
    tenantId: actor.tenantId,
    dealId: activity.dealId,
    activityId,
    fileName: file.fileName,
    storagePath,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    uploadedBy: actor.id,
  });

  await writeAudit({
    tenantId: actor.tenantId,
    actorId: actor.id,
    entityType: "document",
    entityId: document.id,
    action: "document.upload",
    after: { activityId, fileName: file.fileName, sizeBytes: file.sizeBytes },
  });

  return { ok: true, document };
}

export type GetDownloadUrlResult = { ok: true; url: string; fileName: string } | { ok: false; code: "not_found" };

// The single path for downloading an attachment. getDocumentForDownload's read through the
// CALLER's own RLS-scoped session (documents_select, "inheriting deal visibility") IS the entire
// authorisation check - there is no separate can() call here, the same reasoning
// src/services/deals.ts's listPipelineDeals/getDealDetail already give for a plain read: RLS is
// the authorisation boundary for a view action, and once that read succeeds, minting the signed
// URL is a mechanism, not a second decision (docs/03-architecture.md: "signed, expiring URLs for
// document downloads scoped to the requesting user's entitlement" - the entitlement scoping IS
// this RLS read).
export async function getDocumentDownloadUrl(supabase: SupabaseClient, documentId: string): Promise<GetDownloadUrlResult> {
  const document = await getDocumentForDownload(supabase, documentId);
  if (!document) return { ok: false, code: "not_found" };

  const url = await createSignedDownloadUrl(createServiceClient(), document.storagePath);
  return { ok: true, url, fileName: document.fileName };
}
