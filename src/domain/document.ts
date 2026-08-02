// documents (db/migrations/0010_documents). DOCUMENT_TYPES mirrors the Postgres enum exactly, the
// same reasoning src/domain/activity.ts's ACTIVITY_TYPES already gives. M3.8's own upload path
// (src/services/documents.ts) never exposes a picker for this - every activity attachment defaults
// to "other" - but the full enum is still declared here since a future document upload path
// (M5.8's Account 360 Documents tab, M9.5's templates) will need the other values.
export const DOCUMENT_TYPES = ["brief", "proposal", "contract", "minutes", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// Max file size and allowed MIME types: a real business/security decision with no answer anywhere
// in docs/DECISIONS.md or docs/03-architecture.md - flagged and asked about explicitly before
// implementing. These are the recommended defaults from that question, used because no override
// was given: 10 MB, and the common office+PDF+image set covering the proposals/contracts/minutes/
// screenshots an activity attachment is likely to actually be.
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
] as const;

export type DocumentValidationError = "too_large" | "type_not_allowed";

// Pure - no I/O, unit-testable directly. Checked before any Storage upload is attempted
// (src/services/documents.ts), the same "reject before any write is attempted" shape
// logActivity's own activity_date_in_future check already established.
export function validateDocumentUpload(sizeBytes: number, mimeType: string): DocumentValidationError | null {
  if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) return "too_large";
  if (!(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) return "type_not_allowed";
  return null;
}
