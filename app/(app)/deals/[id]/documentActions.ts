"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionActor } from "@/services/actor";
import { getDocumentDownloadUrl } from "@/services/documents";

export type GetDownloadUrlActionResult = { ok: true; url: string } | { ok: false; message: string };

// Called directly from AttachmentLink.tsx (a client component) - the same plain-arguments shape
// every other client-driven action in this directory uses. Returns a fresh, short-lived signed URL
// (src/lib/storage.ts: 5 minutes) on every call rather than caching one, since the whole point of a
// signed URL is that it expires.
export async function getDocumentDownloadUrlAction(documentId: string): Promise<GetDownloadUrlActionResult> {
  const supabase = await createClient();
  const session = await getSessionActor(supabase);
  if (session.status !== "active") {
    return { ok: false, message: "Your session has expired. Sign in again." };
  }

  const result = await getDocumentDownloadUrl(supabase, documentId);
  if (!result.ok) {
    return { ok: false, message: "That file could not be found." };
  }
  return { ok: true, url: result.url };
}
