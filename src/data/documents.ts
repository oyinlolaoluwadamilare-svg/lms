import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentType } from "@/domain/document";

export interface NewDocumentInput {
  tenantId: string;
  dealId: string;
  activityId: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
}

export interface InsertedDocument {
  id: string;
  fileName: string;
  storagePath: string;
}

// The only place application code inserts into documents - called exclusively by
// src/services/documents.ts's attachDocumentToActivity. Reads/writes through the CALLER's own
// RLS-scoped session (documents_insert, migration 0010) - mirrors src/data/activities.ts's
// insertActivity exactly: activity.attach_file's RLS policy already enforces the same
// own/practice/tenant scope independently of the service layer's can() check (CLAUDE.md #1).
// document_type is not accepted here - every M3.8 upload defaults to 'other' at the database level
// (see migration 0010's own comment); nothing in this milestone's UI offers a picker.
export async function insertDocument(supabase: SupabaseClient, input: NewDocumentInput): Promise<InsertedDocument> {
  const { data, error } = await supabase
    .from("documents")
    .insert({
      tenant_id: input.tenantId,
      deal_id: input.dealId,
      activity_id: input.activityId,
      file_name: input.fileName,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      uploaded_by: input.uploadedBy,
    })
    .select("id, file_name, storage_path")
    .single();

  if (error) throw new Error(`insertDocument failed: ${error.message}`);

  const row = data as unknown as { id: string; file_name: string; storage_path: string };
  return { id: row.id, fileName: row.file_name, storagePath: row.storage_path };
}

export interface DocumentListItem {
  id: string;
  activityId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  documentType: DocumentType;
  uploadedByName: string | null;
  createdAt: string;
}

interface DocumentListRow {
  id: string;
  activity_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  document_type: DocumentType;
  created_at: string;
  uploaded_by_user: { full_name: string } | null;
}

// For the Engagement timeline's per-activity attachment list (M3.8) - batched across every
// activity in the deal's timeline in one call, the same reasoning
// src/data/activityRevisions.ts's listActivityRevisionsForActivities already established (itself
// mirroring src/data/stageEvents.ts's getLatestStageEventOccurredAtByDeal). Reads through the
// caller's own RLS-scoped session (documents_select, migration 0010) - an activity this actor
// cannot see contributes no attachments here either, not an error.
export async function listDocumentsForActivities(
  supabase: SupabaseClient,
  activityIds: string[],
): Promise<Map<string, DocumentListItem[]>> {
  if (activityIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("documents")
    .select("id, activity_id, file_name, mime_type, size_bytes, document_type, created_at, uploaded_by_user:users!uploaded_by(full_name)")
    .in("activity_id", activityIds)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`listDocumentsForActivities failed: ${error.message}`);

  const byActivity = new Map<string, DocumentListItem[]>();
  for (const row of data as unknown as DocumentListRow[]) {
    if (!row.activity_id) continue;
    const item: DocumentListItem = {
      id: row.id,
      activityId: row.activity_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      documentType: row.document_type,
      uploadedByName: row.uploaded_by_user?.full_name ?? null,
      createdAt: row.created_at,
    };
    const existing = byActivity.get(row.activity_id);
    if (existing) existing.push(item);
    else byActivity.set(row.activity_id, [item]);
  }
  return byActivity;
}

export interface DocumentForDownload {
  id: string;
  storagePath: string;
  fileName: string;
}

interface DocumentForDownloadRow {
  id: string;
  storage_path: string;
  file_name: string;
}

// For getDocumentDownloadUrl's authorisation check (src/services/documents.ts) - reads through the
// CALLER's own RLS-scoped session (documents_select, migration 0010), the same "inheriting deal
// visibility" scope every other read of this table uses. Null means either the document doesn't
// exist or this actor can't see it - deliberately not distinguished, the same not-confirming-
// existence-to-an-unauthorised-caller shape every other not_found case in this codebase already
// uses. This is the ONLY authorisation check a download needs - once this read succeeds, the
// caller is entitled to the file, and the service-role signed URL that follows is not a second,
// independent decision, just the mechanism for actually reaching Storage.
export async function getDocumentForDownload(supabase: SupabaseClient, documentId: string): Promise<DocumentForDownload | null> {
  const { data, error } = await supabase.from("documents").select("id, storage_path, file_name").eq("id", documentId).maybeSingle();

  if (error) throw new Error(`getDocumentForDownload failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as DocumentForDownloadRow;
  return { id: row.id, storagePath: row.storage_path, fileName: row.file_name };
}
