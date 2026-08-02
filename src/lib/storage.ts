import type { SupabaseClient } from "@supabase/supabase-js";

// The one private Supabase Storage bucket this codebase uses (migration 0010: `insert into
// storage.buckets ... public = false`). Never exposed to a client session directly - every path
// through this file takes a service-role client, called only after the caller's own RLS-scoped
// read of the `documents` table (src/data/documents.ts) has already confirmed entitlement. See
// migration 0010's own comment for why there is deliberately no RLS policy on storage.objects
// itself: duplicating that check a second way would be two sources of truth for one rule, not
// CLAUDE.md #1's RLS-plus-can() pairing (which checks the SAME resource by two INDEPENDENT
// mechanisms).
const DOCUMENTS_BUCKET = "documents";

// Called only from src/services/documents.ts's attachDocumentToActivity, AFTER that function's
// own can() check has already passed - this function itself has no authorisation logic at all,
// the same trusted-internal-code shape writeAudit/writeStageEvent/retractActivityRow already use
// for a privileged single-path write.
export async function uploadFileToStorage(
  serviceClient: SupabaseClient,
  storagePath: string,
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const { error } = await serviceClient.storage.from(DOCUMENTS_BUCKET).upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: false, // storagePath always includes a fresh uuid (src/services/documents.ts) - a
    // collision would mean something is wrong, not something to silently overwrite.
  });
  if (error) throw new Error(`uploadFileToStorage failed: ${error.message}`);
}

// docs/03-architecture.md: "Signed, expiring URLs for document downloads scoped to the requesting
// user's entitlement." The entitlement check itself already happened (getDocumentForDownload, via
// the caller's own RLS-scoped session) before this is ever called - this function only mints the
// URL. `expirySeconds` has no decided value anywhere in docs/ (flagged, same as the size/type
// limits) - 300 seconds (5 minutes) is a low-stakes implementation default: long enough for a
// browser download to start, short enough that a leaked/logged URL stops working quickly.
const SIGNED_URL_EXPIRY_SECONDS = 300;

export async function createSignedDownloadUrl(serviceClient: SupabaseClient, storagePath: string): Promise<string> {
  const { data, error } = await serviceClient.storage.from(DOCUMENTS_BUCKET).createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
  if (error) throw new Error(`createSignedDownloadUrl failed: ${error.message}`);
  return data.signedUrl;
}
